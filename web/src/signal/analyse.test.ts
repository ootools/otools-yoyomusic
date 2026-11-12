/**
 * Task 8 Step 1 失败测试：AnalyserNode→SignalFrame 折带/归一化/节拍（计划 Task 8 逐字条目）。
 *
 * 口径对照（Go internal/app/audio/fft.go ↔ tauri fft.ts/spectrum.ts）：
 *  - bandEdges：40Hz..min(16000, nyquist) 按**频率**对数分边（非按 bin），长 BAND_COUNT+1；
 *  - foldBands：带内均值（字节域 /255 → 0..1），单 bin 突起落对应带；
 *  - normalizeBands：运行峰值 max(framePeak, peak×0.94, 1e-4) + log1p(r*9)/log(10) 压缩
 *    （Go fft.go:222 `a.bandPeak = math.Max(framePeak, a.bandPeak*peakDecay)` —— 峰值只在
 *    输入回落时衰减，持续等值输入不泵降，故"恒定输入后 0.47"用回落帧触发）；
 *  - computeLevel：RMS×3.2 clamp 0..1（字节域 128 居中）；
 *  - computeBeat：<150Hz 对应低频带 vs EMA(0.92/0.08)×1.35 → onset snap、exp(-dt*7) 衰减
 *    （Go fft.go:306）；dt≤0 或 >0.25 → 1/30（Go fft.go:184-186）；
 *  - createAnalyserPipeline：stub AnalyserNode 驱动整帧管线。
 */
import { describe, expect, it } from 'vitest';

import {
  BAND_COUNT,
  WAVE_SAMPLES,
  bandEdges,
  computeBeat,
  computeLevel,
  createAnalyserPipeline,
  downsampleWave,
  foldBands,
  normalizeBands,
} from './analyse';

describe('bandEdges（40Hz..min(16000,nyquist) 按频率对数分边）', () => {
  it('48000Hz/4096bins：长 57、首边 bin7(41.02Hz≥40)、末边 bin2731(≈16k 半 bin 内)、非降、不越界', () => {
    const edges = bandEdges(48000, 4096);
    expect(edges).toHaveLength(BAND_COUNT + 1);

    const binHz = 48000 / (4096 * 2); // 5.859375
    expect(edges[0]).toBe(Math.round(40 / binHz)); // 7
    expect(edges[0] * binHz).toBeGreaterThanOrEqual(40); // 41.015625 ≥ 40

    expect(edges[BAND_COUNT]).toBe(Math.min(4096, Math.round(16000 / binHz))); // 2731
    expect(Math.abs(edges[BAND_COUNT] * binHz - 16000)).toBeLessThanOrEqual(binHz / 2 + 1e-9);

    expect(edges.every((e) => e >= 0 && e <= 4096)).toBe(true);
    for (let i = 1; i < edges.length; i += 1) {
      expect(edges[i]).toBeGreaterThanOrEqual(edges[i - 1]); // 只非降，不强制分开
    }
  });

  it('8000Hz/512bins：nyquist 4000 < 16000 → 末边钳到顶 bin 512', () => {
    const edges = bandEdges(8000, 512);
    const binHz = 8000 / (512 * 2); // 7.8125
    expect(edges[BAND_COUNT]).toBe(Math.round(4000 / binHz)); // 512（=nyquist）
  });

  it('binHz>40 时首边从第一个 bin 起（minHz 抬到 binHz）', () => {
    const edges = bandEdges(48000, 256); // binHz = 93.75 > 40
    expect(edges[0]).toBe(1);
  });
});

