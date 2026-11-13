import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlayerStore } from '../state/store';
import { createRuntime, type RuntimeOptions } from './runtime';
import type { AppRuntime } from './actions';
import type { Bus, BusMsg } from '../state/bus';
import { sessionSnapshot } from './session';

function media() {
  const element = document.createElement('audio');
  let paused = true;
  Object.defineProperty(element, 'paused', { get: () => paused });
  Object.defineProperty(element, 'play', { configurable: true, value: vi.fn(async () => { paused = false; element.dispatchEvent(new Event('playing')); }) });
  Object.defineProperty(element, 'pause', { value: vi.fn(() => { paused = true; element.dispatchEvent(new Event('pause')); }) });
  return element;
}
function busPair(): [Bus, Bus] {
  const first = new Set<(message: BusMsg) => void>();
  const second = new Set<(message: BusMsg) => void>();
  return [
    { post: (message) => second.forEach((handler) => handler(message)), on: (handler) => { first.add(handler); return () => { first.delete(handler); }; } },
    { post: (message) => first.forEach((handler) => handler(message)), on: (handler) => { second.add(handler); return () => { second.delete(handler); }; } },
  ];
}
const runtimes: AppRuntime[] = [];
const cleanups: (() => void)[] = [];
function register<T extends AppRuntime>(runtime: T): T { runtimes.push(runtime); return runtime; }
afterEach(async () => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.shutdown ? runtime.shutdown().catch(() => {}) : runtime.dispose()));
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** 非回声、序列化后的跨页消息；允许真实延迟和指定消息乱序。 */
function delayedBus(delay: (message: BusMsg, recipient: number) => number | null = () => 250) {
  const peers: Set<(message: BusMsg) => void>[] = [];
  const messages: BusMsg[] = [];
  const deliveries: { message: BusMsg; recipient: number; timer: ReturnType<typeof setTimeout> | null; run: () => void }[] = [];
  const connect = (): Bus => {
    const source = peers.length;
    const handlers = new Set<(message: BusMsg) => void>(); peers.push(handlers);
    return {
      post(message) {
        messages.push(JSON.parse(JSON.stringify(message)) as BusMsg);
        peers.forEach((target, recipient) => {
          if (source === recipient) return;
          const copy = JSON.parse(JSON.stringify(message)) as BusMsg;
          const delivery = { message: copy, recipient, timer: null as ReturnType<typeof setTimeout> | null, run: () => {
            const index = deliveries.indexOf(delivery); if (index < 0) return;
            deliveries.splice(index, 1); if (delivery.timer !== null) clearTimeout(delivery.timer);
            [...target].forEach((handler) => handler(copy));
          } };
          deliveries.push(delivery);
          const ms = delay(copy, recipient);
          if (ms !== null) delivery.timer = setTimeout(delivery.run, ms);
        });
      },
      on(handler) { handlers.add(handler); return () => { handlers.delete(handler); }; },
      close() { handlers.clear(); },
    };
  };
  cleanups.push(() => { deliveries.splice(0).forEach(({ timer }) => { if (timer !== null) clearTimeout(timer); }); });
  return { connect, messages, deliver(predicate: (message: BusMsg, recipient: number) => boolean) {
    const delivery = deliveries.find(({ message, recipient }) => predicate(message, recipient));
    delivery?.run(); return delivery?.message;
  } };
}

