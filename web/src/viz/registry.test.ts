/*
 * Task 9 Step 2 失败测试：viz/registry（模式目录 + drawFrame 分发 + 随机轮换纯函数）。
 * 覆盖计划 Task 9 Step 2 逐字条目：VIZ_MODES.length===9、顺序与 VIZ_LABELS 对齐、
 * drawFrame 对 9 模式各跑 1 帧不抛（offscreen ctx stub）、generative 30 帧×3 组合不抛。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import type { SignalFrame } from '../signal/engine';
import { makeCtxStub } from './ctxStub';
import {
  VIZ_LABELS,
  VIZ_MODES,
  VIZ_ROTATE_MAX_MS,
  VIZ_ROTATE_MIN_MS,
  createRenderState,
  drawFrame,
  pickNextViz,
  vizRotateDelay,
  type RenderState,
  type VizMode,
} from './registry';

const PALETTE = { a: '#8b5cf6', b: '#22d3ee', ink: '#ffffff' };
const PALETTES = [
  PALETTE,
  { a: '#f59e0b', b: '#ef4444', ink: '#fff7ed' },
  { a: '#34d399', b: '#0ea5e9', ink: '#ecfeff' },
];

let seq = 0;
/** 确定性的伪随机帧：低频强、往高频衰减，wave 是低幅正弦。 */
function makeFrame(): SignalFrame {
  seq += 1;
  const bands = new Float32Array(56);
  for (let i = 0; i < 56; i += 1) bands[i] = Math.max(0, 0.9 - i / 62 + 0.05 * Math.sin(seq + i));
  const wave = new Float32Array(256);
  for (let i = 0; i < 256; i += 1) wave[i] = 0.4 * Math.sin((i / 256) * Math.PI * 8 + seq * 0.3);
  return { bands, wave, level: 0.6, beat: seq % 24 === 0 ? 0.9 : 0.05 };
}

describe('VIZ_MODES / VIZ_LABELS（计划 Interfaces 逐字）', () => {
  it('9 个模式，顺序与计划一致（含 piano 收尾）', () => {
    expect(VIZ_MODES).toEqual([
      'spectrum',
      'waveform',
      'radial',
      'aurora',
      'particles',
      'waterfall',
      'generative',
      'kaleidoscope',
      'piano',
    ]);
    expect(VIZ_MODES).toHaveLength(9);
  });

  it('VIZ_LABELS 与 VIZ_MODES 对齐，中文标签照抄 Go app.go vizLabels', () => {
    const expected = [
      '频谱柱',
      '示波波形',
      '环形律动',
      '音浪绸带',
      '粒子星尘',
      '镜像瀑布',
      '生成动画',
      '万花筒',
      '钢琴',
    ];
    expect(VIZ_MODES.map((m) => VIZ_LABELS[m])).toEqual(expected);
    expect(Object.keys(VIZ_LABELS).sort()).toEqual([...VIZ_MODES].sort());
  });
});

describe('drawFrame 分发', () => {
  let state: RenderState;

  beforeEach(() => {
    state = createRenderState(56);
  });

  it('createRenderState：聚合各模式持久缓冲（含 piano 双缓冲）', () => {
    expect(state.peaks).toHaveLength(56);
    expect(state.waterfall).toHaveLength(72 * 56);
    expect(state.particles).toEqual([]);
    expect(state.generative).toBeTruthy();
    expect(state.piano.w).toHaveLength(14);
    expect(state.piano.b).toHaveLength(10);
  });

  it('9 种模式各跑 1 帧不抛（offscreen ctx stub）', () => {
    for (const mode of VIZ_MODES) {
      const { ctx } = makeCtxStub();
      expect(() => drawFrame(ctx, 640, 360, mode, makeFrame(), PALETTE, state, 1 / 60)).not.toThrow();
    }
  });

  it('generative：3 组模式组合各跑 30 帧不抛（纯 generative 组触发场景轮换）', () => {
    const combos: VizMode[][] = [
      ['generative', 'generative', 'generative'], // 30×0.7s=21s > 16s，触发场景轮换+交叉淡化
      ['spectrum', 'generative', 'waterfall'],
      ['generative', 'piano', 'kaleidoscope'],
    ];
    for (const combo of combos) {
      const st = createRenderState(56);
      for (let f = 0; f < 30; f += 1) {
        const mode = combo[f % combo.length];
        const pal = PALETTES[f % PALETTES.length];
        expect(() => drawFrame(makeCtxStub().ctx, 640, 360, mode, makeFrame(), pal, st, 0.7)).not.toThrow();
      }
    }
  });

  it('piano：按住不松跑 60 帧，键压缓冲被推进且钳 0..1', () => {
    const { ctx } = makeCtxStub();
    const st = createRenderState(56);
    for (let f = 0; f < 60; f += 1) {
      drawFrame(ctx, 640, 360, 'piano', makeFrame(), PALETTE, st, 1 / 60);
    }
    for (const v of st.piano.w) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('随机轮换纯函数（Go app.go:139-142 vizRandomMin/Max 5–20s）', () => {
  it('vizRotateDelay：rand=0 → 5s 下限，rand→1 → 20s 上限，单调', () => {
    expect(vizRotateDelay(() => 0)).toBe(VIZ_ROTATE_MIN_MS);
    expect(VIZ_ROTATE_MIN_MS).toBe(5000);
    expect(VIZ_ROTATE_MAX_MS).toBe(20000);
    expect(vizRotateDelay(() => 0.9999)).toBeLessThanOrEqual(VIZ_ROTATE_MAX_MS);
    expect(vizRotateDelay(() => 0.5)).toBe(12500);
    let prev = 0;
    for (const r of [0, 0.25, 0.5, 0.75, 0.99]) {
      const d = vizRotateDelay(() => r);
      expect(d).toBeGreaterThan(prev);
      prev = d;
    }
  });

  it('pickNextViz：永不选中当前模式，且只从其余 8 个里挑', () => {
    for (const current of VIZ_MODES) {
      for (let i = 0; i < 64; i += 1) {
        const next = pickNextViz(current, () => 0.999);
        expect(next).not.toBe(current);
        expect(VIZ_MODES).toContain(next);
      }
      // rand=0 → 第一个非当前模式
      expect(pickNextViz(current, () => 0)).toBe(VIZ_MODES.find((m) => m !== current));
    }
    // 全覆盖：足够多次后除 current 外都出现过
    const seen = new Set<VizMode>();
    for (let i = 0; i < 500; i += 1) seen.add(pickNextViz('piano', Math.random));
    expect(seen.size).toBe(8);
    expect(seen.has('piano')).toBe(false);
  });
});