describe('foldBands（带内均值，字节域 /255 → 0..1）', () => {
  it('单 bin 突起落对应带：bin7 独占带 0 → 满值 1，其余带全 0', () => {
    const edges = bandEdges(48000, 4096);
    const bins = new Uint8Array(4096);
    bins[7] = 255;
    const bands = foldBands(bins, edges);
    expect(bands).toHaveLength(BAND_COUNT);
    expect(bands[0]).toBeCloseTo(1, 12); // 255 / 1 bin / 255
    for (let i = 1; i < BAND_COUNT; i += 1) expect(bands[i]).toBe(0);
  });

  it('单 bin 突起落对应带：bin2000 → 带 53（edges 1981..2205），带内均值 255/224/255', () => {
    const edges = bandEdges(48000, 4096);
    expect(edges[53]).toBeLessThanOrEqual(2000);
    expect(edges[54]).toBeGreaterThan(2000);
    const bins = new Uint8Array(4096);
    bins[2000] = 255;
    const bands = foldBands(bins, edges);
    // 输出为 Float32Array（f32 存储），精度放宽到 f32 epsilon 量级
    expect(bands[53]).toBeCloseTo(255 / (edges[54] - edges[53]) / 255, 7);
    for (let i = 0; i < BAND_COUNT; i += 1) {
      if (i !== 53) expect(bands[i]).toBe(0);
    }
  });

  it('同带相邻两 bin 取均值：bin100=100、bin101=50 同落带 25（edges 99..110）→ (150/11)/255', () => {
    const edges = bandEdges(48000, 4096);
    expect(edges[25]).toBeLessThanOrEqual(100);
    expect(edges[26]).toBeGreaterThan(101);
    const bins = new Uint8Array(4096);
    bins[100] = 100;
    bins[101] = 50;
    const bands = foldBands(bins, edges);
    expect(bands[25]).toBeCloseTo((100 + 50) / (edges[26] - edges[25]) / 255, 7);
    expect(bands[24]).toBe(0);
    expect(bands[26]).toBe(0);
  });

  it('全零 bins → 全零 bands', () => {
    const bands = foldBands(new Uint8Array(4096), bandEdges(48000, 4096));
    expect(Array.from(bands).every((v) => v === 0)).toBe(true);
  });
});

describe('normalizeBands（运行峰值 ×0.94/帧衰减 + log1p(r*9)/log(10) 压缩，mutate peakRef）', () => {
  it('恒定 0.5：峰值落 0.5、输出恰为 log1p(9)/ln10 = 1（压满）；持续等值不泵降', () => {
    const peakRef = { v: 0 };
    const bands = new Float32Array(BAND_COUNT).fill(0.5);
    const out1 = normalizeBands(bands, peakRef);
    expect(peakRef.v).toBeCloseTo(0.5, 12);
    expect(out1[0]).toBeCloseTo(1, 12); // ratio 1 → log1p(9)/log(10) = 1
    const out2 = normalizeBands(bands, peakRef);
    expect(peakRef.v).toBeCloseTo(0.5, 12); // 帧峰值仍 0.5 → 运行峰值保持（Go max(framePeak, peak×0.94)）
    expect(out2[0]).toBeCloseTo(1, 12);
  });

  it('输入回落后峰值按 ×0.94 衰减：0.5 → 0.47（0.5×0.94），输出经 log 压缩 <0.5', () => {
    const peakRef = { v: 0 };
    normalizeBands(new Float32Array(BAND_COUNT).fill(0.5), peakRef);
    const out = normalizeBands(new Float32Array(BAND_COUNT).fill(0.05), peakRef);
    expect(peakRef.v).toBeCloseTo(0.47, 10);
    expect(out[0]).toBeCloseTo(0.29169, 4); // log1p(0.05/0.47×9)/ln10
    expect(out[0]).toBeLessThan(0.5);
  });

  it('峰值下限 floor 1e-4：全零输入不被放大成噪声（输出恰 0）', () => {
    const peakRef = { v: 0 };
    const out = normalizeBands(new Float32Array(BAND_COUNT), peakRef);
    expect(peakRef.v).toBe(1e-4);
    expect(Array.from(out).every((v) => v === 0)).toBe(true);
  });
});

describe('computeLevel（RMS×3.2 clamp 0..1，字节域 128 居中）', () => {
  it('恒定 +16 偏移（0.125 全幅）→ 恰 0.4', () => {
    expect(computeLevel(new Uint8Array(WAVE_SAMPLES).fill(144))).toBe(0.4);
  });

  it('半 128 半 144 → RMS = 0.125/√2 → 0.28284…', () => {
    const wave = new Uint8Array(WAVE_SAMPLES).fill(128);
    for (let i = 0; i < WAVE_SAMPLES; i += 2) wave[i] = 144;
    expect(computeLevel(wave)).toBeCloseTo(0.282842712474619, 12);
  });

  it('满幅 255 钳到 1；全 128（静默）为 0', () => {
    expect(computeLevel(new Uint8Array(WAVE_SAMPLES).fill(255))).toBe(1);
    expect(computeLevel(new Uint8Array(WAVE_SAMPLES).fill(128))).toBe(0);
  });
});

