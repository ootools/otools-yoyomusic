/*
 * Task 9 Step 2 失败测试：Visualizer 交互逻辑（React 组件）。
 *
 * 纯函数：prefersReducedMotion（reduced-motion 单帧标志）。
 * 组件（fake timers）：
 *   - 常规模式挂 rAF 循环，帧数随时间推进增长（dt 钳制 0–0.05）；
 *   - prefers-reduced-motion: reduce 时只画 1 帧、不排 rAF；
 *   - vizRandom 开启时 5–20s 随机区间轮换模式（onModeChange 通知，不写 store），
 *     4999ms 内必不切换、20000ms 内必切换；store 显式切换 vizMode 会清空本地轮换。
 *
 * jsdom 无 canvas 实现：HTMLCanvasElement.getContext 桩成 ctxStub；ResizeObserver
 * 由本文件提供手动 fire 的桩。帧数经由 getFrame 间谍观测（每帧恰好调用一次）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

import { useStore, type StoreState } from '../state/store';
import { makeCtxStub, type CtxStub } from './ctxStub';
import { VIZ_MODES, VIZ_ROTATE_MAX_MS, VIZ_ROTATE_MIN_MS, type VizMode } from './registry';
import { Visualizer, prefersReducedMotion } from './Visualizer';
import type { SignalFrame } from '../signal/engine';

const initial: StoreState = useStore.getState();
const PALETTE = { a: '#8b5cf6', b: '#22d3ee', ink: '#ffffff' };

function makeFrame(): SignalFrame {
  const bands = new Float32Array(56).fill(0.5);
  const wave = new Float32Array(256).fill(0);
  return { bands, wave, level: 0.5, beat: 0.2 };
}

// --- jsdom 环境桩 -----------------------------------------------------------

/** jsdom 无 matchMedia：用 stubGlobal 注入固定 matches 的桩（afterEach 统一 unstub）。 */
function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation(
      (q: string) =>
        ({
          matches,
          media: q,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    ),
  );
}

let ctxStubs: CtxStub[] = [];
let roCallbacks: ResizeObserverCallback[] = [];

class ROStub {
  constructor(cb: ResizeObserverCallback) {
    roCallbacks.push(cb);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** 把指定尺寸灌进画布并触发全部 ResizeObserver 回调。 */
function fireResize(w: number, h: number): void {
  const canvas = document.querySelector('canvas');
  if (!canvas) throw new Error('no canvas mounted');
  Object.defineProperty(canvas, 'clientWidth', { value: w, configurable: true });
  Object.defineProperty(canvas, 'clientHeight', { value: h, configurable: true });
  for (const cb of roCallbacks) cb([], {} as ResizeObserver);
}

function stubCanvasContext(): void {
  // 每个画布元素缓存同一个桩（组件每帧都会 getContext）。
  const cache = new WeakMap<object, CanvasRenderingContext2D>();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    let ctx = cache.get(this);
    if (!ctx) {
      const stub = makeCtxStub();
      ctxStubs.push(stub);
      ctx = stub.ctx;
      cache.set(this, ctx);
    }
    return ctx;
  });
}

