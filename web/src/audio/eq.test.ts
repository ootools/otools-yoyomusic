/**
 * Task 7 Step 1 失败测试：EQ 纯数据（计划 Task 7 逐字条目）。
 *  - EQ_FREQS 10 段精确值；
 *  - EQ_PRESETS 恰 7 预设（平直/摇滚/流行/古典/重低音/人声/高音）各 10 项、
 *    逐值照计划、全在 [-12,12]、flat 全 0；
 *  - buildFilterParams 返回 {type:'peaking', frequency, Q:1.414, gain}。
 */
import { describe, expect, it } from 'vitest';

import { buildFilterParams, EQ_FREQS, EQ_PRESETS, type EqPresetName } from './eq';

describe('EQ_FREQS', () => {
  it('10 段精确值 31/62/125/250/500/1k/2k/4k/8k/16k（spec §6.2）', () => {
    expect(EQ_FREQS).toEqual([31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
  });
});

describe('EQ_PRESETS（计划逐字全值）', () => {
  /** 计划 Task 7 Interfaces 逐字抄录的期望值。 */
  const EXPECTED: Record<EqPresetName, number[]> = {
    flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    rock: [5, 4, 2.5, 0, -1.5, -1, 1, 2.5, 3.5, 4],
    pop: [-1, 1, 3, 4, 3, 1, -0.5, -1, 0, 1.5],
    classical: [3, 2.5, 1.5, 0.5, -0.5, -1, -1.5, 0, 2.5, 3],
    bass: [8, 7, 5.5, 3, 0.5, -1, -2, -2.5, -2, -1.5],
    vocal: [-2.5, -1.5, 0.5, 3, 4.5, 4.5, 3, 1.5, 0, -1],
    treble: [-2, -1.5, 0, 0.5, 1, 2, 3.5, 4.5, 5, 5.5],
  };

  it('恰好 7 个预设（平直/摇滚/流行/古典/重低音/人声/高音）', () => {
    expect(Object.keys(EQ_PRESETS).sort()).toEqual(
      ['bass', 'classical', 'flat', 'pop', 'rock', 'treble', 'vocal'],
    );
  });

  it('每预设 10 项且逐值精确照计划', () => {
    for (const name of Object.keys(EXPECTED) as EqPresetName[]) {
      expect(EQ_PRESETS[name]).toEqual(EXPECTED[name]);
    }
  });

  it('全在 [-12,12]（计划：±12dB）', () => {
    for (const bands of Object.values(EQ_PRESETS)) {
      expect(bands).toHaveLength(10);
      for (const v of bands) {
        expect(v).toBeGreaterThanOrEqual(-12);
        expect(v).toBeLessThanOrEqual(12);
      }
    }
  });

  it('flat 全 0（EQ 关闭 = 各频段 gain 0、链路保持的基准）', () => {
    expect(EQ_PRESETS.flat).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('buildFilterParams', () => {
  it('返回 {type:"peaking", frequency, Q:1.414, gain}（spec §6.2）', () => {
    expect(buildFilterParams(31, 0)).toEqual({ type: 'peaking', frequency: 31, Q: 1.414, gain: 0 });
    expect(buildFilterParams(1000, 12)).toEqual({ type: 'peaking', frequency: 1000, Q: 1.414, gain: 12 });
    expect(buildFilterParams(16000, -1.5)).toEqual({ type: 'peaking', frequency: 16000, Q: 1.414, gain: -1.5 });
  });
});
