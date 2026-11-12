/*
 * 合成音频信号引擎（Simulated audio signal engine）。
 *
 * 移植自 lingyun/YoYoMusic tauri 分支 src/features/visualization/signal.ts
 * （commit 9336a4d "feat(viz): analyse the real audio, and two generated modes"），
 * 剥离 React/Tauri 依赖 —— 原文件本为框架无关纯 TS，逻辑与常量逐行保留，便于与
 * Go 版（internal/app/audio/player.go 合成分支）及 tauri 原件对照：
 *
 *   IDLE_FLOOR 0.045；attack 1-exp(-dt*22) / release 1-exp(-dt*6.5)；
 *   粉噪 tilt pow(1-ratio,1.35)*0.88+0.12；kick 曲线 pow(1-ratio,2.2)；
 *   BPM 92–138（92 + random()*46）；每带 shape 0.45+rand*0.55、wander 速度 0.7–4.1；
 *   三正弦混合权重 0.5/0.32/0.18（speed ×1/0.41/0.13、相位 ×1/2.3/0.7）；
 *   beat kick×0.55 + 高频 sparkle（ratio>0.55）；level 平滑 8/s；
 *   wave 4 条镜像部分波 cycles 2/5/11/19，drive = 0.35+level*1.5（暂停 0.08）；
 *   真实帧：attack 26/s、release 7/s、level 9/s、beat exp(-dt*7)；
 *   种子哈希 FNV-1a（2166136261/16777619）→ mulberry32。
 *
 * 播放发生在宿主内核（Go 版 rodio / 本插件宿主 audio 会话），webview 拿不到解码
 * 样本、也没有 AnalyserNode 可读。与其输出静态假帧，不如合成一个"像音乐"的信号：
 * 粉噪式频谱倾斜 + 每带平滑游走 + 周期 kick 包络 + 配套示波迹。
 *
 * 引擎按曲目 id 种子化——同一首歌永远跳同一种舞；动画按显示刷新率推进而非
 * 500ms 播放态轮询。真实频谱可用时经 `real` 传入（applyRealFrame 平滑），合成
 * 分支继续充当暂停态与浏览器直开的兜底（spec §6.3）。
 */

export const BAND_COUNT = 56;
export const WAVE_SAMPLES = 256;

export interface SignalFrame {
  /** Frequency bands, low → high, each clamped to 0..1. */
  bands: Float32Array;
  /** Oscilloscope samples in -1..1. */
  wave: Float32Array;
  /** Smoothed overall loudness, 0..1. */
  level: number;
  /** Kick envelope, 0..1, spiking once per beat. */
  beat: number;
}

const IDLE_FLOOR = 0.045;

export class SignalEngine {
  readonly bands = new Float32Array(BAND_COUNT);
  readonly wave = new Float32Array(WAVE_SAMPLES);
  level = 0;
  beat = 0;

  private readonly shape: Float32Array;
  private readonly speed: Float32Array;
  private readonly phase: Float32Array;
  private readonly tilt: Float32Array;
  private readonly kickCurve: Float32Array;
  private bpm: number;
  private time = 0;
  private beatClock = 0;
  private beatPulse = 0;

  constructor(seed: string) {
    const random = mulberry32(hashString(seed || "yoyomusic"));

    this.shape = new Float32Array(BAND_COUNT);
    this.speed = new Float32Array(BAND_COUNT);
    this.phase = new Float32Array(BAND_COUNT);
    this.tilt = new Float32Array(BAND_COUNT);
    this.kickCurve = new Float32Array(BAND_COUNT);

    for (let index = 0; index < BAND_COUNT; index += 1) {
      const ratio = index / (BAND_COUNT - 1);

      this.shape[index] = 0.45 + random() * 0.55;
      this.speed[index] = 0.7 + random() * 3.4;
      this.phase[index] = random() * Math.PI * 2;
      // Pink-ish tilt: real music carries far more energy in the low end.
      // 粉噪式倾斜：真实音乐的能量集中在低频。
      this.tilt[index] = Math.pow(1 - ratio, 1.35) * 0.88 + 0.12;
      this.kickCurve[index] = Math.pow(1 - ratio, 2.2);
    }

    this.bpm = 92 + random() * 46;
    this.reset();
  }

