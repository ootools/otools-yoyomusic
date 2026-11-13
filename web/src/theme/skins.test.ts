/*
 * Task 10 Step 1 失败测试：皮肤表与 CSS 变量注入。
 *
 * 4 套色值逐值断言（防手滑），权威源：Go D:\Repos\xyito\lingyun\YoYoMusic
 * internal/app/state.go:168-191 builtInSkins()（spec §8.6 全表照抄）。
 * applySkin 写 8 个 CSS 变量到 documentElement；applyTokens 写 6 个玻璃拟态
 * 通用 token（spec §8.6 / Go view.go:208-210）。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { applySkin, DEFAULT_SKIN, getSkin, SKINS, type Skin } from './skins';
import { applyTokens } from './tokens';

/** aurora 全表（Go state.go:169-175 逐值转录）。 */
const AURORA: Skin = {
  id: 'aurora',
  name: '极光玻璃',
  primary: '#8b5cf6',
  accent: '#22d3ee',
  bg: '#0e0b1a',
  surface: '#171327',
  ink: '#f4f1ff',
  vizA: '#8b5cf6',
  vizB: '#22d3ee',
  vizInk: '#ffffff',
  author: 'xyito',
};

/** 读取 documentElement 上的内联 CSS 变量。 */
function cssVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

/** 清掉上一个用例留在 documentElement 上的变量。 */
function clearCssVars(): void {
  const style = document.documentElement.style;
  for (const name of [
    '--skin-primary',
    '--skin-accent',
    '--skin-bg',
    '--skin-surface',
    '--skin-ink',
    '--viz-a',
    '--viz-b',
    '--viz-ink',
    '--glass-surface',
    '--glass-accent-strong',
    '--glass-accent-soft',
    '--glass-border',
    '--glass-danger',
    '--glass-success',
  ]) {
    style.removeProperty(name);
  }
}

beforeEach(() => {
  clearCssVars();
});

describe('SKINS（Go state.go:168-191 全表照抄）', () => {
  it('共 4 套，id 顺序 aurora/midnight/sunset/mint，缺省皮肤 aurora', () => {
    expect(SKINS).toHaveLength(4);
    expect(SKINS.map((s) => s.id)).toEqual(['aurora', 'midnight', 'sunset', 'mint']);
    expect(DEFAULT_SKIN).toBe('aurora');
  });

  it('SKINS[0] 深等 aurora 全表值', () => {
    expect(SKINS[0]).toEqual(AURORA);
  });

  it('mint.primary === #34d399（计划逐字断言）', () => {
    const mint = SKINS.find((s) => s.id === 'mint');
    expect(mint?.primary).toBe('#34d399');
  });

  it('midnight 抽查：primary #d946ef / bg #0a0a16', () => {
    const midnight = SKINS.find((s) => s.id === 'midnight');
    expect(midnight?.primary).toBe('#d946ef');
    expect(midnight?.bg).toBe('#0a0a16');
    expect(midnight?.ink).toBe('#f0e9ff');
    expect(midnight?.vizB).toBe('#6366f1');
  });

  it('sunset 抽查：accent #facc15 / surface #2a1a10', () => {
    const sunset = SKINS.find((s) => s.id === 'sunset');
    expect(sunset?.accent).toBe('#facc15');
    expect(sunset?.surface).toBe('#2a1a10');
    expect(sunset?.vizInk).toBe('#fffaf0');
  });

  it('getSkin 按 id 查找；未知 id 返回 undefined', () => {
    expect(getSkin('mint')).toEqual(SKINS[3]);
    expect(getSkin('nope')).toBeUndefined();
  });
});

describe('applySkin（写 --skin-* / --viz-* CSS 变量）', () => {
  it('aurora 注入后 8 个变量全部可读（计划逐字断言 --skin-primary）', () => {
    applySkin(SKINS[0]);
    expect(cssVar('--skin-primary')).toBe('#8b5cf6');
    expect(cssVar('--skin-accent')).toBe('#22d3ee');
    expect(cssVar('--skin-bg')).toBe('#0e0b1a');
    expect(cssVar('--skin-surface')).toBe('#171327');
    expect(cssVar('--skin-ink')).toBe('#f4f1ff');
    expect(cssVar('--viz-a')).toBe('#8b5cf6');
    expect(cssVar('--viz-b')).toBe('#22d3ee');
    expect(cssVar('--viz-ink')).toBe('#ffffff');
  });

  it('切到 mint 后变量整体跟随新皮肤', () => {
    applySkin(SKINS[0]);
    applySkin(SKINS[3]);
    expect(cssVar('--skin-primary')).toBe('#34d399');
    expect(cssVar('--skin-accent')).toBe('#38bdf8');
    expect(cssVar('--skin-bg')).toBe('#06140f');
    expect(cssVar('--viz-ink')).toBe('#f0fffb');
  });
});

describe('applyTokens（玻璃拟态通用 token，spec §8.6 / Go view.go:208-210）', () => {
  it('注入 6 个 token：Surface@0.82、Accent@0.22/0.16、Border 混色 0.18、Danger/Success', () => {
    applyTokens();
    // Surface@0.82：玻璃面 = 皮肤 surface 82% 透明混合。
    expect(cssVar('--glass-surface')).toBe('color-mix(in srgb, var(--skin-surface, #171327) 82%, transparent)');
    // 高亮两档（Go 主题 Accent=s.Primary）：按钮 active 0.22 / 选中行 0.16。
    expect(cssVar('--glass-accent-strong')).toBe('color-mix(in srgb, var(--skin-primary, #8b5cf6) 22%, transparent)');
    expect(cssVar('--glass-accent-soft')).toBe('color-mix(in srgb, var(--skin-primary, #8b5cf6) 16%, transparent)');
    // Border = Surface.Mix(Ink, 0.18)（view.go:208）→ 18% ink + 82% surface。
    expect(cssVar('--glass-border')).toBe('color-mix(in srgb, var(--skin-ink, #f4f1ff) 18%, var(--skin-surface, #171327))');
    // Danger / Success 精确照抄 view.go:209-210。
    expect(cssVar('--glass-danger')).toBe('rgb(239, 68, 68)');
    expect(cssVar('--glass-success')).toBe('rgb(34, 197, 94)');
  });
});
