import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OToolsAPI } from './otools';
import { installTempDarkHostTheme, syncTempHostThemeBackground } from './host-theme';

type SetTheme = (theme: 'light' | 'dark' | null, options?: { background?: string | null }) => Promise<void>;

const createSetTheme = () => vi.fn(async (_theme: 'light' | 'dark' | null, _options?: { background?: string | null }) => {});

const mockHost = (setTheme: SetTheme) => {
  window.otools = { getPluginLocalState: async () => null, setTempHostTheme: setTheme } as unknown as OToolsAPI;
};

afterEach(() => { delete window.otools; delete window.utools; vi.restoreAllMocks(); });

describe('插件临时暗黑宿主主题', () => {
  it('初始化请求dark而非修改用户长期主题', async () => {
    const setTheme = createSetTheme();
    mockHost(setTheme);
    const stop = installTempDarkHostTheme();
    await Promise.resolve();
    expect(setTheme).toHaveBeenCalledWith('dark', { background: null });
    expect(setTheme).toHaveBeenCalledTimes(1);
    stop();
  });

  it('初始化可携带皮肤背景色声明外壳chrome底色', async () => {
    const setTheme = createSetTheme();
    mockHost(setTheme);
    const stop = installTempDarkHostTheme('#0e0b1a');
    await Promise.resolve();
    expect(setTheme).toHaveBeenCalledWith('dark', { background: '#0e0b1a' });
    stop();
  });

  it('syncTempHostThemeBackground 随皮肤切换更新外壳背景', async () => {
    const setTheme = createSetTheme();
    mockHost(setTheme);
    const stop = installTempDarkHostTheme('#0e0b1a');
    syncTempHostThemeBackground('#1a0f08');
    await Promise.resolve();
    expect(setTheme.mock.calls).toEqual([
      ['dark', { background: '#0e0b1a' }],
      ['dark', { background: '#1a0f08' }],
    ]);
    stop();
    syncTempHostThemeBackground('#06140f');
    expect(setTheme.mock.calls).toEqual([
      ['dark', { background: '#0e0b1a' }],
      ['dark', { background: '#1a0f08' }],
      [null, { background: null }],
    ]);
  });

  it('页面离开时清除本页临时覆盖并移除监听', async () => {
    const setTheme = createSetTheme();
    mockHost(setTheme);
    const stop = installTempDarkHostTheme();
    window.dispatchEvent(new Event('pagehide'));
    await Promise.resolve();
    expect(setTheme.mock.calls).toEqual([['dark', { background: null }], [null, { background: null }]]);
    stop();
    window.dispatchEvent(new Event('pagehide'));
    expect(setTheme).toHaveBeenCalledTimes(2);
  });

  it('utools兼容宿主同样使用dark', () => {
    const setTheme = createSetTheme();
    window.utools = { getPluginLocalState: async () => null, setTempHostTheme: setTheme } as unknown as OToolsAPI;
    const stop = installTempDarkHostTheme();
    expect(setTheme).toHaveBeenCalledWith('dark', { background: null });
    stop();
  });

  it('旧宿主缺能力或调用拒绝都不影响播放器启动', async () => {
    window.otools = {} as OToolsAPI;
    const noHostStop = installTempDarkHostTheme();
    noHostStop();
    syncTempHostThemeBackground('#0e0b1a');
    window.otools = { getPluginLocalState: async () => null, setTempHostTheme: vi.fn(async () => { throw new Error('unsupported'); }) } as unknown as OToolsAPI;
    const stop = installTempDarkHostTheme();
    await Promise.resolve();
    await Promise.resolve();
    stop();
  });
});
