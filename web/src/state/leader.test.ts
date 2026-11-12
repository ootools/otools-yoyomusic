import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusMsg } from './bus';
import { createLeader } from './leader';

/* ------------------------------------------------------------------ *
 * 内存版 bus：post 同步派发给所有已注册 handler（含 poster 自己——
 * 真实 BroadcastChannel 不会回送自身，leader 实现必须过滤来自总线、
 * from===自身的回声；这里的内存版故意回送以验证该过滤）。
 * ------------------------------------------------------------------ */

interface MemoryBus {
  post(m: BusMsg): void;
  on(h: (m: BusMsg) => void): () => void;
  /** 全部 post 过的消息（断言"转发 post"用） */
  sent: BusMsg[];
}

function createMemoryBus(): MemoryBus {
  const handlers = new Set<(m: BusMsg) => void>();
  const sent: BusMsg[] = [];
  return {
    sent,
    post(m: BusMsg): void {
      sent.push(m);
      for (const h of [...handlers]) h(m);
    },
    on(h: (m: BusMsg) => void): () => void {
      handlers.add(h);
      return () => {
        handlers.delete(h);
      };
    },
  };
}

beforeEach(() => {
  // Date 一起 fake：epoch=Date.now() 起步，advanceTimersByTime 同步推进时钟
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ *
 * 选举与消息路由（计划 Task 3 测试 ①–⑤）
 * ------------------------------------------------------------------ */

describe('createLeader 选举', () => {
  it('① 两页同时 claim：epoch 小者胜，后到者 isLeader===false', () => {
    const bus = createMemoryBus();
    const a = createLeader(bus);
    expect(a.isLeader).toBe(true); // 首页乐观当选

    vi.advanceTimersByTime(10); // 后到页晚 10ms（≈同时），epoch=Date.now() 更大
    const b = createLeader(bus);
    // b 乐观当选后收到 a 的 claim（epoch 更小）→ 让位
    expect(b.isLeader).toBe(false);
    expect(a.isLeader).toBe(true);
  });

  it('② 非主控页 handle(state-mutate) 返回 false 且转发 post 给主控页应用', () => {
    const bus = createMemoryBus();
    const a = createLeader(bus);
    vi.advanceTimersByTime(10);
    const b = createLeader(bus); // 非主控页
    const applied: Array<[string, unknown]> = [];
    a.onRemoteState((k, v) => applied.push([k, v]));

    const mutate: BusMsg = {
      t: 'state-mutate',
      key: 'library',
      patch: { tracks: { 'D:\\a.mp3': { title: 'A' } } },
      from: 'panel',
    };
    expect(b.handle(mutate)).toBe(false); // 本页未应用
    // 已转发 post（总线上能看到这条消息）
    expect(bus.sent).toContainEqual(mutate);
    // 主控页经总线收到并应用
    expect(applied).toEqual([['library', { tracks: { 'D:\\a.mp3': { title: 'A' } } }]]);
  });

  it('③ 主控页收到 state-mutate 应用到 onRemoteState 回调并返回 true', () => {
    const bus = createMemoryBus();
    const a = createLeader(bus);
    const applied: Array<[string, unknown]> = [];
    a.onRemoteState((k, v) => applied.push([k, v]));

    expect(a.handle({ t: 'state-mutate', key: 'window', patch: { x: 1, y: 2 }, from: 'other' })).toBe(
      true,
    );
    expect(applied).toEqual([['window', { x: 1, y: 2 }]]);
  });

  it('④ 心跳超时（advance 7s）触发重选', () => {
    const bus = createMemoryBus();
    const b = createLeader(bus); // 初始乐观当选
    // 幽灵主控（epoch 更小）claim → b 让位跟随；此后再无心跳
    b.handle({ t: 'claim', epoch: Date.now() - 1000, from: 'ghost-leader' });
    expect(b.isLeader).toBe(false);

    // 心跳 2s ×3 = 6s 超时 → 接管重选（advance 7s 覆盖超时点）
    vi.advanceTimersByTime(7000);
    expect(b.isLeader).toBe(true);
    // 重选后广播了新的 claim（初始 + 接管 ≥ 2 条）
    const claims = bus.sent.filter((m): m is Extract<BusMsg, { t: 'claim' }> => m.t === 'claim');
    expect(claims.length).toBeGreaterThanOrEqual(2);
  });
});

describe('createLeader 命令路由', () => {
  it('⑤ cmd 消息：主控页转 onCommand；非主控页本地注入转发给主控页', () => {
    const bus = createMemoryBus();
    const a = createLeader(bus);
    vi.advanceTimersByTime(10);
    const b = createLeader(bus); // 非主控页
    const cmds: BusMsg[] = [];
    a.onCommand((m) => cmds.push(m));

    // 主控页直接收到 cmd → 应用
    expect(a.handle({ t: 'cmd', op: 'seek', arg: 42000, from: 'lyrics' })).toBe(true);
    // 非主控页本地注入 cmd → 转发，主控页应用
    expect(b.handle({ t: 'cmd', op: 'play', from: 'lyrics' })).toBe(false);
    expect(cmds).toEqual([
      { t: 'cmd', op: 'seek', arg: 42000, from: 'lyrics' },
      { t: 'cmd', op: 'play', from: 'lyrics' },
    ]);
  });

  it('onRemoteState/onCommand 返回退订函数', () => {
    const bus = createMemoryBus();
    const a = createLeader(bus);
    const applied: Array<[string, unknown]> = [];
    const cmds: BusMsg[] = [];
    const offState = a.onRemoteState((k, v) => applied.push([k, v]));
    const offCmd = a.onCommand((m) => cmds.push(m));
    offState();
    offCmd();
    a.handle({ t: 'state-mutate', key: 'settings', patch: { a: 1 }, from: 'x' });
    a.handle({ t: 'cmd', op: 'pause', from: 'x' });
    expect(applied).toEqual([]);
    expect(cmds).toEqual([]);
  });
});
