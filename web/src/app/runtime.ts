import { createCrawler, type Crawler } from '../library/crawler';
import { createBlobTransport, type BlobTransport } from '../audio/transport';
import { AudioEngine, unmuteVolume } from '../audio/engine';
import { parseMetadata } from '../audio/metadata';
import { pickAudioFiles, pickDirectory, listDirectoryRecursive, loadPersisted, savePersisted, openPluginWindow, getFallbackFile } from '../bridge/otools';
import { createBus, type Bus, type BusMsg } from '../state/bus';
import { useStore, type StoreState, type Track } from '../state/store';
import type { StoreApi } from 'zustand';
import { SignalEngine, type SignalFrame } from '../signal/engine';
import { bandEdges, foldBands, normalizeBands, downsampleWave, computeBeat, computeLevel } from '../signal/analyse';
import { resolveLyrics } from '../lyrics/resolve';
import { isAudioPath } from '../library/import';
import { createPersistence } from '../state/persist';
import { applyDataAction } from './data';
import { hydrateSession, sessionSnapshot } from './session';
import type { AppRuntime, DataAction, PlaybackPacket, PlayerCommand, RuntimeState } from './actions';

export interface RuntimeOptions {
  route: 'panel' | 'main' | 'lyrics'; store?: StoreApi<StoreState>; media?: HTMLAudioElement;
  transport?: BlobTransport; bus?: Bus; id?: string;
  leadership?: 'local' | 'follower' | 'auto';
  /** 与所有页面共享的锁；null 显式启用仅 panel 写入的降级模式。 */
  locks?: Pick<LockManager, 'request'> | null;
  load?: () => Promise<unknown>; save?: (patch: Record<string, unknown>) => Promise<void>;
}
type DataRequest = { action?: DataAction; paths?: string[]; names?: Record<string, string>; meta?: { id: string; patch: Partial<Track> }; selected?: string; clearResume?: string };
type WirePlayback = PlaybackPacket & { error?: string | null; epoch: number; frame?: { bands: number[]; wave: number[]; level: number; beat: number } };

