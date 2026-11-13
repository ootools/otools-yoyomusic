import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeWindowPosition } from './native';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); delete window.__TAURI_INTERNALS__; });
describe('原生窗口位置跟踪', () => {
  it('移动事件停止后保存最后物理坐标，解除订阅后不再保存', async () => {
    vi.useFakeTimers();
    let callback!: (event: unknown) => void;
    const invoke = vi.fn(async (command: string) => command === 'plugin:event|listen' ? 7 : undefined);
    window.__TAURI_INTERNALS__ = {
      invoke,
      transformCallback(fn: (event: unknown) => void) { callback = fn; return 12; },
      unregisterCallback: vi.fn(),
      metadata: { currentWindow: { label: 'tools-tab-custom-yoyomusic-lyrics' } },
    } as NonNullable<Window['__TAURI_INTERNALS__']>;
    const saved: Array<{ x: number; y: number }> = [];
    const stop = await observeWindowPosition((point) => saved.push(point));
    expect(invoke).toHaveBeenCalledWith('plugin:event|listen', { event: 'tauri://move', handler: 12, target: { kind: 'Window', label: 'tools-tab-custom-yoyomusic-lyrics' } });
    callback({ id: 7, payload: { x: 100, y: 200 } });
    await vi.advanceTimersByTimeAsync(150);
    callback({ id: 7, payload: { x: 300, y: 400 } });
    await vi.advanceTimersByTimeAsync(199);
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(saved).toEqual([{ x: 300, y: 400 }]);
    await stop();
    expect(invoke).toHaveBeenCalledWith('plugin:event|unlisten', { event: 'tauri://move', eventId: 7 });
    callback({ payload: { x: 500, y: 600 } });
    await vi.advanceTimersByTimeAsync(300);
    expect(saved).toHaveLength(1);
  });
});