  /** Re-seed in place so the engine instance can follow the current track.
   *  就地重播种，引擎实例可跟随当前曲目切换。 */
  reseed(seed: string) {
    const next = new SignalEngine(seed);
    this.shape.set(next.shape);
    this.speed.set(next.speed);
    this.phase.set(next.phase);
    this.tilt.set(next.tilt);
    this.kickCurve.set(next.kickCurve);
    this.bpm = next.bpm;
    this.time = 0;
    this.beatClock = 0;
    this.beatPulse = 0;
    this.level = 0;
    this.beat = 0;
    this.bands.fill(0);
    this.wave.fill(0);
  }

  /** Decay to the idle floor without wiping the seeded character.
   *  衰减到 idle 底值，不抹掉种子特征。 */
  reset() {
    this.bands.fill(0);
    this.wave.fill(0);
    this.level = 0;
    this.beat = 0;
  }

  /**
   * Advance the simulation. `dt` is in seconds; call once per animation frame.
   * When `isPlaying` is false the spectrum relaxes into a slow idle breath so
   * a paused player still looks alive rather than frozen.
   *
   * `real` is the analysed audio, when there is any. Passing it swaps the
   * targets for the measured ones but keeps this engine's attack/release
   * smoothing, so the bars move the same way whichever source feeds them — and
   * the synthesis stays as the fallback for a paused player and for the browser
   * preview, where there is no Rust core to tap.
   *
   * 推进仿真。`dt` 单位秒，每动画帧调用一次。暂停时频谱松弛成慢速 idle 呼吸，
   * 空播放器仍显活而非僵住。`real` 为真实分析帧：换用测量目标但保留本引擎的
   * attack/release 平滑——条形运动方式与信号来源无关。
   */
  update(dt: number, isPlaying: boolean, real: SignalFrame | null = null): SignalFrame {
    const step = Math.min(Math.max(dt, 0), 0.05);
    this.time += step;

    if (real) {
      this.applyRealFrame(step, real);
      return this;
    }

    const period = 60 / this.bpm;
    this.beatClock += step;
    if (this.beatClock >= period) {
      this.beatClock -= period;
      if (isPlaying) this.beatPulse = 1;
    }
    this.beatPulse *= Math.exp(-step * 6.5);
    this.beat = isPlaying ? this.beatPulse : 0;

    const attack = 1 - Math.exp(-step * 22);
    const release = 1 - Math.exp(-step * 6.5);
    const idleBreath = 1 + Math.sin(this.time * 0.9) * 0.35;
    let sum = 0;

    for (let index = 0; index < BAND_COUNT; index += 1) {
      const ratio = index / (BAND_COUNT - 1);

      const wanderA = 0.5 + 0.5 * Math.sin(this.time * this.speed[index] + this.phase[index]);
      const wanderB = 0.5 + 0.5 * Math.sin(this.time * this.speed[index] * 0.41 + this.phase[index] * 2.3);
      const wanderC = 0.5 + 0.5 * Math.sin(this.time * this.speed[index] * 0.13 + this.phase[index] * 0.7);

      let target =
        (wanderA * 0.5 + wanderB * 0.32 + wanderC * 0.18) *
        this.shape[index] *
        this.tilt[index];

      target += this.beat * this.kickCurve[index] * 0.55;
      // A little high-end sparkle keeps the top bars from sitting dead flat.
      // 一点高频闪动，避免顶端条形死平。
      target += ratio > 0.55 ? this.beat * (ratio - 0.55) * 0.6 : 0;

      if (!isPlaying) {
        // Idle still breathes per band, so an empty player shows a shaped
        // resting spectrum instead of a flat strip.
        // idle 仍逐带呼吸：空播放器显示有形状的静息频谱而非一条扁带。
        target =
          IDLE_FLOOR *
          idleBreath *
          (0.5 + this.shape[index] * 0.9) *
          (0.7 + ratio * 0.6) *
          (0.55 + wanderA * 0.8);
      }

      const clamped = target < 0 ? 0 : target > 1 ? 1 : target;
      const coefficient = clamped > this.bands[index] ? attack : release;
      this.bands[index] += (clamped - this.bands[index]) * coefficient;
      sum += this.bands[index];
    }

    this.level += ((sum / BAND_COUNT) - this.level) * (1 - Math.exp(-step * 8));
    this.updateWave(isPlaying);
    return this;
  }