beforeEach(() => {
  useStore.setState(initial, true);
  ctxStubs = [];
  roCallbacks = [];
  vi.stubGlobal('ResizeObserver', ROStub);
  stubCanvasContext();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('prefersReducedMotion（reduced-motion 单帧标志）', () => {
  it('matchMedia 报 reduce → true；否则 false', () => {
    stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);

    stubMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe('渲染循环', () => {
  it('常规模式：挂 rAF 循环，时间推进帧数增长', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    const getFrame = vi.fn(makeFrame);
    render(<Visualizer getFrame={getFrame} palette={PALETTE} />);
    fireResize(640, 360);
    const afterMount = getFrame.mock.calls.length;
    expect(afterMount).toBeGreaterThanOrEqual(1); // 挂载即画首帧

    await vi.advanceTimersByTimeAsync(100); // ~6 帧 @60fps
    expect(getFrame.mock.calls.length).toBeGreaterThan(afterMount);
  });

  it('reduced-motion：只画 1 帧，不排 rAF 循环；模式变化时补画一帧', async () => {
    stubMatchMedia(true);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    const getFrame = vi.fn(makeFrame);
    render(<Visualizer getFrame={getFrame} palette={PALETTE} />);
    fireResize(640, 360);
    expect(getFrame.mock.calls.length).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(getFrame.mock.calls.length).toBe(1); // 无循环

    // store 显式切换模式 → 单帧重绘
    act(() => {
      useStore.setState((s) => ({ settings: { ...s.settings, vizMode: 'piano' } }));
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(getFrame.mock.calls.length).toBe(2);
  });
});

describe('模式随机轮换 5–20s（vizRandom 开启时生效，不写 store）', () => {
  function enableRandom(): void {
    act(() => {
      useStore.setState((s) => ({ settings: { ...s.settings, vizRandom: true } }));
    });
  }

  it('vizRandom=false：20000ms 内不切换', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    const onModeChange = vi.fn();
    render(<Visualizer getFrame={makeFrame} palette={PALETTE} onModeChange={onModeChange} />);
    fireResize(640, 360);
    await vi.advanceTimersByTimeAsync(VIZ_ROTATE_MAX_MS + 100);
    expect(onModeChange).not.toHaveBeenCalled();
  });

  it('vizRandom=true：4999ms 内必不切换；20000ms 内必切换到≠当前的模式', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    const onModeChange = vi.fn();
    enableRandom();
    render(<Visualizer getFrame={makeFrame} palette={PALETTE} onModeChange={onModeChange} />);
    fireResize(640, 360);

    await vi.advanceTimersByTimeAsync(VIZ_ROTATE_MIN_MS - 1);
    expect(onModeChange).not.toHaveBeenCalled();

    // 轮换是连续的：再走 20000ms（累计 24999ms）会连续触发 1–3 次
    // （最快 5s 一轮，最慢 20s+5s 才第二轮）。
    await vi.advanceTimersByTimeAsync(VIZ_ROTATE_MAX_MS);
    expect(onModeChange.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(onModeChange.mock.calls.length).toBeLessThanOrEqual(3);
    const next = onModeChange.mock.calls[0][0] as VizMode;
    expect(next).not.toBe('spectrum'); // store 缺省 vizMode='spectrum'
    expect(VIZ_MODES).toContain(next);

    // 持续轮换：再等 20000ms 必再切（次数只增不减）
    const before = onModeChange.mock.calls.length;
    await vi.advanceTimersByTimeAsync(VIZ_ROTATE_MAX_MS);
    expect(onModeChange.mock.calls.length).toBeGreaterThan(before);
  });

  it('轮换不写 store（store.settings.vizMode 保持用户选择）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    enableRandom();
    render(<Visualizer getFrame={makeFrame} palette={PALETTE} />);
    fireResize(640, 360);
    await vi.advanceTimersByTimeAsync(VIZ_ROTATE_MAX_MS * 3);
    expect(useStore.getState().settings.vizMode).toBe('spectrum');
  });

  it('store 显式切换 vizMode：覆盖本地轮换并重置（下一轮换以新模式为基准）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    const onModeChange = vi.fn();
    enableRandom();
    render(<Visualizer getFrame={makeFrame} palette={PALETTE} onModeChange={onModeChange} />);
    fireResize(640, 360);
    await vi.advanceTimersByTimeAsync(VIZ_ROTATE_MAX_MS); // 本地切到 A（连续轮换 1–3 次）
    expect(onModeChange.mock.calls.length).toBeGreaterThanOrEqual(1);

    act(() => {
      useStore.setState((s) => ({ settings: { ...s.settings, vizMode: 'piano' } }));
    });
    await vi.advanceTimersByTimeAsync(VIZ_ROTATE_MAX_MS);
    const last = onModeChange.mock.calls.at(-1)![0] as VizMode;
    expect(last).not.toBe('piano');
  });
});
