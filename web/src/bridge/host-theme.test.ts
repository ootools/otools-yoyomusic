import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OToolsAPI } from './otools';
import { installTempDarkHostTheme } from './host-theme';

afterEach(() => { delete window.otools; delete window.utools; vi.restoreAllMocks(); });

describe('插件临时暗黑宿主主题', () => {
  it('初始化请求dark而非修改用户长期主题', async () => {
    const setTheme = vi.fn(async (_theme: 'light' | 'dark' | null) => {});
    window.otools = { getPluginLocalState: async () => null, setTempHostTheme: setTheme };
    const stop = installTempDarkHostTheme();
    await Promise.resolve();
    expect(setTheme).toHaveBeenCalledWith('dark');
    expect(setTheme).toHaveBeenCalledTimes(1);
    stop();
  });

  it('页面离开时清除本页临时覆盖并移除监听', async () => {
    const setTheme = vi.fn(async (_theme: 'light' | 'dark' | null) => {});
    window.otools = { getPluginLocalState: async () => null, setTempHostTheme: setTheme };
    const stop = installTempDarkHostTheme();
    window.dispatchEvent(new Event('pagehide'));
    await Promise.resolve();
    expect(setTheme.mock.calls).toEqual([['dark'], [null]]);
    stop();
    window.dispatchEvent(new Event('pagehide'));
    expect(setTheme).toHaveBeenCalledTimes(2);
  });

  it('utools兼容宿主同样使用dark', () => {
    const setTheme = vi.fn(async (_theme: 'light' | 'dark' | null) => {});
    window.utools = { getPluginLocalState: async () => null, setTempHostTheme: setTheme };
    const stop = installTempDarkHostTheme();
    expect(setTheme).toHaveBeenCalledWith('dark');
    stop();
  });

  it('旧宿主缺能力或调用拒绝都不影响播放器启动', async () => {
    window.otools = {} as OToolsAPI;
    const noHostStop = installTempDarkHostTheme();
    noHostStop();
    window.otools = { getPluginLocalState: async () => null, setTempHostTheme: vi.fn(async () => { throw new Error('unsupported'); }) };
    const stop = installTempDarkHostTheme();
    await Promise.resolve();
    await Promise.resolve();
    stop();
  });
});
