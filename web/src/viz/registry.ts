/*
 * 可视化注册表（Task 9）。
 *
 * 聚合移植的 8 种模式（drawModes.ts 的 7 种绘制 + generative.ts 的单模式 5 场景
 * 内轮换）与新写的 3D 钢琴（piano.ts），对 UI 暴露计划 Interfaces 逐字的三件套：
 *   VIZ_MODES（9 项含 'piano'）、VIZ_LABELS（中文标签照抄 Go app.go vizLabels）、
 *   drawFrame(ctx,w,h,mode,frame,palette,state,dt) 统一分发。
 *
 * RenderState 聚合各模式的持久缓冲（峰值/瀑布历史/粒子/旋转/生成场景状态/
 * 钢琴键压缓冲），由 Visualizer 每画布创建一次。
 *
 * 顶栏"随机切换可视化"的纯逻辑也在这里：随机区间 5–20s（Go app.go:139-142
 * vizRandomMin/Max）只轮换 9 个模式项；generative 的 5 场景 16–27s 内部轮换
 * 与之互不干扰（spec §7 拍板）。
 */

import { createRenderState as createBaseRenderState, drawSpectrum, drawWaveform, drawRadial, drawAurora, drawParticles, drawWaterfall, drawKaleidoscope, type DrawContext, type RenderState as BaseRenderState, type VizPalette } from './drawModes';
import { drawGenerative } from './generative';
import { visualizationModes } from './modes';
import { createPianoState, drawPiano, type PianoState } from './piano';
import type { SignalFrame } from '../signal/engine';

/** 9 个可视化模式项；generative 是单个模式项（5 场景内部自转），piano 收尾。 */
export const VIZ_MODES = [
  'spectrum',
  'waveform',
  'radial',
  'aurora',
  'particles',
  'waterfall',
  'generative',
  'kaleidoscope',
  'piano',
] as const;

export type VizMode = (typeof VIZ_MODES)[number];

/** 中文标签，照抄 Go app.go vizLabels（aurora 在 Go 里叫"音浪绸带"）。 */
export const VIZ_LABELS: Record<VizMode, string> = Object.fromEntries(
  visualizationModes.map((m) => [m.id, m.label]),
) as Record<VizMode, string>;

/** 模式提示语（移植自 tauri modes.ts，供菜单 hover 用）。 */
export const VIZ_HINTS: Record<VizMode, string> = Object.fromEntries(
  visualizationModes.map((m) => [m.id, m.hint]),
) as Record<VizMode, string>;

/** 聚合各模式持久缓冲的渲染状态（= 移植件 RenderState + piano 双缓冲）。 */
export interface RenderState extends BaseRenderState {
  piano: PianoState;
}

export function createRenderState(bandCount: number): RenderState {
  return { ...createBaseRenderState(bandCount), piano: createPianoState() };
}

export type { VizPalette };

/**
 * 按模式分发一帧。dt 由调用方（Visualizer）钳制 0–0.05 后传入；本函数不钳。
 * piano 吃的是同一 RenderState 的 piano 槽（键压缓冲跨帧持久）。
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  mode: VizMode,
  frame: SignalFrame,
  palette: VizPalette,
  state: RenderState,
  dt: number,
): void {
  const draw: DrawContext = { context: ctx, width: w, height: h, frame, palette, state, dt };
  switch (mode) {
    case 'spectrum':
      drawSpectrum(draw);
      break;
    case 'waveform':
      drawWaveform(draw);
      break;
    case 'radial':
      drawRadial(draw);
      break;
    case 'aurora':
      drawAurora(draw);
      break;
    case 'particles':
      drawParticles(draw);
      break;
    case 'waterfall':
      drawWaterfall(draw);
      break;
    case 'generative':
      drawGenerative(draw);
      break;
    case 'kaleidoscope':
      drawKaleidoscope(draw);
      break;
    case 'piano':
      drawPiano(ctx, w, h, frame, palette, state.piano, dt);
      break;
  }
}

// --- 模式级随机轮换（Go app.go:139-142）--------------------------------------

/** 随机轮换区间的两端，毫秒：背景每 5–20s 换一个模式项。 */
export const VIZ_ROTATE_MIN_MS = 5000;
export const VIZ_ROTATE_MAX_MS = 20000;

/** 下一次轮换的延迟：均匀落在 [5s, 20s)，rand 注入以便测试。 */
export function vizRotateDelay(rand: () => number = Math.random): number {
  return VIZ_ROTATE_MIN_MS + rand() * (VIZ_ROTATE_MAX_MS - VIZ_ROTATE_MIN_MS);
}

/** 从其余 8 个模式里随机挑一个（永不原地踏步），rand 注入以便测试。 */
export function pickNextViz(current: VizMode, rand: () => number = Math.random): VizMode {
  const pool = VIZ_MODES.filter((m) => m !== current);
  return pool[Math.floor(rand() * pool.length)];
}
