/**
 * AnalyserNode → SignalFrame 折带管线（spec §6.3 / 计划 Task 8）。
 *
 * 口径对齐 Go internal/app/audio/fft.go 与 tauri 分支 fft.ts/spectrum.ts 的纯函数
 * 部分（不整拷文件——原件含 Tauri 事件监听；FFT 本身由 AnalyserNode 承担，不移植）：
 *
 *  - bandEdges：40Hz..min(16000, nyquist) 按**频率**对数分边。边缘由频率而非 bin
 *    索引推导——bin 随窗口长度变化，Hz 布局不随设备缓冲漂移，同一音高恒落同带。
 *    边缘只保证非降、不强制分开：短窗口分辨不出 range 底部时，多个低带共享一个
 *    bin（foldBands 对它们读单 bin 而非读出空带），强行撑开会把整个显示压进左三分之一。
 *  - foldBands：带内均值；getByteFrequencyData 为 0..255 字节域，除以 255 归一到 0..1。
 *  - normalizeBands：运行峰值 max(framePeak, peak×0.94/帧, floor 1e-4) 抗泵动，再以
 *    log1p(r*9)/log(10) 压缩响端、让底部的安静细节可见（Go fft.go:222 同式）。
 *  - computeLevel：RMS×3.2 clamp 0..1（Go levelGain=3.2：语音/音乐远低于满幅，
 *    不抬升则电平表几乎不动）。RMS 取降采样后的 256 点，与示波器所见一致（对齐 Go）。
 *  - computeBeat：<150Hz 对应低频带能量超过自身滚动均值（EMA 0.92/0.08）×1.35 即
 *    onset——snap 上升、其后 exp(-dt*7) 平滑衰减（Go fft.go:306），正是 kick 的形状；
 *    dt≤0 或 >0.25 时替换为 1/30（Go fft.go:184-186），不冻结、不爆衰减。
 *    节拍吃**归一化前**的折带幅值（Go fft.go:287-289 / tauri spectrum.ts:56 同口径）：
 *    归一化域受全局运行峰值耦合 + log1p 压缩，bass≈帧峰值时 EMA 恒贴 1，1.35×
 *    永过不了——低频主导曲目 beat 死区。
 *  - createAnalyserPipeline：每帧 getByteFrequencyData/getByteTimeDomainData →
 *    fold/normalize/level/beat → SignalFrame，供 Task 15 接线；jsdom 无
 *    AnalyserNode，类型仅作输入约束，测试用最小 stub。
 */

export const BAND_COUNT = 56;
export const WAVE_SAMPLES = 256;

const MIN_HZ = 40; // 显示下限（低于首个 bin 无可读，实际取 max(40, binHz)）
const MAX_HZ = 16000; // 显示上限，钳到 Nyquist
const PEAK_DECAY = 0.94; // 运行峰值每帧衰减（Go peakDecay）
const PEAK_FLOOR = 1e-4; // 峰值下限：安静段不被放大成噪声
const BASS_HZ = 150; // 以下算"bass"，驱动节拍（Go bassHz）
const BEAT_RATIO = 1.35; // bass 高出自身均值的倍数阈值（Go beatRatio）
const BEAT_DECAY = 7; // 无峰帧 beat 衰减速率（Go fft.go:306：a.beat *= exp(-dt*7)）
const LEVEL_GAIN = 3.2; // RMS 抬升（Go levelGain）

/** 一帧信号（bands 0..1 低→高、wave -1..1、level 0..1、beat 0..1）。 */
export interface SignalFrame {
  bands: Float32Array;
  wave: Float32Array;
  level: number;
  beat: number;
}

/**
 * 频率对数分边的 bin 边界（长 BAND_COUNT+1，元素 ∈ [0, binCount]）。
 * binCount = AnalyserNode.frequencyBinCount（= fftSize/2），binHz = sampleRate/(2·binCount)。
 */
