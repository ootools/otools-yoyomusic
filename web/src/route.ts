/**
 * 三路由约定（plugin.json 三窗口拓扑，spec §5.3）：
 *   `?lyrics=1` → 桌面歌词悬浮窗页；`?main=1` → 独立主窗口页；否则 → panel 页。
 * 同一个 dist，靠查询参数区分页面。
 */
export type Route = 'panel' | 'main' | 'lyrics';

/** 从 location（如 `index.html?lyrics=1` 或 `location.search`）解析路由。 */
export function routeFromLocation(location: string): Route {
  const search = location.includes('?') ? location.slice(location.indexOf('?') + 1) : '';
  const params = new URLSearchParams(search);
  if (params.get('lyrics') === '1') return 'lyrics';
  if (params.get('main') === '1') return 'main';
  return 'panel';
}