  /*
   * Smooths a measured frame.
   *
   * The analyser already normalises and detects onsets, but its output arrives
   * at ~30 Hz while this runs at display refresh rate, so the values still need
   * interpolating between arrivals — otherwise the bars would step visibly.
   * Fast attack keeps a kick snappy; the slower release is what stops the whole
   * display from strobing on every transient.
   *
   * 平滑测量帧。分析端已归一化并检测 onset，但其输出约 30Hz 到达而本引擎按显示
   * 刷新率运行，需要在两次到达之间插值——否则条形会肉眼可见地跳变。快 attack
   * 保住 kick 的干脆，慢 release 防止整个显示在每个瞬态上频闪。
   */
  private applyRealFrame(step: number, real: SignalFrame) {
    const attack = 1 - Math.exp(-step * 26);
    const release = 1 - Math.exp(-step * 7);
    let sum = 0;

    for (let index = 0; index < BAND_COUNT; index += 1) {
      const target = Math.max(0, Math.min(1, real.bands[index] ?? 0));
      const coefficient = target > this.bands[index] ? attack : release;
      this.bands[index] += (target - this.bands[index]) * coefficient;
      sum += this.bands[index];
    }

    this.level += ((real.level || sum / BAND_COUNT) - this.level) * (1 - Math.exp(-step * 9));
    this.beat = Math.max(real.beat, this.beat * Math.exp(-step * 7));

    // The oscilloscope is the measured waveform itself — nothing to synthesise.
    // 示波迹就是测量波形本身——无需合成。
    const stride = real.wave.length / WAVE_SAMPLES;
    for (let index = 0; index < WAVE_SAMPLES; index += 1) {
      const source = Math.min(real.wave.length - 1, Math.floor(index * stride));
      const value = real.wave[source] ?? 0;
      this.wave[index] = value < -1 ? -1 : value > 1 ? 1 : value;
    }
  }

  private updateWave(isPlaying: boolean) {
    const drive = isPlaying ? 0.35 + this.level * 1.5 : 0.08;

    for (let index = 0; index < WAVE_SAMPLES; index += 1) {
      const position = index / (WAVE_SAMPLES - 1);
      // Mirror the left half onto the right so the trace stays symmetric.
      // 左半镜像到右半，迹线保持对称。
      const mirrored = position <= 0.5 ? position : 1 - position;

      let value = 0;
      value += Math.sin(mirrored * Math.PI * 2 * 2 + this.time * 2.4) * 0.42;
      value += Math.sin(mirrored * Math.PI * 2 * 5 - this.time * 3.9) * 0.26;
      value += Math.sin(mirrored * Math.PI * 2 * 11 + this.time * 6.7) * 0.15;
      value += Math.sin(mirrored * Math.PI * 2 * 19 - this.time * 9.3) * 0.08;
      value *= drive;
      value += this.beat * Math.sin(mirrored * Math.PI * 2 * 3 + this.time * 4) * 0.12;

      const clamped = value < -1 ? -1 : value > 1 ? 1 : value;
      this.wave[index] = clamped;
    }
  }
}

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
