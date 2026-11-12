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

  it('无 BroadcastChannel → localStorage storage 事件兜底（key __yoyomusic.bus，序号信封）', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    // jsdom 的 localStorage 是 Proxy：stub 必须打在 Storage.prototype 上
    // 才会真正替换方法（Task 2 先例注释）。
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const bus = createBus();

    const msg: BusMsg = { t: 'hello', from: 'p1' };
    bus.post(msg);
    // 写入值必须是 { n: 序号, m: 消息 } 信封（同值 setItem 不派发 storage 事件，
    // 见下方"连续两次相同 post"回归测试）
    expect(setItemSpy).toHaveBeenCalledTimes(1);
    const [postKey, postRaw] = setItemSpy.mock.calls[0]!;
    expect(postKey).toBe('__yoyomusic.bus');
    const envelope = JSON.parse(String(postRaw)) as { n: number; m: BusMsg };
    expect(envelope.m).toEqual(msg);
    expect(typeof envelope.n).toBe('number');

    const seen: BusMsg[] = [];
    const off = bus.on((m) => seen.push(m));

    // 命中 key 的合法信封 → 解包派发
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: '__yoyomusic.bus',
        newValue: JSON.stringify({ n: 2, m: { t: 'hello', from: 'p2' } }),
      }),
    );
    expect(seen).toEqual([{ t: 'hello', from: 'p2' }]);

    // 其他 key / 空 newValue / 坏 JSON / 非信封裸消息 → 忽略且不抛
    window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: '{}' }));
    window.dispatchEvent(
      new StorageEvent('storage', { key: '__yoyomusic.bus', newValue: null }),
    );
    window.dispatchEvent(
      new StorageEvent('storage', { key: '__yoyomusic.bus', newValue: '{broken' }),
    );
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: '__yoyomusic.bus',
        newValue: JSON.stringify({ t: 'hello', from: 'raw' }), // 无信封
      }),
    );
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: '__yoyomusic.bus',
        newValue: JSON.stringify({ n: 'x', m: { t: 'hello', from: 'bad-n' } }),
      }),
    );
    expect(seen).toHaveLength(1);

    off();
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: '__yoyomusic.bus',
        newValue: JSON.stringify({ n: 3, m: { t: 'hello', from: 'p3' } }),
      }),
    );
    expect(seen).toHaveLength(1);
  });

  it('兜底：连续两次相同 post，对端收到两次（同值 setItem 丢事件回归）', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    // 模拟对端文档的 HTML 规范语义：同值 setItem 不派发 storage 事件。
    // 收侧监听 = 真实写入后，仅当写入值与对端已见值不同才派发。
    let peerValue: string | null = null;
    const realSetItem = Storage.prototype.setItem;
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function (this: Storage, key: string, value: string) {
        realSetItem.call(this, key, value);
        if (peerValue !== value) {
          peerValue = value;
          window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
        }
      });
    try {
      const bus = createBus();
      const seen: BusMsg[] = [];
      bus.on((m) => seen.push(m));

      const hello: BusMsg = { t: 'hello', from: 'leader-page' }; // 心跳内容恒定
      bus.post(hello);
      bus.post(hello);
      bus.post(hello);

      // 修前：第 2/3 次同值 setItem 不触发对端事件 → 只收到 1 条（心跳全丢）
      expect(seen).toEqual([hello, hello, hello]);
    } finally {
      spy.mockRestore();
      window.localStorage.clear();
    }
  });

  it('兜底信封：写入序号 n 随每次 post 单调递增', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const raws: string[] = [];
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation((_key: string, value: string) => {
        raws.push(value);
      });
    try {
      const bus = createBus();
      const hello: BusMsg = { t: 'hello', from: 'p1' };
      bus.post(hello);
      bus.post(hello);
      bus.post(hello);
      const seqs = raws.map((raw) => {
        const env = JSON.parse(raw) as { n: number; m: unknown };
        expect(env.m).toEqual(hello);
        return env.n;
      });
      expect(seqs).toHaveLength(3);
      expect(seqs[1]!).toBeGreaterThan(seqs[0]!);
      expect(seqs[2]!).toBeGreaterThan(seqs[1]!);
    } finally {
      spy.mockRestore();
    }
  });
});
