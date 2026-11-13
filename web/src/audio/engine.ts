/**
 * 播放引擎（spec §6.2/§6.3 / 计划 Task 7）——持有者页内的 `<audio>` + Web Audio 链。
 *
 * 链路（惰性建链，Task 16 冒烟覆盖）：MediaElementSource → Gain(音量/静音) →
 * 10×BiquadFilter(peaking Q=1.414 串联) → Analyser(fftSize 4096) → destination。
 * EQ 关闭 = 各频段 gain 全 0（链路保持，不重建节点，spec §6.2）。
 * jsdom 无 WebAudio：建链失败/缺失时 `<audio>` 直出（el.volume/el.muted 控音），
 * 引擎其余功能（load/play/seek/事件钩子/预读）不受影响——单测只盖纯函数，
 * 实链行为列入 Task 16 宿主冒烟（docs/superpowers/plans Task 16 步骤 ③）。
 *
 * 事件驱动（Review Focus #5）：推进/回填只依赖媒体元素事件 ended/error/timeupdate
 * ——隐藏窗口照发，不依赖 setInterval/rAF 定时器。timeupdate 经 500ms 粒度
 * 节流（leading）上报 onTime；seek 后 250ms 内不从时钟回填（Go scrubHold，
 * spec §6.2）。
 *
 * 传输契约（Task 6）：resolve 产出的 blob: URL 一经消费即归引擎所有，换曲
 * load() 时由引擎 revoke 上一首；blob: 之外的 URL 不属引擎（不 revoke）。
 * 加载/解码失败由元素 error 事件 → onError 钩子（接线层标 TrackBad + 提示）。
 *
 * 预读（Review Focus #1）：load 落地后按 store 预判 advance(1) 的下一首
 * （当前歌单 playMode + currentIndex 经 logic.nextIndex），命中即
 * transport.prime(nextPath) 后台整读——连点下一首时 resolve 命中零等待。
 *
 * 归属协议（spec §5.3，接线归 Task 15）：takeOver(epoch) 本实例成为归属方
 * （解除挂起；takeover 总线广播由 ownership 层发，engine 无 bus 依赖）；
 * suspend() 被接管挂起 = pause + 不再驱动（play/pause/seek/load 短路、
 * 钩子不再上报）。接线契约：接管方先 takeOver(epoch) 再 load/play；
 * resolve 完成后须复核 store.playback.trackId 仍是目标曲目再 load（连点竞态）。
 */

import { nextIndex } from '../state/logic';
import type { StoreState } from '../state/store';
import { buildFilterParams, EQ_FREQS, type FilterParams } from './eq';
import type { BlobTransport } from './transport';

/** 频谱原始帧（spec §6.3：喂给 Task 8 折带/节拍；bins=频域、wave=时域）。 */
export interface AnalyserFrame {
  bins: Uint8Array;
  wave: Uint8Array;
  sampleRate: number;
}

export interface AudioEngineDeps {
  /** Blob 传输层：换曲 revoke + 下一首 prime 预读（Task 6 契约，接线层注入单例）。 */
  transport: BlobTransport;
  /**
   * store 读取器（注入便于测试）：预读时查当前歌单/曲目，构造时读音量/静音/EQ 初值。
   * Task 15 接线传 `() => useStore.getState()`；缺省（undefined）→ 不预读。
   */
  getStore?: () => StoreState | null;
}

/** 事件驱动钩子（接线层落地 store 推进：ended→advance、error→TrackBad、time→回填）。 */
export interface AudioEngineHooks {
  onEnded(): void;
  onError(): void;
  onTime(ms: number): void;
}

/** timeupdate 上报粒度（spec §6.2：500ms 粒度刷新状态）。 */
const TIME_EMIT_MS = 500;
/** seek 后不从时钟回填的窗口（Go scrubHold，spec §6.2）。 */
const SCRUB_HOLD_MS = 250;
/** EQ 增益钳制（dB），与 store clampBands 同口径。 */
const EQ_GAIN_LIMIT = 12;

