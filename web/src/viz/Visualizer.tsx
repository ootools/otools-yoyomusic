/*
 * 可视化画布组件（Task 9）。
 *
 * 只拥有动画循环与画布尺寸（移植件 drawModes/generative/piano 是纯绘制函数）：
 *   - rAF 循环，dt 钳制 0–0.05（移植自 tauri Visualizer 的语义）；
 *   - DPR ≤ 2，ResizeObserver 跟随容器；
 *   - `prefers-reduced-motion: reduce` 时静帧：挂载画 1 帧，模式/尺寸变化补 1 帧，
 *     不排 rAF 循环，也不做随机轮换（轮换本身是运动）；
 *   - 暂停/空闲不停循环：frame getter（Task 8 合成引擎的 applyFrame 包装）持续
 *     给出呼吸帧，本组件不接引擎（Task 10/11 接线）；
 *   - palette 由 props 注入（皮肤 CSS 变量尚未注入——Task 10/11 接线时接 store，
 *     对应 Go 皮肤 VizA/VizB/VizInk）；
 *   - 模式读 store.settings.vizMode（只读不写）；vizRandom 开启时本地 override
 *     以 5–20s 随机区间轮换（Go app.go:139-142），onModeChange 通知宿主，store
 *     的 vizMode 不被写——用户显式切换（store 变化）即清空 override。
 */
import { useEffect, useRef } from 'react';

import type { SignalFrame } from '../signal/engine';
import { useStore } from '../state/store';
import {
  createRenderState,
  drawFrame,
  pickNextViz,
  vizRotateDelay,
  type RenderState,
  type VizMode,
  type VizPalette,
} from './registry';

export type { VizPalette };

export interface VisualizerProps {
  /** 每帧取一次 SignalFrame（真实频谱或 Task 8 合成引擎的呼吸帧）。 */
  getFrame: () => SignalFrame;
  /** 皮肤可视化三色 {a,b,ink}；Task 10/11 接线时从当前 skin 直读。 */
  palette: VizPalette;
  className?: string;
  /** 随机轮换切到新模式时通知宿主（顶栏图标态等）；store 不被写。 */
  onModeChange?: (mode: VizMode) => void;
}

/** reduced-motion 单帧标志（抽纯函数便于测试）。 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** dt 钳制 0–0.05（抽纯函数便于测试）。 */
export function clampDt(seconds: number): number {
  return Math.min(0.05, Math.max(0, seconds));
}

export function Visualizer({ getFrame, palette, className, onModeChange }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // store 只读：vizMode 当前选择、vizRandom 随机轮换开关（spec §10.1）。
  // store.ts 的 VizMode 目前是本地占位 string（TODO(Task 9) 注释：不得反向依赖），
  // 本组件以 registry 的 VizMode 为权威，在读取边界收窄一次。
  const storeMode = useStore((s) => s.settings.vizMode) as VizMode;
  const vizRandom = useStore((s) => s.settings.vizRandom);

  // 最新 props 的 ref：循环免于因闭包过期而重挂。
  const getFrameRef = useRef(getFrame);
  getFrameRef.current = getFrame;
  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  const modeOverrideRef = useRef<VizMode | null>(null); // 随机轮换的本地覆盖
  const storeModeRef = useRef<VizMode>(storeMode);
  storeModeRef.current = storeMode;
  const onModeChangeRef = useRef(onModeChange);
  onModeChangeRef.current = onModeChange;
  const renderStateRef = useRef<RenderState | null>(null);

  const drawOnceRef = useRef<(dt: number) => void>(() => {});
  drawOnceRef.current = (dt: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w <= 0 || h <= 0) return; // 未有尺寸前不合成帧（reduced 挂载早期的空触发）
    const context = canvas.getContext('2d');
    if (!context) return;
    const frame = getFrameRef.current();
    // 频带数变化（引擎口径不同）时重建持久缓冲。
    if (!renderStateRef.current || renderStateRef.current.peaks.length !== frame.bands.length) {
      renderStateRef.current = createRenderState(frame.bands.length);
    }
    const mode = modeOverrideRef.current ?? storeModeRef.current;
    context.clearRect(0, 0, w, h);
    drawFrame(context, w, h, mode, frame, paletteRef.current, renderStateRef.current, dt);
  };

  // 尺寸：DPR≤2 的后备存储 + ResizeObserver；挂载即画首帧（reduced-motion 的
  // "单帧"由此而来），reduced 下尺寸变化也补画一帧。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w <= 0 || h <= 0) return;
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
        canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      drawOnceRef.current(clampDt(1 / 60));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // 动画循环（reduced-motion 不排循环）。dt 由 performance.now 差值钳制。
  useEffect(() => {
    if (prefersReducedMotion()) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = clampDt((now - last) / 1000);
      last = now;
      drawOnceRef.current(dt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // reduced-motion：store 模式变化补画一帧（无循环可依赖）。
  useEffect(() => {
    if (!prefersReducedMotion()) return;
    drawOnceRef.current(clampDt(1 / 60));
  }, [storeMode]);

  // 随机轮换：vizRandom 开启时每 5–20s（随机区间定时器）切到其余 8 个之一。
  // 只改本地 override 并通知宿主，不写 store；用户显式切换（storeMode 变化）
  // 即清空 override；reduced-motion 下不轮换（静帧不该自己动起来）。
  useEffect(() => {
    if (!vizRandom || prefersReducedMotion()) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        if (disposed) return;
        const next = pickNextViz(modeOverrideRef.current ?? storeModeRef.current);
        modeOverrideRef.current = next;
        onModeChangeRef.current?.(next);
        schedule();
      }, vizRotateDelay());
    };
    schedule();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
    // onModeChange 经 ref 读取：内联回调不重置轮换定时器。
  }, [vizRandom, storeMode]);

  // 用户显式切换模式 → 清空随机轮换的本地覆盖，让 store 的选择生效。
  useEffect(() => {
    modeOverrideRef.current = null;
  }, [storeMode]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  );
}
