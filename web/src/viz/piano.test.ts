/*
 * Task 9 Step 2 失败测试：piano.ts 纯几何/状态函数。
 *
 * 对照 Go 版 internal/ui/viz.go:652-1033（钢琴段）与 internal/ui/viz_piano_test.go
 * 的不变量：14 白 + 10 黑、透视收窄（远端 = 近端×0.82）、按下绕远端 pivot、
 * beat 全键沉（白 0.10 / 黑 0.08）、快攻 lerp 0.5 / 慢放 0.6/s、24 键到 56 带的
 * 单调映射（低频在左）、切片数 5–20、布局 clamp 公式。
 */
import { describe, expect, it } from 'vitest';

import {
  KB_BACK_V,
  KB_NARROW,
  beatDip,
  blackBandIndex,
  blackShade,
  createPianoState,
  keyBandIndex,
  keyPress,
  keyRelease,
  keyY,
  kbBlackAfter,
  kbBlackCount,
  kbSlices,
  kbWhiteCount,
  pianoLayout,
  type RGB,
  pressLevel,
  projectKey,
  whiteShade,
  type PressState,
} from './piano';

const CANVAS = { x: 0, y: 0, w: 560, h: 420 };

describe('键数（viz.go:671-672 whiteKeys/blackKeys）', () => {
  it('kbWhiteCount()===14、kbBlackCount()===10，两八度', () => {
    expect(kbWhiteCount()).toBe(14);
    expect(kbBlackCount()).toBe(10);
    expect(kbWhiteCount() + kbBlackCount()).toBe(24);
  });

  it('黑键宿主表 two octaves of 0,1,3,4,5（viz.go:823 blackAfter）', () => {
    expect(kbBlackAfter()).toEqual([0, 1, 3, 4, 5, 7, 8, 10, 11, 12]);
  });
});

describe('投影（viz.go:729-744 whiteHalf 的收窄因子）', () => {
  it('projectKey：远端 x 收窄 = 近端×0.82（kbNarrow 18%）', () => {
    expect(projectKey(100, 1, 0)).toBeCloseTo(100 * (1 - KB_NARROW));
    expect(projectKey(100, 1, 0)).toBeCloseTo(82);
    expect(projectKey(100, 1, 1)).toBeCloseTo(100);
    expect(projectKey(100, 1, 0.5)).toBeCloseTo(91);
  });

  it('projectKey 双向一致：从近端投到远端再投回来等于原宽', () => {
    expect(projectKey(projectKey(120, 1, 0), 0, 1)).toBeCloseTo(120);
  });
});

describe('布局（viz.go:752-768 pianoLayout 的 clamp 公式）', () => {
  it('键盘高 min(0.30H,168)，前沿 clamp(0.125·total,10,22)，白键降 clamp(0.065·total,5,11)', () => {
    const g = pianoLayout(CANVAS); // 420*0.30=126
    expect(g.total).toBeCloseTo(126);
    expect(g.lipH).toBeCloseTo(126 * 0.125); // 15.75 ∈ [10,22]
    expect(g.whiteDrop).toBeCloseTo(126 * 0.065); // 8.19 ∈ [5,11]

    const big = pianoLayout({ x: 0, y: 0, w: 1600, h: 1000 });
    expect(big.total).toBe(168); // 300 → 钳 168
    expect(big.lipH).toBeCloseTo(21); // 168*0.125=21 ∈ [10,22]
    expect(big.whiteDrop).toBeCloseTo(10.92); // 168*0.065 ∈ [5,11]

    const tiny = pianoLayout({ x: 0, y: 0, w: 320, h: 100 });
    expect(tiny.total).toBeCloseTo(30);
    expect(tiny.lipH).toBe(10); // 3.75 → 钳下限 10
    expect(tiny.whiteDrop).toBe(5); // 1.95 → 钳下限 5
  });

  it('黑键降 = 白键降×1.9、lift = 键盘高×0.125（viz.go:765-766）', () => {
    const g = pianoLayout(CANVAS);
    expect(g.blackDrop).toBeCloseTo(g.whiteDrop * 1.9);
    expect(g.lift).toBeCloseTo((g.total - g.lipH - (g.lipH * 0.55 + g.whiteDrop)) * 0.125);
  });
});

describe('keyY：按下绕远端 pivot（viz.go:712-714 sink/y）', () => {
  it('近端(v=1)全沉 whiteDrop，琴盖线(v=kbBackV)不动，中段介于两者', () => {
    const g = pianoLayout(CANVAS);
    expect(keyY(g, 1, 1, g.whiteDrop) - keyY(g, 1, 0, g.whiteDrop)).toBeCloseTo(g.whiteDrop);
    expect(keyY(g, KB_BACK_V, 1, g.whiteDrop) - keyY(g, KB_BACK_V, 0, g.whiteDrop)).toBeCloseTo(0);
    const mid = keyY(g, 0.6, 1, g.whiteDrop) - keyY(g, 0.6, 0, g.whiteDrop);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(g.whiteDrop);
  });
});