/** Web Locks 的共享独占队列，回调 Promise 完成前不会授予下一页。 */
function sharedLocks() {
  type Entry = { name: string; signal?: AbortSignal; callback: LockGrantedCallback<unknown>; resolve: (value: unknown) => void; reject: (error: unknown) => void; granted: boolean };
  const queue: Entry[] = [];
  let held = false;
  const pump = () => {
    if (held) return;
    const next = queue.shift(); if (!next) return;
    if (next.signal?.aborted) { next.reject(new DOMException('Aborted', 'AbortError')); pump(); return; }
    held = true; next.granted = true;
    void Promise.resolve().then(() => next.callback({ name: next.name, mode: 'exclusive' } as Lock)).then(next.resolve, next.reject).finally(() => { held = false; pump(); });
  };
  const request = ((name: string, options: LockOptions, callback: LockGrantedCallback<unknown>) => new Promise<unknown>((resolve, reject) => {
    const entry: Entry = { name, signal: options.signal, callback, resolve, reject, granted: false };
    options.signal?.addEventListener('abort', () => {
      if (entry.granted) return;
      const index = queue.indexOf(entry); if (index >= 0) queue.splice(index, 1);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
    queue.push(entry); pump();
  })) as LockManager['request'];
  return { request };
}
function page(options: Partial<RuntimeOptions> = {}) {
  const store = options.store ?? createPlayerStore();
  const element = options.media ?? media();
  const runtime = register(createRuntime({ route: 'panel', id: `page-${runtimes.length}`, store, media: element,
    transport: { resolve: async (path) => `blob:${path}`, readBytes: async () => new Uint8Array(), revoke: () => {}, prime: () => {} },
    bus: { post: () => {}, on: () => () => {} }, leadership: 'local', load: async () => null, save: async () => {}, ...options,
  }));
  return { runtime, store, element };
}
function seedStore() {
  const store = createPlayerStore();
  store.getState().importTracks([
    { id: 'a', path: 'D:/a.mp3', title: 'A', durationMs: 30000 },
    { id: 'b', path: 'D:/b.mp3', title: 'B', durationMs: 30000 },
  ]);
  return store;
}
function setup(resolve = async (path: string) => `blob:${path}`) {
  const store = createPlayerStore();
  store.getState().importTracks([
    { id: 'a', path: 'D:/a.mp3', title: 'A', durationMs: 30000 },
    { id: 'b', path: 'D:/b.mp3', title: 'B', durationMs: 30000 },
  ]);
  const element = media();
  const revoke = vi.fn();
  const runtime = createRuntime({ route: 'panel', store, media: element, id: 'first',
    transport: { resolve, readBytes: async () => new Uint8Array(), revoke, prime: () => {} },
    bus: { post: () => {}, on: () => () => {} },
    leadership: 'local', load: async () => null, save: async () => {},
  });
  register(runtime);
  return { runtime, store, element, revoke };
}
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
async function playingPair(delay?: (message: BusMsg, recipient: number) => number | null) {
  vi.useFakeTimers();
  const network = delayedBus(delay);
  const first = page({ id: 'first', store: seedStore(), bus: network.connect() });
  const second = page({ id: 'second', route: 'main', leadership: 'follower', bus: network.connect() });
  await first.runtime.start(); await second.runtime.start();
  await vi.advanceTimersByTimeAsync(1000);
  first.runtime.command({ op: 'setTrack', arg: 'a' }); await settle();
  await vi.advanceTimersByTimeAsync(1000);
  expect(first.element.paused).toBe(false);
  expect(second.runtime.getState().owner).toBe('first');
  return { first, second, network };
}

describe('播放与跨窗口集成', () => {
  it('成功装载后才标记播放，pause 保存实际媒体位置', async () => {
    const { runtime, store, element } = setup();
    await runtime.start();
    runtime.command({ op: 'setTrack', arg: 'a' });
    await settle();
    expect(element.src).toBe('blob:D:/a.mp3');
    expect(store.getState().playback.playing).toBe(true);
    element.currentTime = 8;
    runtime.command({ op: 'pause' });
    expect(store.getState().playback.playing).toBe(false);
    expect(store.getState().resume?.a).toBe(8000);
  });

  it('迟到的整读结果释放而不覆盖新的曲目', async () => {
    let release!: (url: string) => void;
    const slow = new Promise<string>((resolve) => { release = resolve; });
    const { runtime, store, element, revoke } = setup((path) => path.endsWith('a.mp3') ? slow : Promise.resolve('blob:new-b'));
    await runtime.start();
    runtime.command({ op: 'setTrack', arg: 'a' });
    runtime.command({ op: 'setTrack', arg: 'b' });
    await settle();
    release('blob:late-a');
    await settle();
    expect(store.getState().playback.trackId).toBe('b');
    expect(element.src).toBe('blob:new-b');
    expect(revoke).toHaveBeenCalledWith('blob:late-a');
  });

  it('顺序模式最后一首自然结束停止，列表循环回第一首', async () => {
    const { runtime, store, element } = setup();
    await runtime.start();
    runtime.command({ op: 'setTrack', arg: 'b' });
    await settle();
    element.dispatchEvent(new Event('ended'));
    await settle();
    expect(store.getState().playback.playing).toBe(false);
    store.getState().setPlayMode('repeat_all');
    runtime.command({ op: 'setTrack', arg: 'b' });
    await settle();
    element.dispatchEvent(new Event('ended'));
    await settle();
    expect(store.getState().playback.trackId).toBe('a');
    expect(store.getState().playback.playing).toBe(true);
  });

  it('操作窗口接管音频而歌单仍由唯一主控写入，旧媒体停止', async () => {
    const [busA, busB] = busPair();
    const storeA = createPlayerStore(); const storeB = createPlayerStore();
    const audioA = media(); const audioB = media();
    const transport = { resolve: async () => 'blob:song', readBytes: async () => new Uint8Array(), revoke: () => {}, prime: () => {} };
    storeA.getState().importTracks([{ id: 'a', path: 'D:/a.mp3', title: 'A', durationMs: 30000 }]);
    const first = createRuntime({ route: 'panel', store: storeA, media: audioA, id: 'first', bus: busA, transport, leadership: 'local', load: async () => null, save: async () => {} });
    const second = createRuntime({ route: 'main', store: storeB, media: audioB, id: 'second', bus: busB, transport, leadership: 'follower', load: async () => null, save: async () => {} });
    register(first); register(second);
    await first.start(); await second.start();
    first.command({ op: 'setTrack', arg: 'a' });
    await settle();
    second.command({ op: 'setTrack', arg: 'a' });
    await settle();
    expect(storeB.getState().playback.trackId).toBe('a');
    expect(storeB.getState().playback.playing).toBe(true);
    expect(audioB.play).toHaveBeenCalledOnce();
    expect(audioA.pause).toHaveBeenCalled();
    expect(first.getState().owner).toBe('second');
    second.action({ type: 'like', id: 'a' });
    await settle();
    expect(storeA.getState().library.tracks.a.liked).toBe(true);
    expect(storeB.getState().library.tracks.a.liked).toBe(true);
  });

  it('暂停后旧播放Promise成功也不能把状态重新变成播放', async () => {
    const { runtime, store, element } = setup();
    let release!: () => void;
    Object.defineProperty(element, 'play', { configurable: true, value: vi.fn(() => new Promise<void>((resolve) => { release = resolve; })) });
    await runtime.start();
    runtime.command({ op: 'setTrack', arg: 'a' });
    await settle();
    runtime.command({ op: 'pause' });
    release();
    await settle();
    expect(store.getState().playback.playing).toBe(false);
  });

  it('浏览器拒绝播放时显示错误而不是假装播放', async () => {
    const { runtime, store, element } = setup();
    Object.defineProperty(element, 'play', { configurable: true, value: vi.fn(async () => { throw new DOMException('User gesture required', 'NotAllowedError'); }) });
    await runtime.start();
    runtime.command({ op: 'setTrack', arg: 'a' });
    await settle();
    expect(store.getState().playback.playing).toBe(false);
    expect(runtime.getState().error).toContain('User gesture');
  });

  it('文件导入先出现文件名而不是等待整文件读取', async () => {
    const { runtime, store } = setup();
    await runtime.start();
    runtime.importPaths(['D:/Music/new-track.wav']);
    expect(store.getState().library.tracks['D:/Music/new-track.wav'].title).toBe('new-track');
  });

  it('尚未播放时音量和静音设置仍可修改', async () => {
    const { runtime, store } = setup();
    await runtime.start();
    runtime.command({ op: 'volume', arg: 0.3 });
    expect(store.getState().playback.volume).toBe(0.3);
    runtime.command({ op: 'mute', arg: true });
    expect(store.getState().playback.muted).toBe(true);
    expect(store.getState().playback.playing).toBe(false);
  });

  it('停止扫描后在途元数据不能继续修改曲库', async () => {
    const { runtime, store } = setup();
    await runtime.start();
    runtime.importPaths(['D:/Music/new-track.wav']);
    runtime.action({ type: 'crawl-cancel' });
    await settle();
    expect(store.getState().library.tracks['D:/Music/new-track.wav'].status).toBe('ok');
  });

  it('空播放器点击播放按钮会选择当前列表第一首', async () => {
    const { runtime, store, element } = setup();
    await runtime.start();
    runtime.command({ op: 'toggle' });
    await settle();
    expect(store.getState().playback.trackId).toBe('a');
    expect(element.play).toHaveBeenCalledOnce();
  });

  it('预读加载中的旧媒体error不能污染已选新曲', async () => {
    let finish!: (url: string) => void;
    const { runtime, store, element } = setup((path) => path.endsWith('b.mp3') ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve('blob:a'));
    await runtime.start();
    runtime.command({ op: 'setTrack', arg: 'a' });
    await settle();
    runtime.command({ op: 'setTrack', arg: 'b' });
    element.dispatchEvent(new Event('error'));
    expect(store.getState().library.tracks.b.status).toBe('ok');
    finish('blob:b');
    await settle();
  });

  it('新窗口接管后按上一首重播会真正装载本窗口媒体', async () => {
    const [busA, busB] = busPair();
    const storeA = createPlayerStore(); const storeB = createPlayerStore();
    const audioA = media(); const audioB = media();
    const transport = { resolve: async () => 'blob:song', readBytes: async () => new Uint8Array(), revoke: () => {}, prime: () => {} };
    storeA.getState().importTracks([{ id: 'a', path: 'D:/a.mp3', durationMs: 30000 }]);
    const first = createRuntime({ route: 'panel', store: storeA, media: audioA, id: 'first', bus: busA, transport, leadership: 'local', load: async () => null, save: async () => {} });
    const second = createRuntime({ route: 'main', store: storeB, media: audioB, id: 'second', bus: busB, transport, leadership: 'follower', load: async () => null, save: async () => {} });
    register(first); register(second);
    await first.start(); await second.start();
    first.command({ op: 'setTrack', arg: 'a' }); await settle();
    audioA.currentTime = 8;
    audioA.dispatchEvent(new Event('timeupdate'));
    second.command({ op: 'prev' }); await settle();
    expect(audioB.src).toBe('blob:song');
    expect(audioB.play).toHaveBeenCalledOnce();
    expect(storeB.getState().playback.positionMs).toBe(0);
  });

  it('桌面歌词页只能镜像，不能接管播放', async () => {
    const { runtime } = setup();
    const lyrics = createRuntime({ route: 'lyrics', store: createPlayerStore(), media: media(), id: 'lyrics', leadership: 'follower',
      bus: { post: () => {}, on: () => () => {} }, load: async () => null, save: async () => {} });
    register(lyrics);
    await runtime.start(); await lyrics.start();
    lyrics.command({ op: 'setTrack', arg: 'a' });
    expect(lyrics.getState().owner).toBeNull();
  });
});

describe('异步生命周期回归', () => {
  it('迟到启动读取不能覆盖已销毁 runtime 的共享 store', async () => {
    const stale = sessionSnapshot(seedStore());
    const load = deferred<unknown>();
    const shared = seedStore();
    const old = page({ store: shared, load: () => load.promise });
    const starting = old.runtime.start();
    old.runtime.dispose();
    const current = page({ store: shared });
    await current.runtime.start();
    current.runtime.importPaths(['D:/new.mp3']);
    current.runtime.action({ type: 'like', id: 'a' });
    current.runtime.command({ op: 'volume', arg: 0.25 });
    await settle();
    load.resolve({ ...stale, windows: { 'yoyomusic-main': { x: 1, y: 2 } } });
    await starting;
    expect(shared.getState().library.tracks['D:/new.mp3']).toBeDefined();
    expect(shared.getState().library.tracks.a.liked).toBe(true);
    expect(shared.getState().playback.volume).toBe(0.25);
    expect(old.runtime.windowPosition?.('yoyomusic-main')).toBeUndefined();
  });

  it('dispose 保持独占锁直到在途、排队和最终写全部完成', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { locks: sharedLocks() });
    const network = delayedBus();
    let disk: Record<string, unknown> = {};
    let blocking = true; let active = 0; let maxActive = 0;
    const writes: { owner: string; finish: ReturnType<typeof deferred<void>> }[] = [];
    const save = (owner: string) => async (patch: Record<string, unknown>) => {
      const finish = deferred<void>(); writes.push({ owner, finish });
      active += 1; maxActive = Math.max(maxActive, active);
      if (blocking) await finish.promise;
      disk = { ...disk, ...patch }; active -= 1;
    };
    cleanups.push(() => { blocking = false; writes.forEach(({ finish }) => finish.resolve()); });
    const first = page({ id: 'old', leadership: 'auto', store: seedStore(), bus: network.connect(), save: save('old') });
    const second = page({ id: 'new', route: 'main', leadership: 'auto', store: seedStore(), bus: network.connect(), save: save('new') });
    await first.runtime.start(); await settle();
    first.runtime.action({ type: 'like', id: 'a' }); await settle();
    first.runtime.action({ type: 'like', id: 'b' });
    await second.runtime.start(); await settle();
    first.runtime.dispose();
    const shuttingDown = first.runtime.shutdown?.();
    second.runtime.action({ type: 'settings', patch: { skin: 'sunset' } }); await settle();
    expect(writes.map(({ owner }) => owner)).toEqual(['old']);
    expect(network.messages.some((message) => message.t === 'coordinator-gone' && message.from === 'old')).toBe(false);
    writes[0].finish.resolve(); await settle();
    expect(writes.map(({ owner }) => owner)).toEqual(['old', 'old']);
    writes[1].finish.resolve(); await settle();
    expect(writes.map(({ owner }) => owner)).toEqual(['old', 'old', 'old']);
    writes[2].finish.resolve(); await shuttingDown; await settle();
    expect(writes.map(({ owner }) => owner)).toEqual(['old', 'old', 'old', 'new']);
    writes[3].finish.resolve(); await settle();
    expect((disk.settings as { skin: string }).skin).toBe('sunset');
    expect(maxActive).toBe(1);
    expect(first.runtime.shutdown?.()).toBe(shuttingDown);
  });

  it('持锁重读销毁后迟到读取不能改共享 store 且仍可交接锁', async () => {
    vi.useFakeTimers(); const locks = sharedLocks();
    const stale = deferred<unknown>(); let reads = 0; const shared = seedStore();
    cleanups.push(() => stale.resolve(sessionSnapshot(seedStore())));
    const old = page({ id: 'old', store: shared, leadership: 'auto', locks,
      load: async () => ++reads === 1 ? sessionSnapshot(seedStore()) : stale.promise,
    });
    await old.runtime.start(); await settle();
    await old.runtime.shutdown?.();
    const currentWrites: Record<string, unknown>[] = [];
    const current = page({ id: 'current', store: shared, leadership: 'auto', locks, save: async (patch) => { currentWrites.push(patch); } });
    await current.runtime.start(); await settle();
    current.runtime.importPaths(['D:/new-owner.mp3']);
    current.runtime.action({ type: 'like', id: 'a' }); await settle();
    expect(currentWrites.length).toBeGreaterThan(0);
    stale.resolve(sessionSnapshot(seedStore())); await settle();
    expect(shared.getState().library.tracks['D:/new-owner.mp3']).toBeDefined();
    expect(shared.getState().library.tracks.a.liked).toBe(true);
  });

  it('shutdown 后入口冻结且迟到曲目读取只释放 URL', async () => {
    const resolving = deferred<string>(); const revoked: string[] = []; const store = seedStore();
    const { runtime, element } = page({ store, transport: {
      resolve: () => resolving.promise, readBytes: async () => new Uint8Array(), revoke: (url) => { revoked.push(url); }, prime: () => {},
    } });
    await runtime.start(); runtime.command({ op: 'setTrack', arg: 'a' });
    await runtime.shutdown?.();
    const state = store.getState();
    runtime.patchUi({ query: 'must-not-change' });
    runtime.importPaths(['D:/late.mp3']); runtime.action({ type: 'like', id: 'a' });
    runtime.command({ op: 'setTrack', arg: 'b' });
    resolving.resolve('blob:late'); await settle();
    expect(store.getState()).toBe(state);
    expect(element.src).toBe('');
    expect(revoked).toEqual(['blob:late']);
  });

  it('shutdown 最终写失败仍排空并释放锁且 Promise 向调用方报错', async () => {
    const locks = sharedLocks(); const write = deferred<void>(); const owners: string[] = []; let blocked = true;
    cleanups.push(() => { blocked = false; write.resolve(); });
    const old = page({ id: 'old', leadership: 'auto', locks, store: seedStore(), save: async () => {
      owners.push('old'); if (blocked) await write.promise; throw new Error('final-save-failed');
    } });
    await old.runtime.start(); await settle();
    const next = page({ id: 'next', route: 'main', leadership: 'auto', locks, store: seedStore(), save: async () => { owners.push('next'); } });
    await next.runtime.start(); await settle();
    const closing = old.runtime.shutdown!();
    const rejected = expect(closing).rejects.toThrow('final-save-failed');
    next.runtime.action({ type: 'like', id: 'a' }); await settle();
    expect(owners).toEqual(['old']);
    write.reject(new Error('final-save-failed')); await rejected; await settle();
    expect(owners).toEqual(['old', 'next']);
    expect(next.store.getState().library.tracks.a.liked).toBe(true);
  });

  it('shutdown 最终快照不能被较早写入的迟到配额重试覆盖', async () => {
    const blocked = deferred<void>(); let disk: Record<string, unknown> = {}; let attempts = 0;
    cleanups.push(() => blocked.resolve());
    const { runtime } = page({ store: seedStore(), save: async (patch) => {
      attempts += 1;
      if (attempts === 1) { await blocked.promise; throw new DOMException('quota', 'QuotaExceededError'); }
      disk = { ...disk, ...patch };
    } });
    await runtime.start();
    runtime.action({ type: 'like', id: 'a' }); await settle();
    runtime.action({ type: 'like', id: 'b' });
    const closing = runtime.shutdown?.();
    blocked.resolve(); await closing;
    expect((disk.library as { tracks: Record<string, { liked: boolean }> }).tracks.b.liked).toBe(true);
  });
});

