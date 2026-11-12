/**
 * Task 8 Step 2 失败测试：合成信号适配层 makeSynth（计划 Task 8 逐字条目）。
 *
 * SignalEngine 移植自 tauri 分支 signal.ts（FNV-1a → mulberry32 种子化）：
 *  - 同 seed 确定性：第 60 帧 deep-equal；不同 seed 特征不同；
 *  - paused：idle 呼吸（IDLE_FLOOR 0.045 × 1+sin(t*0.9)*0.35）非零非静默、beat 恒 0；
 *  - playing：按 BPM（92–138）周期起拍，beat 周期性 >0.4（间隔 435–652ms ±1 帧量化）；
 *  - 帧形状：bands 56 / wave 256（与 analyse 口径一致）。
 */
import { describe, expect, it } from 'vitest';

import { BAND_COUNT, WAVE_SAMPLES } from './analyse';
import { makeSynth } from './synth';

type Synth = ReturnType<typeof makeSynth>;

/** 推进 n 帧（dt=1/60），返回第 n 帧（复用同一就地帧对象）。 */
function advance(synth: Synth, frames: number, playing: boolean, dt = 1 / 60) {
  for (let i = 0; i < frames - 1; i += 1) synth.update(dt, playing);
  return synth.update(dt, playing);
}

describe('makeSynth 确定性（FNV-1a → mulberry32）', () => {
  it('同 seed 两次 makeSynth：第 60 帧 deep-equal（bands/wave/level/beat）', () => {
    const a = makeSynth('track-42');
    const b = makeSynth('track-42');
    const fa = advance(a, 60, true);
    const fb = advance(b, 60, true);
    expect(fa.level).toBe(fb.level);
    expect(fa.beat).toBe(fb.beat);
    expect(Array.from(fa.bands)).toEqual(Array.from(fb.bands));
    expect(Array.from(fa.wave)).toEqual(Array.from(fb.wave));
  });

  it('不同 seed 第 60 帧特征不同（防常量输出假阳性）', () => {
    const a = makeSynth('track-42');
    const c = makeSynth('other-track');
    expect(Array.from(advance(a, 60, true).bands)).not.toEqual(
      Array.from(advance(c, 60, true).bands),
    );
  });
});

describe('makeSynth paused（idle 呼吸）', () => {
  it('paused 300 帧：level∈(0.02,0.2)（呼吸非零非静默）、beat 恒 0、bands/wave 有形且随时间波动', () => {
    const synth = makeSynth('pause-check');
    for (let i = 0; i < 199; i += 1) synth.update(1 / 60, false);
    // 帧对象是引擎就地复用的同一实例——标量须当场拷出，否则 f200/f300 同引用
    const level200 = synth.update(1 / 60, false).level;
    for (let i = 0; i < 99; i += 1) synth.update(1 / 60, false);
    const f300 = synth.update(1 / 60, false);

    expect(f300.level).toBeGreaterThan(0.02);
    expect(f300.level).toBeLessThan(0.2);
    expect(f300.beat).toBe(0); // 暂停无起拍
    expect(Array.from(f300.bands).some((v) => v > 0.01)).toBe(true); // 有形频谱
    expect(Array.from(f300.wave).some((v) => v !== 0)).toBe(true); // 示波非静默
    expect(Math.abs(f300.level - level200)).toBeGreaterThan(5e-3); // 呼吸在动（非冻结）
  });
});

describe('makeSynth playing（BPM 起拍）', () => {
  it('beat 周期性 >0.4：相邻起拍间隔 435–652ms（92–138 BPM，±1 帧量化余量）', () => {
    const synth = makeSynth('beat-check');
    const onsets: number[] = [];
    let prev = 0;
    for (let f = 1; f <= 1800; f += 1) {
      const beat = synth.update(1 / 60, true).beat;
      if (beat > 0.4 && prev <= 0.4) onsets.push(f);
      prev = beat;
    }
    expect(onsets.length).toBeGreaterThan(20); // 30s ≥ ~46 拍
    expect(onsets[0]).toBeLessThanOrEqual(40); // 首拍在首个周期内
    for (let i = 1; i < onsets.length; i += 1) {
      const gapMs = ((onsets[i] - onsets[i - 1]) * 1000) / 60;
      expect(gapMs).toBeGreaterThanOrEqual(425);
      expect(gapMs).toBeLessThanOrEqual(670);
    }
  });
});

describe('makeSynth 帧形状', () => {
  it('bands 长 56、wave 长 256（与 analyse 口径一致）', () => {
    const synth = makeSynth('shape-check');
    const frame = synth.update(1 / 60, true);
    expect(frame.bands).toHaveLength(BAND_COUNT);
    expect(frame.wave).toHaveLength(WAVE_SAMPLES);
    expect(Array.from(frame.bands).every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(Array.from(frame.wave).every((v) => v >= -1 && v <= 1)).toBe(true);
  });
});
