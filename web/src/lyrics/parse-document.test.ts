import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseLyricsDocument } from './parse-document';

afterEach(() => { delete window.otools; delete window.__TAURI_INTERNALS__; });
describe('可选原生歌词解析', () => {
  it('精确架构包启用的原生库会解析歌词，兼容包不主动加载', async () => {
    const call = vi.fn(async () => ({ lines: [{ timeMs: 1000, text: 'native' }] }));
    window.otools = { getPluginLocalState: async () => null, probeNative: async () => ({ enabled: true }), invokeNative: call };
    expect(await parseLyricsDocument('[00:01]web')).toEqual([{ timeMs: 1000, text: 'native' }]);
    expect(call).toHaveBeenCalledWith('lyrics.parse', { text: '[00:01]web' });
    window.otools.probeNative = async () => ({ enabled: false });
    call.mockClear();
    expect(await parseLyricsDocument('[00:01]web')).toEqual([{ timeMs: 1000, text: 'web' }]);
    expect(call).not.toHaveBeenCalled();
  });
  it('原生库缺失或返回坏数据，自动回退现有LRC解析器', async () => {
    window.otools = { getPluginLocalState: async () => null, probeNative: async () => ({ enabled: true }), invokeNative: async () => ({ lines: 'invalid' }) };
    expect(await parseLyricsDocument('[00:02]safe')).toEqual([{ timeMs: 2000, text: 'safe' }]);
  });
});
