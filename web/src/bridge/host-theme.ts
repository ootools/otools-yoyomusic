/**
 * 仅设置本页面的临时宿主暗色覆盖；宿主切页/关闭时恢复原主题，不改用户设置。
 * 旧宿主和独立浏览器无此能力时安静跳过。
 */
export function installTempDarkHostTheme(): () => void {
  const host = window.otools ?? window.utools;
  if (!host?.setTempHostTheme) return () => {};
  const setTheme = (theme: 'dark' | null) => {
    try {
      void Promise.resolve(host.setTempHostTheme!(theme)).catch(() => {});
    } catch { /* 临时外壳主题失败不阻断音乐播放器。 */ }
  };
  let active = true;
  const stop = () => {
    if (!active) return;
    active = false;
    window.removeEventListener('pagehide', stop);
    setTheme(null);
  };
  setTheme('dark');
  window.addEventListener('pagehide', stop);
  return stop;
}