/**
 * 取消静音且音量为 0 → 恢复 0.5（spec §6.2，Go ToggleMute app.go:495-505
 * "Unmuting restores the previous volume when it had been dragged to zero"）。
 * 其余情况音量不动：Go 口径 Volume<=0 都算"被拖到 0"。
 */
export function unmuteVolume(v: number, muted: boolean, newMuted: boolean): number {
  if (muted && !newMuted && v <= 0) return 0.5;
  return v;
}

/**
 * 是否记录播放恢复点（spec §6.2 / Go SetResume：≤5s 或距结尾 2s 内不记——
 * 片头与"播放完≠断点"）。与 store.recordResume 同口径：未知时长（durMs<=0）
 * 只按 >5s 判定。
 */
export function shouldRecordResume(posMs: number, durMs: number): boolean {
  if (!(posMs > 5000)) return false;
  if (durMs > 0 && durMs - posMs <= 2000) return false;
  return true;
}

/** Web Audio 图节点集（惰性建立后常驻）。 */
interface AudioGraph {
  ctx: AudioContext;
  gain: GainNode;
  filters: BiquadFilterNode[];
  analyser: AnalyserNode;
}

/** EQ 段值归一：长度裁到 10、非数值归 0、逐项钳 ±12（store clampBands 同口径）。 */
function normalizeGains(gains: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < EQ_FREQS.length; i++) {
    const v = Number.isFinite(gains[i]) ? (gains[i] as number) : 0;
    out.push(Math.min(EQ_GAIN_LIMIT, Math.max(-EQ_GAIN_LIMIT, v)));
  }
  return out;
}

/** buildFilterParams 施加到 BiquadFilterNode（仅 Web Audio 就绪时调用）。 */
function applyFilterParams(node: BiquadFilterNode, p: FilterParams): void {
  node.type = p.type;
  node.frequency.value = p.frequency;
  node.Q.value = p.Q;
  node.gain.value = p.gain;
}

export class AudioEngine {
  private readonly el: HTMLAudioElement;
  private readonly deps: AudioEngineDeps;

  /**
   * 频谱帧数据源（spec §6.3 / 计划 Task 7 构造注入）：可视化（Task 9）经此拉帧。
   * 引擎自有 AnalyserNode 就绪 → 读真实频谱（Task 16 冒烟覆盖）；不可用
   * （jsdom / 浏览器直开无 WebAudio / 建链失败）→ 回退构造注入的源——Task 8/15
   * 可注入合成信号（spec §6.3 合成分支：无实时频谱与 idle 呼吸）或测试桩。
   */
  readonly getAnalyserFrame: () => AnalyserFrame | null;

  private hooks: AudioEngineHooks | null = null;
  /** 被接管挂起：pause + 不再驱动（spec §5.3 "静音挂起"由暂停达成）。 */
  private suspended = false;
  private epoch = 0;

  // —— 控制状态（构造时从 store 取初值；接线层经 set* 镜像）——
  private volume = 1;
  private muted = false;
  private eqEnabled = false;
  private eqGains: number[] = EQ_FREQS.map(() => 0);

  // —— Web Audio 图（惰性；Task 16 冒烟覆盖）——
  private graph: AudioGraph | null = null;
  /** 建链失败永久闩锁（审查非阻塞 #2）：构造抛过一次异常后不再重试，直控降级。 */
  private graphFailed = false;
  private freqBuf = new Uint8Array(0);
  private waveBuf = new Uint8Array(0);

  // —— 当前持有（换曲 revoke 的对象）——
  private currentUrl: string | null = null;
  private currentTrackId: string | null = null;

  // —— 事件驱动节流 ——
  private lastTimeEmit = 0;
  private scrubHoldUntil = 0;
  private listenersAttached = false;

