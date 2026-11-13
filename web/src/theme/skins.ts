/*
 * 皮肤（计划 Task 10 / spec §8.6）。
 *
 * 4 套内置玻璃拟态皮肤，色值逐值照抄 Go 权威源
 * D:\Repos\xyito\lingyun\YoYoMusic internal/app/state.go:168-191 builtInSkins()
 * （aurora 为缺省，色板与 spec §8.6 表一致）。全应用恒暗色，不跟随宿主亮暗主题。
 *
 * applySkin 把 8 个变量写到 documentElement.style 上：
 *   --skin-primary / --skin-accent / --skin-bg / --skin-surface / --skin-ink
 *   --viz-a / --viz-b / --viz-ink
 * 命名对齐 tauri 分支 styles/skin-layouts.css 的 skin 与 viz CSS 变量约定；
 * 玻璃拟态的通用派生 token（Surface@0.82、高亮、Border 混色等）见 tokens.ts。
 */

/** 皮肤 id（Go Skin.ID 四值）。 */
export type SkinId = 'aurora' | 'midnight' | 'sunset' | 'mint';

export interface Skin {
  id: SkinId;
  /** 展示名（Go Name：极光玻璃/午夜霓虹/落日熔金/薄荷录音室）。 */
  name: string;
  /** 主色（Go Primary）：播放键渐变、主题 Accent（Go 主题 Accent=s.Primary）。 */
  primary: string;
  /** 副色（Go Accent）：logo/封面渐变第二色、可视化辅助。 */
  accent: string;
  /** 页面底色（Go BG）：恒暗。 */
  bg: string;
  /** 玻璃面板基色（Go Surface）：配合 0.82 透明度做玻璃拟态（tokens.ts）。 */
  surface: string;
  /** 正文墨色（Go Ink）。 */
  ink: string;
  /** 可视化主色（Go VizA）。 */
  vizA: string;
  /** 可视化副色（Go VizB）。 */
  vizB: string;
  /** 可视化高亮/文字色（Go VizInk，亦为主题 AccentText）。 */
  vizInk: string;
  /** 作者（Go Author）。 */
  author?: string;
}

/** 4 套内置皮肤；色值与 Go state.go:168-191 逐值一致，顺序即展示顺序。 */
export const SKINS: Skin[] = [
  {
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
  },
  {
    id: 'midnight',
    name: '午夜霓虹',
    primary: '#d946ef',
    accent: '#6366f1',
    bg: '#0a0a16',
    surface: '#14142a',
    ink: '#f0e9ff',
    vizA: '#d946ef',
    vizB: '#6366f1',
    vizInk: '#ffffff',
    author: 'xyito',
  },
  {
    id: 'sunset',
    name: '落日熔金',
    primary: '#f97316',
    accent: '#facc15',
    bg: '#1a0f08',
    surface: '#2a1a10',
    ink: '#fff3e6',
    vizA: '#f97316',
    vizB: '#facc15',
    vizInk: '#fffaf0',
    author: 'xyito',
  },
  {
    id: 'mint',
    name: '薄荷录音室',
    primary: '#34d399',
    accent: '#38bdf8',
    bg: '#06140f',
    surface: '#0e211b',
    ink: '#e6fff4',
    vizA: '#34d399',
    vizB: '#38bdf8',
    vizInk: '#f0fffb',
    author: 'xyito',
  },
];

/** 缺省皮肤（Go SetDefaultSkin 的 aurora 缺省）。 */
export const DEFAULT_SKIN: SkinId = 'aurora';

/** 按 id 取内置皮肤；未知 id 返回 undefined。 */
export function getSkin(id: string): Skin | undefined {
  return SKINS.find((s) => s.id === id);
}

/** 把皮肤写到 documentElement 的 CSS 变量上（8 个变量，见文件头注）。 */
export function applySkin(s: Skin): void {
  const style = document.documentElement.style;
  style.setProperty('--skin-primary', s.primary);
  style.setProperty('--skin-accent', s.accent);
  style.setProperty('--skin-bg', s.bg);
  style.setProperty('--skin-surface', s.surface);
  style.setProperty('--skin-ink', s.ink);
  style.setProperty('--viz-a', s.vizA);
  style.setProperty('--viz-b', s.vizB);
  style.setProperty('--viz-ink', s.vizInk);
}
