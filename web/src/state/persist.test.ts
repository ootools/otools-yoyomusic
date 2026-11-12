import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPersistence } from './persist';

/* ------------------------------------------------------------------ *
 * 注入版 savePersisted + 固定快照的构造工具。
 * 真实 savePersisted（bridge）默认经 opts 注入替换，除非测试显式要求。
 * ------------------------------------------------------------------ */

const SNAPSHOT: Record<string, unknown> = {
  settings: { skin: 'aurora', volume: 0.8 },
  library: { tracks: {}, playlists: {}, history: [] },
  resume: { trackId: 't1', positionMs: 42000 },
};

function makeDeps(isLeader: boolean, snapshot: Record<string, unknown> = SNAPSHOT): {
  savePersisted: ReturnType<typeof vi.fn>;
  p: ReturnType<typeof createPersistence>;
  snapshot: Record<string, unknown>;
} {
  const savePersisted = vi.fn(async (_patch: Record<string, unknown>) => {});
  const p = createPersistence({
    isLeader: () => isLeader,
    getSnapshot: () => snapshot,
    savePersisted: savePersisted as (patch: Record<string, unknown>) => Promise<void>,
  });
  return { savePersisted, p, snapshot };
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ *
 * 节流与单写者（计划 Task 3 测试 ①②④）
 * ------------------------------------------------------------------ */

describe('createPersistence 节流与单写者', () => {
  it('① 非主控页 scheduleSave 不触发 savePersisted', () => {
    const { p, savePersisted } = makeDeps(false);
    p.scheduleSave('library');
    vi.advanceTimersByTime(5000);
    expect(savePersisted).not.toHaveBeenCalled();
  });

  it('①b 非主控页 flushNow/flushPosition 也不落盘', async () => {
    const { p, savePersisted } = makeDeps(false);
    await p.flushNow();
    p.flushPosition();
    expect(savePersisted).not.toHaveBeenCalled();
  });

  it('② 主控页 library 1500ms 后合并调用一次（debounce）', () => {
    const { p, savePersisted } = makeDeps(true);
    p.scheduleSave('library');
    vi.advanceTimersByTime(900); // 不足 1500：被后续调用重置
    p.scheduleSave('library');
    p.scheduleSave('library');
    vi.advanceTimersByTime(1499);
    expect(savePersisted).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(savePersisted).toHaveBeenCalledTimes(1);
    expect(savePersisted).toHaveBeenCalledWith({
      library: { tracks: {}, playlists: {}, history: [] },
    });
  });

  it('②b settings 400ms 节流', () => {
    const { p, savePersisted } = makeDeps(true);
    p.scheduleSave('settings');
    vi.advanceTimersByTime(399);
    expect(savePersisted).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(savePersisted).toHaveBeenCalledTimes(1);
    expect(savePersisted).toHaveBeenCalledWith({ settings: { skin: 'aurora', volume: 0.8 } });
  });

  it('④ flushPosition 每 5s 至多一次', () => {
    const { p, savePersisted } = makeDeps(true);
    p.flushPosition();
    p.flushPosition();
    p.flushPosition();
    expect(savePersisted).toHaveBeenCalledTimes(1);
    expect(savePersisted).toHaveBeenCalledWith({ resume: { trackId: 't1', positionMs: 42000 } });

    vi.advanceTimersByTime(4999);
    p.flushPosition();
    expect(savePersisted).toHaveBeenCalledTimes(1); // 5s 窗口内被节流

    vi.advanceTimersByTime(1);
    p.flushPosition();
    expect(savePersisted).toHaveBeenCalledTimes(2);
  });

  it('flushPosition 快照缺 resume 时不写（不冲掉既有恢复点）', () => {
    const { p, savePersisted } = makeDeps(true, { settings: {} });
    p.flushPosition();
    expect(savePersisted).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * localStorage 兜底配额裁剪（计划 Task 3 测试 ③，spec §10.2）
 * 走真实 bridge savePersisted + Storage.prototype stub（jsdom 的
 * localStorage 是 Proxy，stub 必须打在原型上，Task 2 有先例注释）。
 * ------------------------------------------------------------------ */

describe('createPersistence 配额裁剪', () => {
  const STATE_KEY = 'yoyomusic.state.v1';

  function bigSnapshot(): Record<string, unknown> {
    return {
      settings: { skin: 'aurora' },
      library: {
        tracks: {
          a: { title: 'A', coverThumb: 'data:image/jpeg;base64,AAA' },
          b: { title: 'B', coverThumb: 'data:image/jpeg;base64,BBB' },
          c: { title: 'C' },
        },
        playlists: { default: { trackIds: ['a', 'b'] } },
        history: Array.from({ length: 80 }, (_, i) => ({ trackId: `t${i}`, playedAt: i })),
      },
      resume: { trackId: 'a', positionMs: 5000 },
    };
  }

  it('③ setItem 抛 QuotaExceeded 时按序裁剪 coverThumb→history(50)→resume 后重试成功', async () => {
    window.localStorage.clear();
    const quota = () => new DOMException('quota', 'QuotaExceededError');
    // jsdom 的 localStorage 是 Proxy：在实例上定义属性会被当成存储项写入，
    // stub 必须打在 Storage.prototype 上才会真正替换方法（Task 2 先例）。
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    const attempts: string[] = [];
    spy.mockImplementation((_key, value) => {
      attempts.push(String(value));
      if (attempts.length < 4) throw quota(); // 前 3 次配额失败，第 4 次成功
    });
    try {
      const p = createPersistence({
        isLeader: () => true,
        getSnapshot: bigSnapshot,
        // 不注入 savePersisted → 走真实 bridge（localStorage 兜底路径）
      });
      await p.flushNow(); // 不应向上抛：第 4 次重试成功

      expect(spy).toHaveBeenCalledTimes(4);
      const [raw0, raw1, raw2, raw3] = attempts.map((raw) => JSON.parse(raw) as Record<string, unknown>);
      const libOf = (patch: Record<string, unknown>) =>
        patch.library as {
          tracks: Record<string, { coverThumb?: string; title: string }>;
          history: unknown[];
        };

      // 原始 payload
      expect(libOf(raw0).tracks.a.coverThumb).toBe('data:image/jpeg;base64,AAA');
      expect(libOf(raw0).history).toHaveLength(80);
      expect(raw0.resume).toEqual({ trackId: 'a', positionMs: 5000 });
      // 裁剪 1：coverThumb 全剥（history/resume 未动）
      expect(libOf(raw1).tracks.a.coverThumb).toBeUndefined();
      expect(libOf(raw1).tracks.c).toEqual({ title: 'C' });
      expect(libOf(raw1).history).toHaveLength(80);
      expect(raw1.resume).toEqual({ trackId: 'a', positionMs: 5000 });
      // 裁剪 2：history 截到 50（coverThumb 仍剥）
      expect(libOf(raw2).history).toHaveLength(50);
      expect(libOf(raw2).tracks.a.coverThumb).toBeUndefined();
      expect(raw2.resume).toEqual({ trackId: 'a', positionMs: 5000 });
      // 裁剪 3：resume 清空
      expect(raw3.resume).toBeNull();
      expect(libOf(raw3).history).toHaveLength(50);

      // 裁剪不得污染调用方快照本体：再跑一次全失败的 flushNow 后检查
      const snap = bigSnapshot();
      const p2 = createPersistence({ isLeader: () => true, getSnapshot: () => snap });
      const spy2 = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw quota();
      });
      try {
        await expect(p2.flushNow()).rejects.toThrow(); // 裁剪到底仍失败 → 抛出
        expect((snap.library as { tracks: Record<string, { coverThumb?: string }> }).tracks.a.coverThumb).toBe(
          'data:image/jpeg;base64,AAA',
        );
      } finally {
        spy2.mockRestore();
      }
    } finally {
      spy.mockRestore();
      window.localStorage.removeItem(STATE_KEY);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Task 2 审查点：savePersisted 的 rejection 必须被持久化模块消费——
 * flushNow 路径向上抛（调用方可 await 失败），定时器路径必须吞掉。
 * ------------------------------------------------------------------ */

describe('createPersistence 错误传播', () => {
  it('⑤ savePersisted reject（非配额错误）时 flushNow 向上抛且不裁剪重试', async () => {
    const savePersisted = vi.fn(async () => {
      throw new Error('host-gone');
    });
    const p = createPersistence({
      isLeader: () => true,
      getSnapshot: () => ({ settings: { a: 1 } }),
      savePersisted: savePersisted as (patch: Record<string, unknown>) => Promise<void>,
    });
    await expect(p.flushNow()).rejects.toThrow('host-gone');
    expect(savePersisted).toHaveBeenCalledTimes(1);
  });

  it('scheduleSave 定时写失败被消费（不产生未处理 rejection）', async () => {
    const savePersisted = vi.fn(async () => {
      throw new Error('disk-full');
    });
    const p = createPersistence({
      isLeader: () => true,
      getSnapshot: () => ({ settings: { a: 1 } }),
      savePersisted: savePersisted as (patch: Record<string, unknown>) => Promise<void>,
    });
    p.scheduleSave('settings');
    await vi.advanceTimersByTimeAsync(400);
    expect(savePersisted).toHaveBeenCalledTimes(1);
  });
});