export function bandEdges(sampleRate: number, binCount: number): number[] {
  const binHz = sampleRate > 0 && binCount > 0 ? sampleRate / (binCount * 2) : 1;
  const nyquist = binCount * binHz;
  // 低于最低 bin 的频段无可读，从第一个 bin 起。
  const minHz = Math.max(MIN_HZ, binHz);
  const maxHz = Math.max(minHz * 2, Math.min(MAX_HZ, nyquist));
  const ratio = Math.log(maxHz / minHz);

  const edges: number[] = new Array<number>(BAND_COUNT + 1);
  for (let i = 0; i <= BAND_COUNT; i += 1) {
    const hz = minHz * Math.exp((ratio * i) / BAND_COUNT);
    edges[i] = Math.min(binCount, Math.round(hz / binHz));
  }
  return edges;
}

/**
 * 带内均值折带（字节域 /255 → 0..1）。低带常共享同一 bin（见 bandEdges），
 * to 允许等于 from——读单 bin 正是这些带跟得上低音的原因，而非塌成空带。
 * `out` 可注入复用缓冲（管线每帧调用，避免 56 浮点分配）。
 */
export function foldBands(bins: Uint8Array, edges: number[], out = new Float32Array(BAND_COUNT)): Float32Array {
  const lastBin = bins.length - 1;
  for (let band = 0; band < BAND_COUNT; band += 1) {
    const from = Math.min(edges[band], lastBin);
    const to = Math.min(Math.max(edges[band + 1], from + 1), bins.length);

    let sum = 0;
    for (let bin = from; bin < to; bin += 1) sum += bins[bin];
    out[band] = sum / (to - from) / 255;
  }
  return out;
}

/**
 * 对数压缩归一化到 0..1：先找帧峰值，运行峰值取 max(framePeak, 旧峰×0.94, floor)
 * （峰值只在输入回落时衰减——持续等值输入不泵降），再 log1p(r*9)/log(10) 压缩。
 * 只 mutate peakRef，bands 不动；返回新数组。
 */
export function normalizeBands(bands: Float32Array, peakRef: { v: number }): Float32Array {
  let framePeak = 0;
  for (let i = 0; i < bands.length; i += 1) {
    if (bands[i] > framePeak) framePeak = bands[i];
  }

  peakRef.v = Math.max(framePeak, peakRef.v * PEAK_DECAY, PEAK_FLOOR);

  const out = new Float32Array(BAND_COUNT);
  for (let i = 0; i < BAND_COUNT; i += 1) {
    const ratio = bands[i] / peakRef.v;
    out[i] = Math.min(1, Math.log1p(ratio * 9) / Math.log(10));
  }
  return out;
}

/** RMS×3.2 clamp 0..1（字节域 128 居中）。 */
export function computeLevel(wave: Uint8Array): number {
  let sumSquares = 0;
  for (let i = 0; i < wave.length; i += 1) {
    const value = (wave[i] - 128) / 128;
    sumSquares += value * value;
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, wave.length));
  return Math.min(1, rms * LEVEL_GAIN);
}

/**
 * 时域字节波降采样到 256 点：桶内取均值（示波器所见，而非逐点取峰值——那会
 * 抬高每个尖峰）。字节域输出供 computeLevel；Float32 帧由管线另行换算。
 */
export function downsampleWave(raw: Uint8Array, out = new Uint8Array(WAVE_SAMPLES)): Uint8Array {
  const stride = raw.length / WAVE_SAMPLES;
  for (let i = 0; i < WAVE_SAMPLES; i += 1) {
    const start = Math.floor(i * stride);
    const end = Math.max(start + 1, Math.floor((i + 1) * stride));

    let sum = 0;
    for (let s = start; s < end && s < raw.length; s += 1) sum += raw[s];
    out[i] = Math.round(sum / (end - start));
  }
  return out;
}

/**
 * <150Hz 的低频带数：按标称 40..16000 对数布局，取含骑跨 150Hz 带在内的前
 * floor(56·ln(150/40)/ln(400))+1 = 13 带（对齐 Go bassBins=round(150/binHz)
 * 圆整包含骑跨 bin 的口径）。
 */
const BASS_BANDS = Math.max(
  1,
  Math.min(BAND_COUNT, Math.floor((BAND_COUNT * Math.log(BASS_HZ / MIN_HZ)) / Math.log(MAX_HZ / MIN_HZ)) + 1),
);