  constructor(
    el: HTMLAudioElement,
    getAnalyserFrame: () => AnalyserFrame | null,
    deps: AudioEngineDeps,
  ) {
    this.el = el;
    this.deps = deps;
    // 优先自有 AnalyserNode（真实频谱），不可用回退注入源（见字段注）。
    this.getAnalyserFrame = () => this.readOwnFrame() ?? getAnalyserFrame();

    // 构造即对齐 store 初值（音量/静音/EQ），接线层无需记得再 sync 一次。
    const store = deps.getStore?.();
    if (store) {
      this.volume = store.playback.volume;
      this.muted = store.playback.muted;
      this.eqEnabled = store.playback.eqEnabled;
      this.eqGains = normalizeGains(store.playback.eqBands);
    }
    this.applyVolume(); // 无图 → 落到 el.volume/el.muted（jsdom 安全）
  }

  // —— 归属（spec §5.3；总线广播归 Task 15 ownership 层）——

  /** 本实例接管播放归属：记录 epoch、解除挂起。不自动恢复播放（接线层 load/play）。 */
  takeOver(epoch: number): void {
    this.epoch = epoch;
    this.suspended = false;
  }

  /** 被接管挂起：pause + 不再驱动（play/pause/seek/load 短路、钩子不上报）。 */
  suspend(): void {
    this.suspended = true;
    this.el.pause();
  }

  get isSuspended(): boolean {
    return this.suspended;
  }

  get ownerEpoch(): number {
    return this.epoch;
  }

  get playingTrackId(): string | null {
    return this.currentTrackId;
  }

  // —— 曲目装载（换曲 revoke 契约 + 预读）——

  /**
   * 装载曲目（url 由接线层 transport.resolve 产出）。换曲时 revoke 上一首
   * 消费过的 blob: URL（blob: 之外不属引擎）；同 URL 重赋（repeat_one 重播）
   * 不 revoke 且赋值即重启媒体加载。blob: 之外的加载/解码失败经元素 error
   * 事件走 onError 钩子。
   */
  load(url: string, trackId: string): void {
    if (this.suspended) return; // 被接管：不再驱动
    if (this.currentUrl && this.currentUrl !== url) this.releaseHeldUrl();
    this.currentUrl = url;
    this.currentTrackId = trackId;
    this.el.src = url; // 赋值即触发媒体加载算法（同值重赋也会重启加载 → 重播可用）
    this.lastTimeEmit = 0; // 新曲首个 timeupdate 立即上报
    this.scrubHoldUntil = 0;
    this.primeNext(); // Review Focus #1：load 落地即后台预读下一首
  }

  /** 释放引擎持有的上一首 URL：仅限 blob:（transport 只产 blob:，blob: 之外不归引擎）。 */
  private releaseHeldUrl(): void {
    const url = this.currentUrl;
    this.currentUrl = null;
    if (!url || !url.startsWith('blob:')) return;
    this.deps.transport.revoke(url);
  }

  /**
   * 预读下一首（Review Focus #1）：按 store 预判 advance(1) 结果（当前歌单
   * playMode + currentIndex，经 logic.nextIndex 与 store.advance 同口径），
   * 有下一首且不是当前曲 → transport.prime(nextPath)。repeat_one/到尾/
   * 空歌单不预读。
   */
  private primeNext(): void {
    const store = this.deps.getStore?.();
    if (!store) return;
    const lib = store.library;
    const pl = lib.playlists[lib.currentPlaylist] ?? lib.playlists.default;
    if (!pl || pl.trackIds.length === 0) return;
    const mode = pl.playMode;
    if (mode === 'repeat_one') return; // 原地重来：同一 URL 已持有，无需预读
    const idx = nextIndex(mode, pl.currentIndex, pl.trackIds.length);
    if (idx === -1) return; // sequence 到尾 → advance 停止，无下一首
    const id = pl.trackIds[idx];
    if (!id || id === store.playback.trackId) return;
    const path = lib.tracks[id]?.path;
    if (path) this.deps.transport.prime(path);
  }

  // —— 播放控制 ——

