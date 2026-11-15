/**
 * 仅设置本页面的临时宿主暗色覆盖；宿主切页/关闭时恢复原主题，不改用户设置。
 * 旧宿主和独立浏览器无此能力时安静跳过。
 *
 * `background` 让宿主 TABS 顶栏 / Panel 头部底色跟随当前皮肤（见 skins.ts 的
 * `--skin-bg`），消除宿主默认暗色与播放器玻璃拟态色系的割裂；旧宿主会忽略
 * 未知参数，安全降级为只声明明暗。
 */

/** 本页是否已声明临时宿主主题（独立歌词窗口同样各自声明，互不影响）。 */
let declarationActive = false;

const getHost = (): typeof window.otools | typeof window.utools | undefined =>
  window.otools ?? window.utools;

export function installTempDarkHostTheme(background?: string): () => void {
  const host = getHost();
  if (!host?.setTempHostTheme) return () => {};
  const setTheme = (theme: 'dark' | null, nextBackground?: string | null) => {
    try {
      void Promise.resolve(host.setTempHostTheme!(theme, { background: nextBackground ?? null })).catch(() => {});
    } catch { /* 临时外壳主题失败不阻断音乐播放器。 */ }
  };
  let active = true;
  declarationActive = true;
  const stop = () => {
    if (!active) return;
    active = false;
    declarationActive = false;
    window.removeEventListener('pagehide', stop);
    setTheme(null);
  };
  setTheme('dark', background ?? null);
  window.addEventListener('pagehide', stop);
  return stop;
}

/** 皮肤切换时同步外壳 chrome 背景色；本页未声明临时主题时为 no-op。 */
export function syncTempHostThemeBackground(background: string): void {
  if (!declarationActive) return;
  const host = getHost();
  if (!host?.setTempHostTheme) return;
  try {
    void Promise.resolve(host.setTempHostTheme('dark', { background })).catch(() => {});
  } catch { /* 临时外壳主题失败不阻断音乐播放器。 */ }
}
