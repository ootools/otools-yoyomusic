/*
 * 玻璃拟态通用 token（计划 Task 10 / spec §8.6）。
 *
 * 与具体皮肤无关的派生量，一次性写到 documentElement 上，供 Task 11 布局壳与
 * 通用件消费。派生式用 CSS color-mix() 引用 --skin-* 变量（tauri 分支 app.css
 * 同款写法），切肤时无需重注入即自动跟随；var() 兜底值为 aurora 缺省色
 * （与 SKINS[0] 一致），保证 applySkin 之前页面也有可用的暗色底。
 *
 * Go 权威源（D:\Repos\xyito\lingyun\YoYoMusic internal/ui/view.go:204-210 skinTheme）：
 *   Border  = Surface.Mix(Ink, 0.18)   → --glass-border（18% ink + 82% surface）
 *   Danger  = rgb(239, 68, 68)         → --glass-danger
 *   Success = rgb(34, 197, 94)         → --glass-success
 * spec §8.6/§8.1：
 *   Surface@0.82（顶栏/左右栏玻璃面）   → --glass-surface
 *   Accent@0.22（按钮高亮态）           → --glass-accent-strong
 *   Accent@0.16（播放中行/选中卡）      → --glass-accent-soft
 * 注意 Go 主题的 Accent = 皮肤 Primary（非皮肤的 accent 字段），高亮档据此取
 * --skin-primary。
 */

/** 高亮两档透明度：按钮 active 0.22、选中行 0.16（spec §8.1 高亮态）。 */
const ACCENT_STRONG = 0.22;
const ACCENT_SOFT = 0.16;

/** 玻璃面不透明度：顶栏/左右栏 Surface@0.82（spec §8.1）。 */
const SURFACE_OPACITY = 0.82;

/** Border 混色比：18% ink 混入 surface（Go view.go:208）。 */
const BORDER_INK_RATIO = 0.18;

/** 把 6 个通用 token 写到 documentElement 上（幂等，启动时与 applySkin 同调）。 */
export function applyTokens(): void {
  const style = document.documentElement.style;
  style.setProperty(
    '--glass-surface',
    `color-mix(in srgb, var(--skin-surface, #171327) ${SURFACE_OPACITY * 100}%, transparent)`,
  );
  style.setProperty(
    '--glass-accent-strong',
    `color-mix(in srgb, var(--skin-primary, #8b5cf6) ${ACCENT_STRONG * 100}%, transparent)`,
  );
  style.setProperty(
    '--glass-accent-soft',
    `color-mix(in srgb, var(--skin-primary, #8b5cf6) ${ACCENT_SOFT * 100}%, transparent)`,
  );
  style.setProperty(
    '--glass-border',
    `color-mix(in srgb, var(--skin-ink, #f4f1ff) ${BORDER_INK_RATIO * 100}%, var(--skin-surface, #171327))`,
  );
  style.setProperty('--glass-danger', 'rgb(239, 68, 68)');
  style.setProperty('--glass-success', 'rgb(34, 197, 94)');
}
