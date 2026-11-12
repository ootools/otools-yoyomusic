import { describe, expect, it } from 'vitest';
import { routeFromLocation } from './route';

describe('routeFromLocation', () => {
  it('?lyrics=1 → lyrics（桌面歌词悬浮窗页）', () => {
    expect(routeFromLocation('index.html?lyrics=1')).toBe('lyrics');
  });

  it('?main=1 → main（独立主窗口页）', () => {
    expect(routeFromLocation('index.html?main=1')).toBe('main');
  });

  it('无参数 → panel（默认 panel 页）', () => {
    expect(routeFromLocation('index.html')).toBe('panel');
  });
});
