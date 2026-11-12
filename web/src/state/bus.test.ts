import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBus } from './bus';
import type { BusMsg } from './bus';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createBus', () => {
  it('有 BroadcastChannel → 频道名 yoyomusic，post 走频道、on 收远端消息', () => {
    const instances: Array<{ name: string; onmessage: ((e: { data: unknown }) => void) | null }> = [];
    const posted: Array<{ name: string; m: unknown }> = [];
    class FakeBroadcastChannel {
      name: string;
      onmessage: ((e: { data: unknown }) => void) | null = null;
      constructor(name: string) {
        this.name = name;
        instances.push(this);
      }
      postMessage(m: unknown): void {
        posted.push({ name: this.name, m });
      }
      close(): void {}
    }
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);

    const bus = createBus();
    expect(instances).toHaveLength(1);
    expect(instances[0]!.name).toBe('yoyomusic');

    const seen: BusMsg[] = [];
    const off = bus.on((m) => seen.push(m));
    instances[0]!.onmessage?.({ data: { t: 'hello', from: 'far' } });
    expect(seen).toEqual([{ t: 'hello', from: 'far' }]);

    bus.post({ t: 'claim', epoch: 1, from: 'a' });
    expect(posted).toEqual([{ name: 'yoyomusic', m: { t: 'claim', epoch: 1, from: 'a' } }]);

    off();
    instances[0]!.onmessage?.({ data: { t: 'hello', from: 'far2' } });
    expect(seen).toHaveLength(1);
  });

  it('无 BroadcastChannel → localStorage storage 事件兜底（key __yoyomusic.bus）', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    // jsdom 的 localStorage 是 Proxy：stub 必须打在 Storage.prototype 上
    // 才会真正替换方法（Task 2 先例注释）。
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const bus = createBus();

    const msg: BusMsg = { t: 'hello', from: 'p1' };
    bus.post(msg);
    expect(setItemSpy).toHaveBeenCalledWith('__yoyomusic.bus', JSON.stringify(msg));

    const seen: BusMsg[] = [];
    const off = bus.on((m) => seen.push(m));

    // 命中 key → 解析派发
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: '__yoyomusic.bus',
        newValue: JSON.stringify({ t: 'hello', from: 'p2' }),
      }),
    );
    expect(seen).toEqual([{ t: 'hello', from: 'p2' }]);

    // 其他 key / 空 newValue / 坏 JSON → 忽略且不抛
    window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: '{}' }));
    window.dispatchEvent(
      new StorageEvent('storage', { key: '__yoyomusic.bus', newValue: null }),
    );
    window.dispatchEvent(
      new StorageEvent('storage', { key: '__yoyomusic.bus', newValue: '{broken' }),
    );
    expect(seen).toHaveLength(1);

    off();
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: '__yoyomusic.bus',
        newValue: JSON.stringify({ t: 'hello', from: 'p3' }),
      }),
    );
    expect(seen).toHaveLength(1);
  });
});