describe('downsampleWave（任意长字节波 → 256 点桶均值）', () => {
  it('4096 → 256：步长 16 桶均值，桶 0 含 255 突起 = round((255+15×128)/16)', () => {
    const raw = new Uint8Array(4096).fill(128);
    raw[0] = 255;
    const wave = downsampleWave(raw);
    expect(wave).toHaveLength(WAVE_SAMPLES);
    expect(wave[0]).toBe(Math.round((255 + 15 * 128) / 16)); // 136
    expect(wave[1]).toBe(128);
    expect(wave[255]).toBe(128);
  });
});

describe('computeBeat（低频带能量 vs EMA(0.92/0.08)×1.35 → snap、exp(-dt*7) 衰减）', () => {
  const DT = 1 / 60;

  /** 基线帧：全带 0.1（低频带均值 = 0.1）。 */
  function baseline(): Float32Array {
    return new Float32Array(BAND_COUNT).fill(0.1);
  }

  /** bass 突峰帧：<150Hz 对应的前 13 个带抬到 0.5。 */
  function spike(): Float32Array {
    const bands = new Float32Array(BAND_COUNT).fill(0.1);
    for (let i = 0; i < 13; i += 1) bands[i] = 0.5;
    return bands;
  }

  it('EMA 初始 0：首帧直接落底（ema=bass），无 onset', () => {
    const st = { ema: 0, pulse: 0 };
    const beat = computeBeat(baseline(), st, DT);
    expect(st.ema).toBeCloseTo(0.1, 6); // 输入是 Float32Array（f32 精度 0.10000000149…）
    expect(beat).toBe(0);
  });

  it('bass 突峰 → onset snap：beat>0.5（钳到 1）且 EMA 更新 0.1→0.132', () => {
    const st = { ema: 0, pulse: 0 };
    for (let i = 0; i < 5; i += 1) computeBeat(baseline(), st, DT);
    expect(st.ema).toBeCloseTo(0.1, 6);
    const beat = computeBeat(spike(), st, DT);
    expect(beat).toBeGreaterThan(0.5);
    expect(beat).toBeLessThanOrEqual(1);
    expect(st.ema).toBeCloseTo(0.132, 6); // 0.1×0.92 + 0.5×0.08
  });

  it('峰后 300ms（18 帧×1/60）无峰 → 衰减到 exp(-0.3×7)≈0.1225 < 0.2（Go fft.go:306 衰减率 7）', () => {
    const st = { ema: 0, pulse: 0 };
    for (let i = 0; i < 5; i += 1) computeBeat(baseline(), st, DT);
    computeBeat(spike(), st, DT); // snap → 1
    let beat = 1;
    for (let f = 0; f < 18; f += 1) beat = computeBeat(baseline(), st, DT);
    expect(beat).toBeCloseTo(Math.exp(-0.3 * 7), 10);
    expect(beat).toBeLessThan(0.2);
  });

  it('dt≤0 或 >0.25 替换为 1/30（Go fft.go:184-186）：不冻结也不爆衰减', () => {
    const frozen = { ema: 0.1, pulse: 1 };
    const huge = { ema: 0.1, pulse: 1 };
    const expected = Math.exp(-(1 / 30) * 7);
    expect(computeBeat(baseline(), frozen, 0)).toBeCloseTo(expected, 12); // 旧钳 0 会冻结在 1
    expect(computeBeat(baseline(), huge, 2)).toBeCloseTo(expected, 12); // 旧钳 0.25 会爆衰减
  });
});