describe('数据协调者异步回归', () => {
  it('无 Web Locks 且 claim 延迟超过150ms时 main 永不写入', async () => {
    vi.useFakeTimers(); vi.stubGlobal('navigator', {});
    const network = delayedBus(() => 400);
    let disk: Record<string, unknown> = {}; const owners: string[] = [];
    const save = (owner: string) => async (patch: Record<string, unknown>) => { owners.push(owner); disk = { ...disk, ...patch }; };
    const panel = page({ id: 'panel', leadership: 'auto', store: seedStore(), bus: network.connect(), save: save('panel') });
    const main = page({ id: 'main', route: 'main', leadership: 'auto', store: seedStore(), bus: network.connect(), save: save('main') });
    await panel.runtime.start(); await main.runtime.start();
    panel.runtime.action({ type: 'like', id: 'a' });
    main.runtime.action({ type: 'like', id: 'b' });
    await vi.advanceTimersByTimeAsync(200);
    expect(owners).not.toContain('main');
    await vi.advanceTimersByTimeAsync(1400);
    expect(owners.length).toBeGreaterThan(0);
    expect(new Set(owners)).toEqual(new Set(['panel']));
    expect((disk.library as { tracks: Record<string, { liked: boolean }> }).tracks.a.liked).toBe(true);
    expect((disk.library as { tracks: Record<string, { liked: boolean }> }).tracks.b.liked).toBe(true);
    await panel.runtime.shutdown?.(); await vi.advanceTimersByTimeAsync(1000);
    const writesBefore = owners.length;
    main.runtime.action({ type: 'settings', patch: { skin: 'sunset' } });
    await vi.advanceTimersByTimeAsync(5000);
    expect(owners).toHaveLength(writesBefore);
    expect(main.runtime.getState().error).toMatch(/面板/);
    expect(main.runtime.getState().error).toMatch(/重新|打开/);
  });

  it('持锁后重读当前快照保留导入喜欢与真实 audio session', async () => {
    vi.useFakeTimers(); vi.stubGlobal('navigator', { locks: sharedLocks() });
    const network = delayedBus(() => null);
    let disk = sessionSnapshot(seedStore());
    const load = async () => JSON.parse(JSON.stringify(disk)) as unknown;
    const save = async (patch: Record<string, unknown>) => { disk = { ...disk, ...patch }; };
    const panel = page({ id: 'panel', leadership: 'auto', bus: network.connect(), load, save });
    const main = page({ id: 'main', route: 'main', leadership: 'auto', bus: network.connect(), load, save });
    await panel.runtime.start(); await settle(); await main.runtime.start(); await settle();
    main.runtime.command({ op: 'setTrack', arg: 'a' }); await settle();
    main.element.currentTime = 9;
    main.element.dispatchEvent(new Event('timeupdate'));
    panel.runtime.importPaths(['D:/imported.mp3']); panel.runtime.action({ type: 'crawl-cancel' });
    panel.runtime.action({ type: 'like', id: 'a' }); await settle();
    await panel.runtime.shutdown?.(); await settle();
    expect(main.store.getState().library.tracks['D:/imported.mp3']).toBeDefined();
    expect(main.store.getState().library.tracks.a.liked).toBe(true);
    expect(main.store.getState().playback).toMatchObject({ trackId: 'a', playing: true, positionMs: 9000 });
    expect(main.element.paused).toBe(false);
    main.runtime.action({ type: 'settings', patch: { skin: 'sunset' } }); await settle();
    while (network.deliver((message, recipient) => message.t === 'state-snap' && message.from === 'panel' && recipient === 1)) {}
    expect(main.store.getState().library.tracks['D:/imported.mp3']).toBeDefined();
    expect((disk.library as { tracks: Record<string, { liked: boolean }> }).tracks.a.liked).toBe(true);
    expect((disk.settings as { skin: string }).skin).toBe('sunset');
  });

  it('持锁重读期间到达的 state-mutate 在激活后重放', async () => {
    vi.useFakeTimers(); vi.stubGlobal('navigator', { locks: sharedLocks() });
    const network = delayedBus(() => 250); const sender = network.connect();
    const reload = deferred<unknown>(); const saved: Record<string, unknown>[] = []; let reads = 0;
    cleanups.push(() => reload.resolve(sessionSnapshot(seedStore())));
    const candidate = page({ id: 'candidate', leadership: 'auto', bus: network.connect(),
      load: async () => ++reads === 1 ? sessionSnapshot(seedStore()) : reload.promise,
      save: async (patch) => { saved.push(patch); },
    });
    await candidate.runtime.start(); await settle();
    sender.post({ t: 'state-mutate', key: 'library', patch: { action: { type: 'like', id: 'a' } }, from: 'sender' });
    await vi.advanceTimersByTimeAsync(300);
    expect(saved).toHaveLength(0);
    reload.resolve(sessionSnapshot(seedStore())); await settle();
    expect(candidate.store.getState().library.tracks.a.liked).toBe(true);
    expect((saved.at(-1)?.library as { tracks: Record<string, { liked: boolean }> }).tracks.a.liked).toBe(true);
  });
});