describe('键状态（viz.go:1003-1022 pressLevel）', () => {
  it('keyPress 快攻：lerp 0.5 向能量逼近', () => {
    const s: PressState = { value: 0 };
    expect(keyPress(s, 1)).toBeCloseTo(0.5);
    expect(keyPress(s, 1)).toBeCloseTo(0.75);
    expect(keyPress(s, 1)).toBeCloseTo(0.875);
  });

  it('keyRelease 慢放：0.6/s 线性衰减，钳 0', () => {
    const s: PressState = { value: 1 };
    expect(keyRelease(s, 1 / 60)).toBeCloseTo(1 - 0.6 / 60);
    expect(keyRelease(s, 1 / 60)).toBeCloseTo(1 - 2 * (0.6 / 60));
    const out: PressState = { value: 0.3 };
    expect(keyRelease(out, 10)).toBe(0);
  });

  it('pressLevel：快攻/慢放一体且钳 0..1；idle 微光在静音时非零（viz.go:1006-1010）', () => {
    const loud: PressState = { value: 0 };
    expect(pressLevel(loud, 1, 0, 0, 0, 1 / 60)).toBeCloseTo(0.5);
    const quiet: PressState = { value: 0 };
    // idleW=1（level=0）：0.5+0.5·sin(t·2.3+phase) 的 0.13 倍微光
    expect(pressLevel(quiet, 0, 0, 0, 1, 1 / 60)).toBeGreaterThan(0);
    const clampHi: PressState = { value: 0.99 };
    expect(pressLevel(clampHi, 5, 0, 0, 0, 1 / 60)).toBeLessThanOrEqual(1);
  });

  it('beatDip：beat=1 时白键沉 0.10、黑键沉 0.08，且钳 1（viz.go:851-856）', () => {
    expect(beatDip(0.2, 1, false)).toBeCloseTo(0.30);
    expect(beatDip(0.2, 1, true)).toBeCloseTo(0.28);
    expect(beatDip(0.95, 1, false)).toBe(1);
    expect(beatDip(0.5, 0, false)).toBeCloseTo(0.5);
  });

  it('createPianoState：14+10 双缓冲，t 从 0 起步', () => {
    const st = createPianoState();
    expect(st.t).toBe(0);
    expect(st.w).toHaveLength(14);
    expect(st.b).toHaveLength(10);
  });
});

describe('频段→琴键映射（低频在左，viz.go:843-849 bandAt）', () => {
  it('24 键映射到 56 带：白键与黑键序列各自单调不减，黑键落在宿主白键之间', () => {
    const white = Array.from({ length: 14 }, (_, i) => keyBandIndex(i));
    const black = Array.from({ length: 10 }, (_, j) => blackBandIndex(j));
    expect(white.length + black.length).toBe(24);

    for (let i = 1; i < white.length; i += 1) {
      expect(white[i]).toBeGreaterThanOrEqual(white[i - 1]);
    }
    for (let j = 1; j < black.length; j += 1) {
      expect(black[j]).toBeGreaterThanOrEqual(black[j - 1]);
    }

    const after = kbBlackAfter();
    for (let j = 0; j < 10; j += 1) {
      expect(black[j]).toBeGreaterThanOrEqual(white[after[j]]);
      if (after[j] + 1 < 14) expect(black[j]).toBeLessThanOrEqual(white[after[j] + 1]);
    }

    // 低频在左：首键带 0，末白键 13/14 → floor(13/14·55)=51（带 55 仅在 t≥1 到达）
    expect(white[0]).toBeLessThan(white[13]);
    expect(white[0]).toBe(0);
    expect(white[13]).toBe(Math.floor((13 / 14) * 55));
  });
});

describe('切片与着色（viz.go:828-831 slices / 770-803 shades）', () => {
  it('kbSlices：锥形边缘切片钳 5..20', () => {
    expect(kbSlices(0)).toBe(5);
    expect(kbSlices(1)).toBe(5); // int(1/0.7)+1=2 → 下限 5
    expect(kbSlices(10)).toBe(15); // int(10/0.7)+1=15
    expect(kbSlices(100)).toBe(20); // 上限 20
  });

  it('whiteShade：远端暗（琴体阴影内）→ 近端亮，按下更暗且鼻尖有高光', () => {
    const glow: RGB = [139, 92, 246];
    const back = whiteShade(KB_BACK_V, 0, glow);
    const nose = whiteShade(1, 0, glow);
    expect(nose[0]).toBeGreaterThan(back[0]);
    expect(nose[1]).toBeGreaterThan(back[1]);
    // 按下出光：同一深度 lv 越高越暗（沉出光路）
    const rest = whiteShade(1, 0, glow);
    const down = whiteShade(1, 0.8, glow);
    expect(down[0]).toBeLessThan(rest[0]);
  });

  it('blackShade：黑键从暗部到亮部，鼻尖沿线带高光', () => {
    const glow: RGB = [34, 211, 238];
    const dim = blackShade(KB_BACK_V, 0, glow);
    const nose = blackShade(0.76, 0.5, glow);
    expect(nose[0]).toBeGreaterThanOrEqual(dim[0]);
  });
});
