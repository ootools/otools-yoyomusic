/**
 * EQ 纯数据（spec §6.2 / 计划 Task 7）。
 *
 * 与 Go 版 audio/eq.go 完全对应：10 段 peaking（31Hz–16kHz，Q=1.414，±12dB），
 * 7 预设逐值照计划（平直/摇滚/流行/古典/重低音/人声/高音）。EQ 关闭 =
 * 各频段 gain 置 0（链路保持，不重建节点）——flat 预设即该基准。
 *
 * 纯数据 + 纯函数，无 Web Audio 依赖（jsdom 单测可直接盖）；
 * 节点施加（BiquadFilterNode）在 engine.ts（Task 16 冒烟覆盖）。
 */

/** 10 段中心频率（Hz）。 */
export const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/**
 * 7 预设，每预设 10 段增益（dB，±12）。计划 Task 7 Interfaces 逐字全值：
 * flat 平直 / rock 摇滚 / pop 流行 / classical 古典 / bass 重低音 /
 * vocal 人声 / treble 高音。
 */
export const EQ_PRESETS = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  rock: [5, 4, 2.5, 0, -1.5, -1, 1, 2.5, 3.5, 4],
  pop: [-1, 1, 3, 4, 3, 1, -0.5, -1, 0, 1.5],
  classical: [3, 2.5, 1.5, 0.5, -0.5, -1, -1.5, 0, 2.5, 3],
  bass: [8, 7, 5.5, 3, 0.5, -1, -2, -2.5, -2, -1.5],
  vocal: [-2.5, -1.5, 0.5, 3, 4.5, 4.5, 3, 1.5, 0, -1],
  treble: [-2, -1.5, 0, 0.5, 1, 2, 3.5, 4.5, 5, 5.5],
} satisfies Record<string, number[]>;

/** 预设名联合（Task 13 EQ 面板下拉用）。 */
export type EqPresetName = keyof typeof EQ_PRESETS;

/** BiquadFilterNode 参数形状（engine.ts 施加到节点）。 */
export interface FilterParams {
  type: 'peaking';
  frequency: number;
  Q: number;
  gain: number;
}

/**
 * 单段滤波器参数：peaking、中心频率 freq、Q=1.414（spec §6.2 逐字）、增益 gain。
 */
export function buildFilterParams(freq: number, gain: number): FilterParams {
  return { type: 'peaking', frequency: freq, Q: 1.414, gain };
}