/**
 * 节拍检测：低频带均值 vs 滚动均值 EMA(0.92/0.08)×1.35。超过即 onset——
 * snap 上升（钳 1）；无峰帧按 exp(-dt*7) 平滑衰减（Go fft.go:306），kick 的形状。
 * dt≤0 或 >0.25 时替换为 1/30（Go fft.go:184-186），不冻结也不爆衰减。
 * 输入应为**归一化前**的折带幅值（管线传 rawBands；Go/tauri 两个移植源都吃
 * 原始幅值——归一化域会造成低频主导死区，见 analyse.test.ts 回归测试）。
 * `st` 为调用方持有的节拍状态（EMA 初始 0 时首帧直接落底，不触发 onset）。
 */
export function computeBeat(bands: Float32Array, st: { ema: number; pulse: number }, dt: number): number {
  const count = Math.min(BASS_BANDS, bands.length);
  let bass = 0;
  for (let i = 0; i < count; i += 1) bass += bands[i];
  bass /= count;

  st.ema = st.ema === 0 ? bass : st.ema * 0.92 + bass * 0.08;

  const threshold = st.ema * BEAT_RATIO;
  const onset = st.ema > 1e-5 && bass > threshold ? (bass - threshold) / threshold : 0;

  // onset 吸附上升、其后平滑衰减——kick 的形状。
  const step = dt > 0 && dt <= 0.25 ? dt : 1 / 30;
  st.pulse = onset > 0 ? Math.min(1, onset) : st.pulse * Math.exp(-step * BEAT_DECAY);
  return st.pulse;
}

/** createAnalyserPipeline 的产物：frame 每动画帧调用（dt 缺省 1/60），reset 换曲清状态。 */
export interface AnalyserPipeline {
  frame(dt?: number): SignalFrame;
  reset(): void;
}

/**
 * 包住一个 AnalyserNode（或最小 stub：{frequencyBinCount, fftSize?, sampleRate?,
 * getByteFrequencyData, getByteTimeDomainData}）的逐帧管线：
 * getByteFrequencyData/getByteTimeDomainData → fold/normalize/level/beat → SignalFrame。
 * edges/缓冲在创建时按采样率定死（sampleRate 缺省依次取 stub 自带值 →
 * analyser.context.sampleRate → 48000）。
 */
export function createAnalyserPipeline(analyser: AnalyserNode): AnalyserPipeline {
  const binCount = analyser.frequencyBinCount > 0 ? analyser.frequencyBinCount : 2048;
  // 真实 AnalyserNode 自身无 sampleRate，从所属 AudioContext 取；stub 可自带。
  const holder = analyser as AnalyserNode & { sampleRate?: number };
  const sampleRate = holder.sampleRate ?? analyser.context?.sampleRate ?? 48000;
  const fftSize = analyser.fftSize > 0 ? analyser.fftSize : binCount * 2;

  const freqBuf = new Uint8Array(binCount);
  const waveBuf = new Uint8Array(fftSize);
  const waveBytes = new Uint8Array(WAVE_SAMPLES);
  const wave = new Float32Array(WAVE_SAMPLES);
  const rawBands = new Float32Array(BAND_COUNT);
  const edges = bandEdges(sampleRate, binCount);
  const peakRef = { v: 0 };
  const beatState = { ema: 0, pulse: 0 };

  return {
    frame(dt = 1 / 60): SignalFrame {
      analyser.getByteFrequencyData(freqBuf);
      analyser.getByteTimeDomainData(waveBuf);

      foldBands(freqBuf, edges, rawBands);
      const bands = normalizeBands(rawBands, peakRef);

      downsampleWave(waveBuf, waveBytes);
      for (let i = 0; i < WAVE_SAMPLES; i += 1) wave[i] = (waveBytes[i] - 128) / 128;
      const level = computeLevel(waveBytes);
      // beat 吃**归一化前**的折带幅值（Go fft.go:287-289 / tauri spectrum.ts:56 同口径）。
      // 归一化域受全局运行峰值耦合 + log1p 压缩：bass≈帧峰值时 EMA 恒贴 1，
      // 1.35× 阈值永过不了——低频主导曲目 beat 死区（见回归测试）。
      const beat = computeBeat(rawBands, beatState, dt);

      return { bands, wave, level, beat };
    },
    reset(): void {
      peakRef.v = 0;
      beatState.ema = 0;
      beatState.pulse = 0;
    },
  };
}