describe('异步音频接管回归', () => {
  it('延迟 bus 接管必须等旧 owner 同步暂停后的 ack 才播放', async () => {
    const { first, second } = await playingPair();
    second.runtime.command({ op: 'setTrack', arg: 'b' }); await settle();
    expect(first.element.paused).toBe(false);
    expect(second.element.src).toBe('');
    expect(second.element.paused).toBe(true);
    await vi.advanceTimersByTimeAsync(250);
    expect(first.element.paused).toBe(true);
    expect(second.element.paused).toBe(true);
    await vi.advanceTimersByTimeAsync(250);
    expect(second.element.paused).toBe(false);
    expect(second.store.getState().playback.trackId).toBe('b');
    expect(first.element.paused).toBe(true);
  });

  it('接管 ack 超时提示重试且不把无回应当作成功', async () => {
    const { first, second } = await playingPair((message) => message.t === 'audio-handover-request' ? null : 250);
    second.runtime.command({ op: 'setTrack', arg: 'b' });
    await vi.advanceTimersByTimeAsync(10000);
    expect(first.element.paused).toBe(false);
    expect(second.element.paused).toBe(true);
    expect(second.element.src).toBe('');
    expect(second.runtime.getState().error).toMatch(/重试/);
  });

  it('连续接管请求只接受匹配 version 与 epoch 的最新 ack', async () => {
    const { first, second, network } = await playingPair((message) => message.t === 'audio-handover-request' || message.t === 'audio-handover-ack' ? null : 250);
    second.runtime.command({ op: 'setTrack', arg: 'a' });
    second.runtime.command({ op: 'setTrack', arg: 'b' });
    const requests = network.messages.filter((message) => message.t === 'audio-handover-request');
    expect(requests).toHaveLength(2);
    network.deliver((message) => message.t === 'audio-handover-request');
    network.deliver((message) => message.t === 'audio-handover-ack'); await settle();
    expect(first.element.paused).toBe(true);
    expect(second.element.src).toBe('');
    network.deliver((message) => message.t === 'audio-handover-request');
    network.deliver((message) => message.t === 'audio-handover-ack'); await settle();
    expect(second.element.src).toBe('blob:D:/b.mp3');
    expect(second.element.paused).toBe(false);
  });

  it('暂停取消待接管后迟到 ack 不会重新加载播放', async () => {
    const { second, network } = await playingPair((message) => message.t === 'audio-handover-ack' ? null : 250);
    second.runtime.command({ op: 'setTrack', arg: 'b' });
    await vi.advanceTimersByTimeAsync(250);
    second.runtime.command({ op: 'pause' });
    network.deliver((message) => message.t === 'audio-handover-ack'); await settle();
    expect(second.element.src).toBe('');
    expect(second.element.paused).toBe(true);
    expect(second.runtime.getState().owner).not.toBe('second');
  });

  it('旧 owner 同步停止后关闭广播 gone 可解锁等待的接管', async () => {
    const { first, second } = await playingPair((message) => message.t === 'audio-handover-request' ? null : 250);
    second.runtime.command({ op: 'setTrack', arg: 'b' }); await settle();
    expect(second.element.paused).toBe(true);
    await first.runtime.shutdown?.();
    expect(first.element.paused).toBe(true);
    await vi.advanceTimersByTimeAsync(250);
    expect(second.element.paused).toBe(false);
    expect(second.element.src).toBe('blob:D:/b.mp3');
  });

  it('取消消息先于接管请求到达时旧 owner 不会被迟到请求暂停', async () => {
    const { first, second, network } = await playingPair((message) => message.t === 'audio-handover-request' || message.t === 'audio-handover-cancel' ? null : 250);
    second.runtime.command({ op: 'setTrack', arg: 'b' });
    second.runtime.command({ op: 'pause' });
    network.deliver((message) => message.t === 'audio-handover-cancel');
    network.deliver((message) => message.t === 'audio-handover-request');
    expect(first.element.paused).toBe(false);
    expect(second.element.paused).toBe(true);
  });

  it('升级请求的取消先于升级请求到达可解除旧 grant', async () => {
    const { first, second, network } = await playingPair((message) => message.t === 'audio-handover-request' || message.t === 'audio-handover-cancel' || message.t === 'audio-handover-ack' ? null : 250);
    second.runtime.command({ op: 'setTrack', arg: 'a' });
    network.deliver((message) => message.t === 'audio-handover-request');
    second.runtime.command({ op: 'setTrack', arg: 'b' });
    second.runtime.command({ op: 'pause' });
    network.deliver((message) => message.t === 'audio-handover-cancel');
    network.deliver((message) => message.t === 'audio-handover-request');
    first.runtime.command({ op: 'play' }); await settle();
    expect(first.element.paused).toBe(false);
    expect(second.element.paused).toBe(true);
  });

  it('旧 owner 已发出 ack 后不能在确认迟到期间直接恢复双播', async () => {
    const { first, second, network } = await playingPair((message) => message.t === 'audio-handover-ack' || message.t === 'takeover' ? null : 250);
    second.runtime.command({ op: 'setTrack', arg: 'b' });
    await vi.advanceTimersByTimeAsync(250);
    first.runtime.command({ op: 'play' }); await settle();
    expect(first.element.paused).toBe(true);
    network.deliver((message) => message.t === 'audio-handover-ack'); await settle();
    expect(second.element.paused).toBe(false);
    expect(first.element.paused).toBe(true);
  });

  it('接管完成后原页面仍能再次点击安全接管音频', async () => {
    const { first, second } = await playingPair();
    second.runtime.command({ op: 'setTrack', arg: 'b' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(second.element.paused).toBe(false);
    first.runtime.command({ op: 'setTrack', arg: 'a' }); await settle();
    expect(first.element.paused).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(first.element.paused).toBe(false);
    expect(second.element.paused).toBe(true);
    expect(first.store.getState().playback.trackId).toBe('a');
  });

  it('暂停的旧 owner 接管等待中再次 toggle 会取消而不是播放', async () => {
    const { first, second } = await playingPair();
    first.runtime.command({ op: 'pause' }); await vi.advanceTimersByTimeAsync(250);
    second.runtime.command({ op: 'setTrack', arg: 'b' });
    second.runtime.command({ op: 'toggle' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(second.element.src).toBe('');
    expect(second.element.paused).toBe(true);
  });

  it('旧 owner 发出 ack 后关闭仍广播 gone 解锁等待请求', async () => {
    const { first, second } = await playingPair((message) => message.t === 'audio-handover-ack' ? null : 250);
    second.runtime.command({ op: 'setTrack', arg: 'b' });
    await vi.advanceTimersByTimeAsync(250);
    await first.runtime.shutdown?.();
    await vi.advanceTimersByTimeAsync(250);
    expect(second.element.paused).toBe(false);
    expect(second.element.src).toBe('blob:D:/b.mp3');
  });

  it('无旧 owner 首播无需等待跨页 ack', async () => {
    vi.useFakeTimers(); const network = delayedBus(() => null);
    const { runtime, element } = page({ store: seedStore(), bus: network.connect() });
    await runtime.start(); runtime.command({ op: 'setTrack', arg: 'a' }); await settle();
    expect(element.paused).toBe(false);
    expect(network.messages.some((message) => message.t === 'audio-handover-request')).toBe(false);
  });
});