  /** 在点击手势内解锁音频图；文件异步读取不应丢掉用户激活。 */
  prepare(): void {
    const graph = this.ensureGraph();
    if (graph) void graph.ctx.resume().catch(() => {});
  }

  play(): Promise<void> {
    if (this.suspended) return Promise.resolve();
    this.prepare();
    // 向协调层传播 autoplay 拒绝，不能先把播放状态假设为成功。
    return Promise.resolve(this.el.play());
  }

  pause(): void {
    if (this.suspended) return; // 被接管：不再驱动
    this.el.pause();
  }

  /** seek（ms）：直接设 currentTime；250ms 内不从时钟回填（Go scrubHold）。 */
  seek(ms: number): void {
    if (this.suspended) return; // 被接管：不再驱动
    this.scrubHoldUntil = Date.now() + SCRUB_HOLD_MS;
    try {
      this.el.currentTime = Math.max(0, ms) / 1000;
    } catch {
      // HAVE_NOTHING 等浏览器差异：忽略（元数据就绪后由 UI 重试）
    }
  }

  setVolume(v: number): void {
    const volume = Math.min(1, Math.max(0, v)); // Go SetVolume 钳制
    this.volume = volume;
    this.applyVolume();
  }

  /**
   * 静音：取消静音且 v=0 → 恢复 0.5（经 unmuteVolume 纯函数，spec §6.2）。
   */
  setMuted(b: boolean): void {
    const restored = unmuteVolume(this.volume, this.muted, b);
    this.muted = b;
    if (restored !== this.volume) this.volume = restored; // 0 → 0.5
    this.applyVolume();
  }

  /** EQ 开关 + 10 段增益：关闭 = gain 全 0（链路保持，spec §6.2）。 */
  setEQ(enabled: boolean, gains: number[]): void {
    this.eqEnabled = enabled;
    this.eqGains = normalizeGains(gains);
    this.applyEQ();
  }

  // —— 事件驱动钩子（Review Focus #5：媒体元素事件，隐藏窗口照发）——

  /**
   * 挂接 store 推进钩子：ended→onEnded（接线层 advance）、error→onError
   * （接线层标 TrackBad + 提示）、timeupdate→onTime（500ms 粒度节流）。
   * 监听器只挂一次，重复调用仅替换钩子。
   */
  attachStoreHooks(h: AudioEngineHooks): void {
    this.hooks = h;
    if (this.listenersAttached) return;
    this.listenersAttached = true;
    this.el.addEventListener('ended', this.handleEnded);
    this.el.addEventListener('error', this.handleError);
    this.el.addEventListener('timeupdate', this.handleTimeupdate);
  }

  private handleEnded = (): void => {
    if (this.suspended) return; // 被接管：不再驱动
    this.hooks?.onEnded();
  };

  private handleError = (): void => {
    if (this.suspended) return; // 被接管：不再驱动
    this.hooks?.onError(); // 接线层标 TrackBad + PushError 提示（spec §6.2）
  };

  private handleTimeupdate = (): void => {
    if (this.suspended) return; // 被接管：不再驱动
    const now = Date.now();
    if (now < this.scrubHoldUntil) return; // scrub 期间不从时钟回填（Go scrubHold）
    if (now - this.lastTimeEmit < TIME_EMIT_MS) return; // 500ms 粒度节流（leading）
    this.lastTimeEmit = now;
    this.hooks?.onTime(Math.round(this.el.currentTime * 1000));
  };

  // —— Web Audio（实链路：Task 16 冒烟覆盖，jsdom 无 WebAudio 不进此路径）——