/** 音频归属随用户操作切换；数据协调页持有独占锁，串行写宿主状态。 */
export function createRuntime(options: RuntimeOptions): AppRuntime {
  const store = options.store ?? useStore;
  const media = options.media ?? document.createElement('audio');
  media.preload = 'auto';
  const transport = options.transport ?? createBlobTransport();
  const bus = options.bus ?? createBus();
  const id = options.id ?? `yoyo-${crypto.randomUUID()}`;
  const locks = options.locks === undefined ? navigator.locks : options.locks;
  const fallbackNotice = '此环境不支持 Web Locks，仅插件面板可保存数据；关闭面板后暂不自动恢复主控，请重新打开面板。';
  let authorityPending = false;
  let reloadingAuthority = false;
  const listeners = new Set<() => void>();
  let state: RuntimeState = { loading: false, ready: false, error: null, owner: null,
    lyrics: { lines: [], source: 'none' }, updatedAt: 0, route: options.route };
  let coordinator = false;
  let audioOwner = false;
  let coordinatorId: string | null = null;
  let audioEpoch = 0;
  let disposed = false;
  let shutdownPromise: Promise<void> | null = null;
  let finalizing = false;
  let started = false;
  let initialized = false;
  let requestVersion = 0;
  let handoverVersion = 0;
  type AudioRequest = { owner: string; ownerEpoch: number; epoch: number; requestId: number; command: PlayerCommand; timer: ReturnType<typeof setTimeout> };
  let pendingAudio: AudioRequest | null = null;
  let grantedAudio: { from: string; ownerEpoch: number; epoch: number; requestId: number } | null = null;
  const cancelledAudio = new Map<string, { ownerEpoch: number; requestId: number }>();
  const epoch = Date.now();
  let releaseLock: (() => void) | null = null;
  const lockAbort = new AbortController();
  const pending: Array<() => void> = [];
  const earlyMessages: BusMsg[] = [];
  const pendingData: DataRequest[] = [];
  let crawler: Crawler | null = null;
  const positions: Record<string, { x: number; y: number }> = {};
  const synth = new SignalEngine('yoyomusic');
  let synthTrack: string | undefined;
  const peak = { v: 0 };
  const beat = { ema: 0, pulse: 0 };
  let remoteFrame: SignalFrame | null = null;
  let remoteFrameAt = 0;
  let frameAt = performance.now();
  let signalRequestAt = 0;
  let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSaveAt = 0;
  const engine = new AudioEngine(media, () => null, { transport, getStore: () => store.getState() });
  const notify = (patch: Partial<RuntimeState>) => {
    if (disposed) return;
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  };
  const failure = (error: unknown) => notify({ error: error instanceof Error ? error.message : String(error), loading: false });

  // 独占页内的 debounce 和位置冲刷也走同一条串行写队列。
  let saveQueue = Promise.resolve();
  let closingSnapshot: Record<string, unknown> | null = null;
  const rawSave = options.save ?? savePersisted;
  const persistence = createPersistence({ isLeader: () => coordinator && (!disposed || finalizing),
    getSnapshot: () => closingSnapshot ?? ({ ...sessionSnapshot(store), windows: positions }),
    savePersisted: (patch) => {
      const copy = JSON.parse(JSON.stringify(patch)) as Record<string, unknown>;
      const write = saveQueue.catch(() => {}).then(() => rawSave(copy));
      saveQueue = write;
      return write;
    },
  });
  const saveFull = () => { if (coordinator) void persistence.flushNow().catch(failure); };
  const snapshot = () => ({ ...sessionSnapshot(store), playback: store.getState().playback,
    runtime: { loading: state.loading, lyrics: state.lyrics, owner: state.owner, audioEpoch }, windows: positions });
  const publishSnapshot = () => { if (coordinator && !disposed) bus.post({ t: 'state-snap', snap: snapshot(), from: id }); };
  const scheduleSnapshot = () => {
    if (snapshotTimer) return;
    snapshotTimer = setTimeout(() => { snapshotTimer = null; publishSnapshot(); persistence.scheduleSave('library'); }, 100);
  };
  const publishPlayback = (frame?: SignalFrame) => {
    if (!audioOwner || disposed) return;
    const packet: WirePlayback = { playback: store.getState().playback, lyrics: state.lyrics,
      loading: state.loading, sentAt: Date.now(), error: state.error, epoch: audioEpoch };
    if (frame) packet.frame = { bands: Array.from(frame.bands), wave: Array.from(frame.wave), level: frame.level, beat: frame.beat };
    // 用普通数组承载信号，localStorage JSON兜底与结构化克隆的形状一致。
    bus.post({ t: 'playback', from: id, state: packet });
  };
  const currentPosition = () => audioOwner && engine.playingTrackId === store.getState().playback.trackId
    ? Math.round(media.currentTime * 1000) : store.getState().playback.positionMs;
  const savePosition = () => {
    const playback = store.getState().playback;
    if (audioOwner && playback.trackId) store.getState().recordResume(playback.trackId, currentPosition());
  };
  const applyMediaSettings = () => {
    const playback = store.getState().playback;
    engine.setVolume(playback.volume); engine.setMuted(playback.muted); engine.setEQ(playback.eqEnabled, playback.eqBands);
  };
  const readFrame = (dt: number): SignalFrame | null => {
    if (!audioOwner) return Date.now() - remoteFrameAt < 500 ? remoteFrame : null;
    if (!store.getState().playback.playing) return null;
    const raw = engine.getAnalyserFrame();
    if (!raw) return null;
    const bandsRaw = foldBands(raw.bins, bandEdges(raw.sampleRate, raw.bins.length));
    const bytes = downsampleWave(raw.wave);
    return { bands: normalizeBands(bandsRaw, peak), wave: Float32Array.from(bytes, (value) => (value - 128) / 128),
      level: computeLevel(bytes), beat: computeBeat(bandsRaw, beat, dt) };
  };

  function sendData(patch: DataRequest): void {
    if (disposed) return;
    if (coordinator) receiveData(patch);
    else if (!reloadingAuthority && coordinatorId && coordinatorId !== id) bus.post({ t: 'state-mutate', key: 'library', patch, from: id });
    else pendingData.push(patch);
  }
  const flushData = () => { while (!disposed && !reloadingAuthority && pendingData.length && (coordinator || coordinatorId && coordinatorId !== id)) sendData(pendingData.shift()!); };
  const cancelAudioRequest = () => {
    const request = pendingAudio;
    pendingAudio = null; handoverVersion += 1;
    if (request) {
      clearTimeout(request.timer);
      bus.post({ t: 'audio-handover-cancel', from: id, to: request.owner, epoch: request.epoch, ownerEpoch: request.ownerEpoch, requestId: request.requestId });
    }
  };
  const activateAudio = (value: number) => {
    if (disposed || options.route === 'lyrics') return;
    audioEpoch = value; audioOwner = true; remoteFrame = null; grantedAudio = null;
    engine.takeOver(audioEpoch); notify({ owner: id, loading: false, error: null });
    bus.post({ t: 'takeover', from: id, epoch: audioEpoch });
  };
  const completeAudioRequest = (request: AudioRequest) => {
    if (disposed || pendingAudio !== request || request.requestId !== handoverVersion) return;
    if (audioEpoch > request.epoch) { cancelAudioRequest(); return; }
    clearTimeout(request.timer); pendingAudio = null;
    activateAudio(request.epoch); execute(request.command);
  };
  const claimAudio = (command: PlayerCommand) => {
    if (options.route === 'lyrics' || disposed) return;
    engine.prepare(); // 点击手势只解锁音频图；收到暂停确认前不能 load/play。
    if (audioOwner) { execute(command); return; }
    if (grantedAudio) { failure('音频接管正在确认，请稍后重试。'); return; }
    const oldRequest = pendingAudio;
    if (oldRequest) clearTimeout(oldRequest.timer);
    pendingAudio = null; handoverVersion += 1;
    const value = Math.max(Date.now(), audioEpoch + 1, (oldRequest?.epoch ?? 0) + 1);
    const owner = state.owner;
    if (!owner || owner === id) { activateAudio(value); execute(command); return; }
    const requestId = handoverVersion;
    const ownerEpoch = oldRequest?.owner === owner ? oldRequest.ownerEpoch : audioEpoch;
    const request: AudioRequest = { owner, ownerEpoch, epoch: value, requestId, command,
      timer: setTimeout(() => {
        if (disposed || pendingAudio !== request || requestId !== handoverVersion) return;
        cancelAudioRequest(); failure('音频接管未收到暂停确认，请重试。');
      }, 3000),
    };
    pendingAudio = request; notify({ loading: true, error: null });
    bus.post({ t: 'audio-handover-request', from: id, to: owner, epoch: value, ownerEpoch, requestId });
  };

  async function loadTrack(trackId: string, play = true, resumeMs = 0): Promise<void> {
    if (!audioOwner || disposed) return;
    const track = store.getState().library.tracks[trackId];
    if (!track) return;
    const version = ++requestVersion;
    engine.pause(); store.getState().pause(); store.getState().playTrack(trackId);
    sendData({ selected: trackId });
    if (resumeMs) store.setState((s) => ({ playback: { ...s.playback, positionMs: resumeMs } }));
    notify({ loading: true, error: null, lyrics: { lines: [], source: 'none' } });
    publishPlayback();
    try {
      const url = await transport.resolve(track.path);
      if (disposed || !audioOwner || version !== requestVersion) { transport.revoke(url); return; }
      engine.load(url, trackId);
      peak.v = 0; beat.ema = 0; beat.pulse = 0;
      if (resumeMs) engine.seek(resumeMs);
      notify({ loading: false }); publishPlayback();
      if (play) await engine.play();
      if (disposed || !audioOwner || version !== requestVersion) return;
      if (play) store.getState().play();
      publishPlayback(); saveFull();
      void (async () => {
        const bytes = await transport.readBytes(track.path);
        if (disposed || !audioOwner || version !== requestVersion) return;
        const file = getFallbackFile(track.path);
        const meta = parseMetadata(bytes, file?.name ?? track.title);
        const patch: Partial<Track> = { hasLyrics: !!meta.lyricsText };
        if (meta.title) patch.title = meta.title;
        if (meta.artist) patch.artist = meta.artist;
        if (meta.album) patch.album = meta.album;
        if (meta.durationMs) patch.durationMs = meta.durationMs;
        store.getState().setTrackMeta(trackId, patch); sendData({ meta: { id: trackId, patch } });
        const lyrics = await resolveLyrics({ ...track, hasLyrics: !!meta.lyricsText }, (path) => transport.readBytes(path), meta.lyricsText);
        if (disposed || !audioOwner || version !== requestVersion) return;
        notify({ lyrics }); publishPlayback(); publishSnapshot();
      })().catch(() => {});
    } catch (error) {
      if (version !== requestVersion || disposed || !audioOwner) return;
      store.getState().pause(); failure(error); publishPlayback();
    }
  }

  const advance = (delta: 1 | -1, ended = false) => {
    if (!ended) savePosition();
    const before = store.getState().playback;
    const positionMs = currentPosition();
    store.setState({ playback: { ...before, positionMs } });
    const next = store.getState().advance(delta);
    if (delta === -1 && before.trackId && positionMs > 3000) {
      if (engine.playingTrackId !== before.trackId) void loadTrack(before.trackId, before.playing);
      else { engine.seek(0); publishPlayback(); }
      return;
    }
    if (next) void loadTrack(next, true);
    else if (delta === -1 && before.trackId && before.playing && engine.playingTrackId !== before.trackId) void loadTrack(before.trackId, true);
    else { engine.seek(0); if (!store.getState().playback.playing) engine.pause(); publishPlayback(); saveFull(); }
  };
  const execute = (command: PlayerCommand) => {
    if (!audioOwner || disposed) return;
    const playback = store.getState().playback;
    switch (command.op) {
      case 'setTrack': engine.prepare(); savePosition(); void loadTrack(String(command.arg)); break;
      case 'next': engine.prepare(); advance(1); break;
      case 'prev': engine.prepare(); advance(-1); break;
      case 'toggle': execute({ op: playback.playing || state.loading ? 'pause' : 'play' }); break;
      case 'play': {
        engine.prepare();
        const current = playback.trackId;
        if (!current || engine.playingTrackId !== current) {
          const library = store.getState().library;
          const first = current ?? library.playlists[library.currentPlaylist]?.trackIds[0];
          if (first) void loadTrack(first, true, playback.positionMs);
        } else {
          const version = requestVersion;
          void engine.play().then(() => { if (!disposed && audioOwner && version === requestVersion) { store.getState().play(); publishPlayback(); } }).catch(failure);
        }
        break;
      }
      case 'pause': {
        requestVersion += 1; savePosition(); engine.pause(); store.getState().pause();
        store.setState((s) => ({ playback: { ...s.playback, positionMs: currentPosition() } }));
        notify({ loading: false }); publishPlayback(); saveFull(); break;
      }
      case 'seek': {
        const value = Number(command.arg); if (!Number.isFinite(value)) break;
        const positionMs = Math.max(0, Math.min(playback.durationMs || value, value));
        engine.seek(positionMs); store.setState({ playback: { ...playback, positionMs } }); publishPlayback(); break;
      }
      case 'volume': {
        const value = Number(command.arg); if (!Number.isFinite(value)) break;
        store.getState().setVolume(value); applyMediaSettings(); publishPlayback(); saveFull(); break;
      }
      case 'mute': {
        const muted = Boolean(command.arg);
        store.getState().setVolume(unmuteVolume(playback.volume, playback.muted, muted));
        store.getState().setMuted(muted); applyMediaSettings(); publishPlayback(); saveFull(); break;
      }
    }
  };
  engine.attachStoreHooks({
    onEnded: () => { const trackId = store.getState().playback.trackId; if (trackId) { store.getState().clearResume(trackId); sendData({ clearResume: trackId }); } advance(1, true); },
    onError: () => {
      const trackId = store.getState().playback.trackId;
      if (engine.playingTrackId !== trackId) return;
      if (trackId) { store.getState().setTrackMeta(trackId, { status: 'bad' }); sendData({ meta: { id: trackId, patch: { status: 'bad' } } }); }
      store.getState().pause(); failure('无法解码此音频，请检查文件格式或重新选择文件。'); publishPlayback();
    },
    onTime: (ms) => {
      if (!audioOwner) return;
      store.setState((s) => ({ playback: { ...s.playback, positionMs: ms } }));
      savePosition(); publishPlayback();
      if (coordinator && Date.now() - lastSaveAt >= 5000) { lastSaveAt = Date.now(); saveFull(); }
    },
  });
  const metadataReady = () => {
    if (!audioOwner || disposed) return;
    if (Number.isFinite(media.duration)) store.setState((s) => ({ playback: { ...s.playback, durationMs: Math.round(media.duration * 1000) } }));
    const positionMs = store.getState().playback.positionMs;
    if (positionMs > 0 && media.currentTime < 0.1) engine.seek(positionMs);
    publishPlayback();
  };
  media.addEventListener('loadedmetadata', metadataReady);

  const applyAction = (action: DataAction) => {
    if (action.type === 'crawl-cancel') { crawler?.cancel(); crawler = null; }
    else if (action.type === 'window-position') positions[action.id] = { x: action.x, y: action.y };
    else applyDataAction(store, action);
    applyMediaSettings(); publishSnapshot(); saveFull();
  };
  const crawlPaths = (paths: string[], names: Record<string, string> = {}) => {
    const unique = [...new Set(paths.filter(isAudioPath))];
    const fresh = unique.filter((path) => !store.getState().library.tracks[path]);
    store.getState().importTracks(fresh.map((path) => {
      const title = names[path] || getFallbackFile(path)?.name?.replace(/\.[^.]+$/, '');
      return { id: path, path, ...(title ? { title } : {}) };
    }));
    publishSnapshot();
    if (!crawler) crawler = createCrawler({ transport, concurrency: 2, isCancelled: () => disposed || !coordinator, priority: () => null,
      onTrack: (path, patch) => { store.getState().setTrackMeta(path, Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))); scheduleSnapshot(); },
      onThumb: (path, coverThumb) => { store.getState().setTrackMeta(path, { coverThumb }); scheduleSnapshot(); },
    });
    crawler.push(fresh); persistence.scheduleSave('library');
  };
  function receiveData(patch: DataRequest): void {
    if (!coordinator) return;
    if (patch.action) applyAction(patch.action);
    else if (patch.selected && store.getState().library.tracks[patch.selected]) {
      const playback = store.getState().playback;
      store.getState().playTrack(patch.selected);
      if (audioOwner) store.setState({ playback });
      publishSnapshot(); persistence.scheduleSave('library');
    } else if (patch.meta) {
      store.getState().setTrackMeta(patch.meta.id, patch.meta.patch); scheduleSnapshot();
    } else if (patch.clearResume) { store.getState().clearResume(patch.clearResume); saveFull(); }
    else if (Array.isArray(patch.paths)) crawlPaths(patch.paths, patch.names);
  }

  const activate = () => {
    if (coordinator || disposed || options.route === 'lyrics') return;
    coordinator = true; coordinatorId = id;
    applyMediaSettings(); bus.post({ t: 'claim', from: id, epoch }); publishSnapshot(); flushData();
    while (pending.length) pending.shift()?.();
  };
  const reloadAuthority = async () => {
    reloadingAuthority = true;
    try {
      // 只有持锁后的读取才代表前任最终写已完成；启动时的镜像不能用来激活新写者。
      const persisted = await (options.load ?? loadPersisted)();
      if (disposed) return;
      const playback = store.getState().playback;
      if (persisted) hydrateSession(store, persisted);
      if (audioOwner || state.owner) store.setState({ playback }); // 保留当前真实音频会话，不从持久化自动播放。
      const savedWindows = (persisted as { windows?: Record<string, { x: number; y: number }> } | null)?.windows;
      if (savedWindows) Object.assign(positions, savedWindows);
      reloadingAuthority = false; activate();
    } finally { reloadingAuthority = false; }
  };
  const requestAuthority = () => {
    if (disposed || coordinator || authorityPending || options.route === 'lyrics' || options.leadership === 'follower') return;
    // local/follower 是显式 fixture 权限；生产 auto 不能靠总线延迟推断独占。
    if (options.leadership === 'local') { activate(); return; }
    if (locks?.request) {
      authorityPending = true;
      void locks.request('otools-yoyomusic-coordinator', { signal: lockAbort.signal }, async () => {
        if (disposed) return;
        const held = new Promise<void>((resolve) => { releaseLock = resolve; });
        try {
          const reload = reloadAuthority();
          await Promise.race([reload, held]);
          if (!disposed) await held;
        } finally { releaseLock = null; }
      }).catch((error) => { if (!disposed && error?.name !== 'AbortError') failure(error); }).finally(() => { authorityPending = false; });
    } else {
      // 没有 Web Locks 时仅允许固定 panel 协调者；不以150ms竞选伪造严格互斥。
      notify({ error: fallbackNotice });
      if (options.route === 'panel') {
        authorityPending = true;
        void reloadAuthority().catch(failure).finally(() => { authorityPending = false; });
      }
    }
  };
  const takeRemoteAudio = (from: string, value: number) => {
    if (value < audioEpoch || value === audioEpoch && state.owner && from < state.owner) return false;
    if (pendingAudio && (value > pendingAudio.epoch || value === pendingAudio.epoch && from > id)) cancelAudioRequest();
    if (grantedAudio && value >= grantedAudio.epoch) grantedAudio = null;
    if (audioOwner && from !== id) { savePosition(); audioOwner = false; requestVersion += 1; engine.suspend(); }
    audioEpoch = value; remoteFrame = null;
    notify({ owner: from, loading: pendingAudio !== null });
    return true;
  };
  const onMessage = (message: BusMsg) => {
    if (disposed || message.from === id) return;
    if (!initialized) { earlyMessages.push(message); return; }
    switch (message.t) {
      case 'claim': {
        if (!coordinator && !reloadingAuthority) coordinatorId = message.from;
        if (coordinator) publishSnapshot(); flushData();
        break;
      }
      case 'hello':
        if (coordinator) { bus.post({ t: 'claim', from: id, epoch }); publishSnapshot(); }
        if (audioOwner) publishPlayback();
        break;
      case 'audio-handover-request': {
        if (message.to !== id || !Number.isFinite(message.epoch) || message.epoch <= message.ownerEpoch) break;
        const cancelled = cancelledAudio.get(message.from);
        if (cancelled && (message.ownerEpoch < cancelled.ownerEpoch || message.ownerEpoch === cancelled.ownerEpoch && message.requestId <= cancelled.requestId)) break;
        if (audioOwner) {
          if (message.ownerEpoch !== audioEpoch) break;
          savePosition(); audioOwner = false; requestVersion += 1; cancelAudioRequest();
          // suspend 同步 pause 真实媒体，之后才 ack；总线慢也不能出现双播窗口。
          engine.suspend(); store.getState().pause();
          grantedAudio = { from: message.from, ownerEpoch: message.ownerEpoch, epoch: message.epoch, requestId: message.requestId };
          notify({ loading: false });
          if (coordinator) saveFull();
        } else {
          // 多次点击只允许同一接管者升级同一已停止会话；不能给第二页并行授权。
          if (!grantedAudio || grantedAudio.from !== message.from || grantedAudio.ownerEpoch !== message.ownerEpoch || message.epoch < grantedAudio.epoch || message.requestId < grantedAudio.requestId) break;
          grantedAudio = { from: message.from, ownerEpoch: message.ownerEpoch, epoch: message.epoch, requestId: message.requestId };
        }
        bus.post({ t: 'audio-handover-ack', from: id, to: message.from, epoch: message.epoch, ownerEpoch: message.ownerEpoch, requestId: message.requestId });
        break;
      }
      case 'audio-handover-ack': {
        const request = pendingAudio;
        if (request && message.to === id && message.from === request.owner && message.epoch === request.epoch && message.ownerEpoch === request.ownerEpoch && message.requestId === request.requestId) completeAudioRequest(request);
        break;
      }
      case 'audio-handover-cancel': {
        if (message.to !== id) break;
        const previous = cancelledAudio.get(message.from);
        if (!previous || message.ownerEpoch > previous.ownerEpoch || message.ownerEpoch === previous.ownerEpoch && message.requestId > previous.requestId) cancelledAudio.set(message.from, { ownerEpoch: message.ownerEpoch, requestId: message.requestId });
        if (grantedAudio?.from === message.from && grantedAudio.epoch <= message.epoch && grantedAudio.ownerEpoch === message.ownerEpoch && grantedAudio.requestId <= message.requestId) {
          grantedAudio = null; audioEpoch = Math.max(audioEpoch, message.epoch);
          notify({ owner: null, loading: false });
          bus.post({ t: 'owner-gone', from: id, epoch: audioEpoch });
        }
        break;
      }
      case 'takeover': takeRemoteAudio(message.from, message.epoch); break;
      case 'cmd': if (audioOwner) execute(message); break;
      case 'state-mutate':
        if (coordinator) receiveData(message.patch as DataRequest);
        else if (reloadingAuthority) pendingData.push(message.patch as DataRequest);
        break;
      case 'state-snap': {
        if (coordinator || reloadingAuthority) break;
        coordinatorId = message.from;
        const playback = store.getState().playback;
        hydrateSession(store, message.snap, true);
        const packet = message.snap.runtime as { loading?: boolean; lyrics?: RuntimeState['lyrics']; owner?: string | null; audioEpoch?: number } | undefined;
        if (audioOwner) {
          const config = store.getState().playback;
          store.setState({ playback: { ...playback, volume: config.volume, muted: config.muted, playMode: config.playMode, eqEnabled: config.eqEnabled, eqBands: config.eqBands } });
          applyMediaSettings(); publishPlayback();
        } else if (!state.owner || (packet?.audioEpoch ?? 0) >= audioEpoch) {
          const sourcePlayback = message.snap.playback as StoreState['playback'] | undefined;
          if (sourcePlayback) store.setState({ playback: { ...store.getState().playback, ...sourcePlayback } });
          audioEpoch = packet?.audioEpoch ?? audioEpoch;
          notify({ owner: packet?.owner ?? null, loading: packet?.loading ?? false, lyrics: packet?.lyrics ?? state.lyrics });
        }
        if (message.snap.windows && typeof message.snap.windows === 'object') Object.assign(positions, message.snap.windows);
        notify({ ready: true, updatedAt: Date.now() }); flushData();
        break;
      }
      case 'playback': {
        const packet = message.state as WirePlayback;
        if (!packet?.playback || !takeRemoteAudio(message.from, packet.epoch ?? 0)) break;
        if (audioOwner) break;
        store.setState({ playback: { ...store.getState().playback, ...packet.playback } });
        if (packet.frame?.bands?.length === 56 && packet.frame.wave?.length === 256) {
          remoteFrame = { bands: Float32Array.from(packet.frame.bands), wave: Float32Array.from(packet.frame.wave), level: packet.frame.level, beat: packet.frame.beat };
          remoteFrameAt = Date.now();
        }
        notify({ loading: packet.loading, lyrics: packet.lyrics ?? state.lyrics, error: packet.error ?? null, updatedAt: packet.sentAt });
        if (coordinator) {
          if (packet.playback.trackId) store.getState().recordResume(packet.playback.trackId, packet.playback.positionMs);
          if (!packet.playback.playing || Date.now() - lastSaveAt > 5000) { lastSaveAt = Date.now(); saveFull(); }
        }
        break;
      }
      case 'signal-request': if (audioOwner) { const frame = readFrame(1 / 30); if (frame) publishPlayback(frame); } break;
      case 'owner-gone': {
        const request = pendingAudio;
        if (request && request.owner === message.from && (message.epoch === undefined || message.epoch >= request.ownerEpoch && message.epoch <= request.epoch)) {
          completeAudioRequest(request);
        } else if (state.owner === message.from && (message.epoch === undefined || message.epoch >= audioEpoch)) {
          store.getState().pause(); notify({ owner: null, loading: false }); if (coordinator) saveFull();
        }
        break;
      }
      case 'coordinator-gone':
        if (coordinatorId === message.from) {
          coordinatorId = null;
          if (!locks?.request && options.leadership !== 'local') notify({ error: fallbackNotice });
        }
        break;
    }
  };
  const stopBus = bus.on(onMessage);
  const shutdown = (): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    const wasCoordinator = coordinator;
    const wasAudioOwner = audioOwner;
    savePosition();
    if (wasAudioOwner) {
      engine.suspend(); store.getState().pause();
      notify({ owner: null, loading: false }); publishPlayback();
      bus.post({ t: 'owner-gone', from: id, epoch: audioEpoch });
    } else if (grantedAudio) {
      // ack 在途也仍持有停止证明；关闭后用 gone 让匹配请求继续，不必等失联 ack。
      bus.post({ t: 'owner-gone', from: id, epoch: grantedAudio.ownerEpoch });
    }
    if (wasCoordinator) {
      closingSnapshot = JSON.parse(JSON.stringify({ ...sessionSnapshot(store), windows: positions })) as Record<string, unknown>;
      publishSnapshot();
    }
    // 先封闭所有入口和迟到回调；数据写权只在最终快照及逻辑重试全部 drain 后交接。
    disposed = true; requestVersion += 1; audioOwner = false; cancelAudioRequest();
    if (snapshotTimer) clearTimeout(snapshotTimer);
    pending.length = 0; pendingData.length = 0; earlyMessages.length = 0;
    crawler?.cancel(); crawler = null; stopBus();
    window.removeEventListener('beforeunload', beforeUnload);
    media.removeEventListener('loadedmetadata', metadataReady); engine.dispose(); transport.dispose?.();
    lockAbort.abort(); listeners.clear();
    shutdownPromise = (async () => {
      let writeError: unknown; let failed = false;
      finalizing = wasCoordinator;
      // 先等旧写入及其配额重试，再排最终快照，防止旧重试落在最终快照之后。
      await persistence.drain?.();
      try { await persistence.flushNow(); }
      catch (error) { writeError = error; failed = true; }
      // 包括 persistence 的配额裁剪重试，不能只 await 当时的 rawSave 尾 Promise。
      await persistence.drain?.(); await saveQueue.catch(() => {});
      finalizing = false;
      if (wasCoordinator) bus.post({ t: 'coordinator-gone', from: id });
      coordinator = false;
      releaseLock?.(); releaseLock = null; bus.close?.();
      if (failed) throw writeError;
    })();
    return shutdownPromise;
  };
  // 浏览器硬关不会等待异步宿主 IPC；只能 best-effort，不承诺硬关时的落盘耐久性。
  // 正常关闭由 UI await shutdown；此处绝不提前广播 gone 或主动释放仍在写入的锁。
  const beforeUnload = () => { void shutdown().catch(() => {}); };
  window.addEventListener('beforeunload', beforeUnload);
  const dispatch = (operation: () => void) => { if (disposed) return; if (!state.ready) pending.push(operation); else operation(); };

  const runtime: AppRuntime = {
    command(command) {
      if (disposed || options.route === 'lyrics' && command.op === 'setTrack') return;
      if (pendingAudio && (command.op === 'pause' || command.op === 'toggle')) {
        cancelAudioRequest(); notify({ loading: false });
        dispatch(() => { if (state.owner) bus.post({ t: 'cmd', op: 'pause', from: id }); });
        return;
      }
      // 准备音频图必须在调用的用户手势内，不能等跨窗IPC或文件读取后才解锁。
      const localPlayback = options.route !== 'lyrics' && (command.op === 'setTrack' || command.op === 'play' || command.op === 'next' || command.op === 'prev' || command.op === 'toggle' && !store.getState().playback.playing);
      if (localPlayback) engine.prepare();
      dispatch(() => {
        if (localPlayback) { claimAudio(command); return; }
        if (!state.owner && (command.op === 'volume' || command.op === 'mute')) {
          if (command.op === 'volume' && Number.isFinite(Number(command.arg))) sendData({ action: { type: 'volume', value: Number(command.arg) } });
          if (command.op === 'mute') sendData({ action: { type: 'mute', value: Boolean(command.arg) } });
        } else if (audioOwner) execute(command);
        else if (state.owner) bus.post({ t: 'cmd', ...command, from: id });
      });
    },
    action(action) { dispatch(() => sendData({ action })); },
    patchUi(patch) { if (!disposed) store.setState((s) => ({ ui: { ...s.ui, ...patch } })); },
    async importFiles() {
      if (disposed) return;
      notify({ picking: true });
      try { const paths = await pickAudioFiles(); if (!disposed && paths) runtime.importPaths(paths); }
      catch (error) { failure(error); }
      finally { notify({ picking: false }); }
    },
    async importFolder() {
      if (disposed) return;
      notify({ picking: true });
      try {
        const directory = await pickDirectory();
        if (disposed || !directory) return;
        const entries = await listDirectoryRecursive(directory);
        if (!disposed) runtime.importPaths(entries.map((entry) => entry.path));
      }
      catch (error) { failure(error); }
      finally { notify({ picking: false }); }
    },
    importPaths(paths) {
      if (disposed) return;
      const names = Object.fromEntries(paths.map((path) => [path, getFallbackFile(path)?.name?.replace(/\.[^.]+$/, '') || '']));
      dispatch(() => sendData({ paths, names }));
    },
    async openWindow(windowId) {
      if (disposed) return;
      try {
        if (window.__TAURI_INTERNALS__?.invoke) await openPluginWindow(windowId);
        else {
          const url = new URL(window.location.href); url.search = windowId === 'yoyomusic-lyrics' ? '?lyrics=1' : '?main=1';
          const popup = window.open(url.href, windowId, windowId === 'yoyomusic-lyrics' ? 'width=880,height=160' : 'width=1100,height=720');
          if (!popup) failure('请允许弹出窗口。浏览器窗口不能跨应用置顶。');
        }
      } catch (error) { failure(error); }
    },
    getState: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getFrame() {
      const now = performance.now(); const dt = Math.min(0.05, Math.max(0, (now - frameAt) / 1000)); frameAt = now;
      const playback = store.getState().playback;
      if (synthTrack !== playback.trackId) { synthTrack = playback.trackId; synth.reseed(synthTrack ?? 'yoyomusic'); }
      const real = readFrame(dt);
      if (!disposed && !audioOwner && state.owner && now - signalRequestAt > 60) { signalRequestAt = now; bus.post({ t: 'signal-request', from: id }); }
      return synth.update(dt, playback.playing, playback.playing ? real : null);
    },
    position: currentPosition,
    windowPosition: (windowId) => positions[windowId],
    clearError() { notify({ error: null }); },
    async start() {
      if (started || disposed) return;
      started = true;
      try {
        const persisted = await (options.load ?? loadPersisted)();
        if (disposed) return; // 旧 runtime 的迟到读取不能改写重建后共享的 store。
        if (persisted) hydrateSession(store, persisted);
        const savedWindows = (persisted as { windows?: Record<string, { x: number; y: number }> } | null)?.windows;
        if (savedWindows) Object.assign(positions, savedWindows);
      } catch (error) { failure(error); }
      if (disposed) return;
      initialized = true; notify({ ready: true });
      for (const message of earlyMessages.splice(0)) onMessage(message);
      requestAuthority(); bus.post({ t: 'hello', from: id });
      while (pending.length) pending.shift()?.();
    },
    shutdown,
    dispose() { void shutdown().catch(() => {}); },
  };
  return runtime;
}