describe('createAnalyserPipeline（stub AnalyserNode：jsdom 无 WebAudio，类型仅作输入）', () => {
  const WAVE_0125 = new Array<number>(4096).fill(144); // 恒定 0.125 满幅

  /** 最小 AnalyserNode 桩：取数函数供给，帧间可换数据。 */
  function stubAnalyser(
    getBins: () => number[],
    getWave: () => number[],
    sampleRate?: number,
  ): AnalyserNode {
    const stub: Record<string, unknown> = {
      frequencyBinCount: 4096,
      fftSize: 4096,
      getByteFrequencyData: (buf: Uint8Array) => {
        buf.set(getBins());
      },
      getByteTimeDomainData: (buf: Uint8Array) => {
        buf.set(getWave());
      },
    };
    if (sampleRate !== undefined) stub.sampleRate = sampleRate;
    return stub as unknown as AnalyserNode;
  }

  /** bass 带（0..12，覆盖 bin 7..27 ≈ 40..164Hz）与其余 bin 分设电平。 */
  function binsWith(bass: number, rest: number): number[] {
    const bins = new Array<number>(4096).fill(rest);
    for (let i = 7; i <= 27; i += 1) bins[i] = bass;
    return bins;
  }

  it('逐帧 fold/normalize/level/beat → SignalFrame（与纯函数组合逐值一致）', () => {
    const bins = binsWith(10, 255); // bass 安静、其余满幅
    const pipeline = createAnalyserPipeline(stubAnalyser(() => bins, () => WAVE_0125));

    const f1 = pipeline.frame(1 / 60);
    expect(f1.bands).toHaveLength(BAND_COUNT);
    expect(f1.wave).toHaveLength(WAVE_SAMPLES);

    const edges = bandEdges(48000, 4096);
    const expected = normalizeBands(foldBands(new Uint8Array(bins), edges), { v: 0 });
    expect(Array.from(f1.bands)).toEqual(Array.from(expected));

    expect(f1.level).toBe(0.4); // RMS 0.125 × 3.2
    expect(f1.wave[0]).toBeCloseTo(0.125, 12);
    expect(Array.from(f1.wave).every((v) => v >= -1 && v <= 1)).toBe(true);

    expect(f1.beat).toBe(0); // EMA 首帧落底（ema=bass），无 onset
  });

  it('bass 突峰（按带铺满 bin 7..27）→ 下一帧 onset snap beat>0.5', () => {
    let bins = binsWith(10, 255);
    const pipeline = createAnalyserPipeline(stubAnalyser(() => bins, () => WAVE_0125));
    pipeline.frame(1 / 60); // EMA 落低（bass_n≈0.13，阈值 1.35×）
    bins = binsWith(255, 255); // bass 满幅 → onset snap
    const f2 = pipeline.frame(1 / 60);
    expect(f2.beat).toBeGreaterThan(0.5);
  });

  it('低频主导回归：bass 稳态 110/其余 40 → bass 全量抬 255 → beat>0.5（归一化域喂 beat 时此场景=0）', () => {
    // 死区机理：归一化域 bass≈帧峰值 → 压缩后恒贴 1，EMA 恒 1，1.35× 永过不了。
    // Go fft.go:287-289 / tauri spectrum.ts:56 都吃归一化前的原始幅值。
    // 稳态取 110（0.4314）： faithful 口径下 EMA 在 onset 判定前先吃当前帧
    // （Go fft.go:296-299），kick 帧阈值被同帧抬高，bass=1.0 需稳态 <0.4502 才可过 0.5。
    let bins = binsWith(110, 40); // bass 带稳态 110（raw≈0.4314），其余 40
    const pipeline = createAnalyserPipeline(stubAnalyser(() => bins, () => WAVE_0125));
    for (let i = 0; i < 30; i += 1) pipeline.frame(1 / 60); // EMA 收敛
    bins = binsWith(255, 40); // kick：bass bin 全量抬满
    const kick = pipeline.frame(1 / 60);
    expect(kick.beat).toBeGreaterThan(0.5); // raw 域 faithful onset≈0.553
  });

  it('reset()：清峰值/节拍状态后首帧与初次一致（换曲不继承旧峰）', () => {
    const pipeline = createAnalyserPipeline(stubAnalyser(() => binsWith(10, 255), () => WAVE_0125));
    const f1 = pipeline.frame(1 / 60);
    pipeline.frame(1 / 60); // 峰值/EMA 已推进
    pipeline.reset();
    const f3 = pipeline.frame(1 / 60);
    expect(Array.from(f3.bands)).toEqual(Array.from(f1.bands));
    expect(f3.beat).toBe(0);
  });

  it('缺省 dt（不传参）可用；stub 缺 sampleRate 时回退 48000', () => {
    const pipeline = createAnalyserPipeline(stubAnalyser(() => binsWith(10, 255), () => WAVE_0125));
    const frame = pipeline.frame();
    expect(frame.bands).toHaveLength(BAND_COUNT);
    expect(frame.level).toBe(0.4);
  });
});