  /**
   * Task 16 冒烟覆盖：Web Audio 实链路（MediaElementSource→Gain→10×BiquadFilter
   * →Analyser→destination，spec §6.2/§6.3）。惰性建链：首次 play（用户手势内）
   * 或首次拉频谱帧时；环境无 AudioContext（jsdom/老宿主）或建链失败 → null，
   * `<audio>` 直出，EQ/频谱降级但播放不炸。建链失败（构造抛异常）落
   * graphFailed 永久闩锁：此后不再重试构造（避免每次 play/拉帧重复抛栈），
   * 直接走直控降级。
   */
  private ensureGraph(): AudioGraph | null {
    if (this.graph) return this.graph;
    if (this.graphFailed) return null; // 永久闩锁：直控降级
    const win = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const Ctor = win.AudioContext ?? win.webkitAudioContext;
    if (typeof Ctor !== 'function') return null;
    try {
      const ctx = new Ctor();
      const source = ctx.createMediaElementSource(this.el);
      const gain = ctx.createGain();
      const filters = EQ_FREQS.map((freq) => {
        const f = ctx.createBiquadFilter();
        applyFilterParams(f, buildFilterParams(freq, 0)); // peaking Q=1.414（spec §6.2）
        return f;
      });
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096; // spec §6.3：频域 2048 bins / 时域 4096 点
      source.connect(gain);
      let node: AudioNode = gain;
      for (const f of filters) {
        node.connect(f);
        node = f;
      }
      node.connect(analyser);
      analyser.connect(ctx.destination);
      this.freqBuf = new Uint8Array(analyser.frequencyBinCount);
      this.waveBuf = new Uint8Array(analyser.fftSize);
      this.graph = { ctx, gain, filters, analyser };
      // 图就绪后音量/静音改走 GainNode（el 归 1，避免双重衰减），EQ 增益补施加。
      this.applyVolume();
      this.applyEQ();
      return this.graph;
    } catch {
      this.graphFailed = true; // 永久闩锁（审查非阻塞 #2）：只尝试一次，直控降级
      return null; // 元素已绑定其他 context 等：降级 `<audio>` 直出
    }
  }

  /**
   * Task 16 冒烟覆盖：音量/静音施加。有图 → GainNode（el.volume=1、el.muted=false，
   * 避免 el.volume 与 gain 双重衰减）；无图 → el.volume/el.muted 直控。
   */
  private applyVolume(): void {
    const graph = this.graph;
    if (graph) {
      graph.gain.gain.value = this.muted ? 0 : this.volume;
      if (this.el.volume !== 1) this.el.volume = 1;
      if (this.el.muted) this.el.muted = false;
    } else {
      this.el.volume = this.volume;
      this.el.muted = this.muted;
    }
  }

  /** Task 16 冒烟覆盖：EQ 增益施加（关闭 = 全 0，链路保持）；无图时参数暂存待建链。 */
  private applyEQ(): void {
    const graph = this.graph;
    if (!graph) return;
    for (let i = 0; i < graph.filters.length; i++) {
      graph.filters[i]!.gain.value = this.eqEnabled ? (this.eqGains[i] ?? 0) : 0;
    }
  }

  /** Task 16 冒烟覆盖：读自有 AnalyserNode 原始帧（复用缓冲，消费方按帧就地使用）。 */
  private readOwnFrame(): AnalyserFrame | null {
    const graph = this.ensureGraph();
    if (!graph) return null;
    graph.analyser.getByteFrequencyData(this.freqBuf);
    graph.analyser.getByteTimeDomainData(this.waveBuf);
    return { bins: this.freqBuf, wave: this.waveBuf, sampleRate: graph.ctx.sampleRate };
  }

  /** 页面退出时清理媒体、音频图和本页瞬态 Blob，不影响其它窗口。 */
  dispose(): void {
    this.suspended = true;
    this.el.pause();
    this.el.removeEventListener('ended', this.handleEnded);
    this.el.removeEventListener('error', this.handleError);
    this.el.removeEventListener('timeupdate', this.handleTimeupdate);
    this.el.removeAttribute('src');
    this.releaseHeldUrl();
    this.hooks = null;
    this.graph?.gain.disconnect();
    this.graph?.analyser.disconnect();
    for (const filter of this.graph?.filters ?? []) filter.disconnect();
    if (this.graph) void this.graph.ctx.close().catch(() => {});
    this.graph = null;
  }
}
