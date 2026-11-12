/**
 * 全局 zustand store（spec §10.1 / 计划 Task 4）。
 *
 * 四 slices：library / playback / settings / ui，actions 平铺顶层。
 * 依赖方向：VizMode 在此**本地占位**（Task 9 才有 viz/registry，不得反向依赖）；
 * Track/Playlist/PlayMode 等类型与队列/索引纯函数来自同目录 logic.ts。
 *
 * Go 语义对照（D:\Repos\xyito\lingyun\YoYoMusic）：
 *  - advance：state.go AdvanceIndex + app.go Prev :401-407 的 ">3s 回 0 而非切曲"
 *    按计划放 store 层；sequence 到尾 → 停止（位置清零、trackId 保留，Go Stop）。
 *    playing 结果显式化（Task 7 授权增补）：到尾/空列表 Stop → playing=false；
 *    >3s prev seek0 续播 → playing 保持；到首 Seek0 续播（Go Prev not-ok）→
 *    playing 保持；中途切曲 → playing 不动（真实播放由 Task 15 接线执行）。
 *  - pushHistory：state.go AddHistory :933-948（头部去重连续重复、cap 200）。
 *  - recordResume：state.go SetResume :900-913（≤5s 或距尾 <2s 不记）。
 *  - 歌单：CreatePlaylist :395-414（缺省名"我的歌单"）/ DeletePlaylist :418-432
 *    （default 保护、删当前回落 default）/ SetPlayMode :734-741（双处镜像）。
 *  - queueOps：QueueNext/MoveTrackUp/MoveTrackDown（游标跟随=移动后重指向播放曲）。
 *
 * resume（Task 3 审查遗留点）：形状 Record<trackId, ms>，对齐 persist 快照的
 * `resume` 顶层键 —— 显式 null=清空（clearResume()）、undefined=无（persist
 * flushPosition 快照缺键时跳过，不冲掉既有恢复点）。
 *
 * setTrackMeta（Task 6 授权点）：未知 id 兜底建行时同时补进 default 歌单，
 * 维持"default=全库"不变量（否则爬虫竞态建的行会从曲库视图里消失）。
 */

import { create } from 'zustand';

import {
  nextIndex,
  prevIndex,
  queueAppend,
  queueInsertAfter,
  queueMove,
  titleFromPath,
  type Playlist,
  type PlayMode,
  type Track,
  type TrackStatus,
} from './logic';

// —— 类型再导出（后续任务统一从 store 取）——
export type { Playlist, PlayMode, Track, TrackStatus };

/**
 * TODO(Task 9): 替换为 viz/registry 的 `VizMode` 联合类型。
 * 现为占位 string，避免 state 层反向依赖可视化模块。
 */
export type VizMode = string;

export type Lang = 'zh-CN' | 'en-US';
export type SidePanel = 'eq' | 'lyrics' | 'skins' | 'about' | null;
export type LibraryTab = 0 | 1 | 2 | 3 | 4; // 列表/专辑/歌手/历史/喜欢（spec §8.3）

export interface HistoryEntry {
  trackId: string;
  playedAt: number;
}

/** importTracks 条目：id+path 必填，其余走缺省（Task 6 建行约定：title=文件名）。 */
export type TrackInput = { id: string; path: string } & Partial<
  Omit<Track, 'id' | 'path' | 'liked' | 'status' | 'hasLyrics'>
> &
  Partial<Pick<Track, 'status' | 'hasLyrics'>>;

export interface LibrarySlice {
  tracks: Record<string, Track>;
  playlists: Record<string, Playlist>;
  currentPlaylist: string;
  history: HistoryEntry[];
}

export interface PlaybackSlice {
  trackId?: string;
  /**
   * 播放状态位（Task 7 授权增补）：纯状态镜像，真实播放由引擎侧执行。
   * advance 结果显式化的判据——sequence 到尾（Stop）置 false，>3s prev
   * seek0 续播保持 true（解决 Task 4 审查遗留的"advance 返回 undefined
   * 分不清停止还是重播"歧义）。
   */
  playing: boolean;
  positionMs: number;
  durationMs: number;
  volume: number;
  muted: boolean;
  playMode: PlayMode;
  eqEnabled: boolean;
  eqBands: number[]; // 10 段，±12dB
}

export interface SettingsSlice {
  skin: 'aurora' | 'midnight' | 'sunset' | 'mint';
  vizMode: VizMode;
  vizRandom: boolean;
  restoreSession: boolean;
  desktopLyrics: { colorIdx: number; fontScale: number; locked: boolean };
  lang: Lang;
}

export interface UiSlice {
  libraryOpen: boolean;
  libraryPinned: boolean;
  libraryTab: LibraryTab;
  query: string;
  browse: { kind: 'album' | 'artist'; name?: string };
  sidePanel: SidePanel;
  panelsPinned: boolean;
  renamingId?: string;
}

export interface StoreState {
  library: LibrarySlice;
  playback: PlaybackSlice;
  settings: SettingsSlice;
  ui: UiSlice;
  /** 播放恢复点：Record<trackId, ms>；null=显式清空；undefined=无（见文件头注）。 */
  resume?: Record<string, number> | null;

  // —— 曲库 ——
  importTracks(items: TrackInput[]): void;
  setTrackMeta(id: string, meta: Partial<Omit<Track, 'id' | 'path'>>): void;
  like(id: string): boolean;
  // —— 歌单 ——
  addPlaylist(name?: string): string;
  renamePlaylist(id: string, name: string): void;
  deletePlaylist(id: string): void;
  switchPlaylist(id: string): void;
  addToPlaylist(playlistId: string, trackId: string): void;
  removeFromPlaylist(playlistId: string, trackId: string): void;
  // —— 队列（调用 logic 纯函数，游标跟随播放曲）——
  queueOps: {
    playNext(id: string): void;
    append(id: string): void;
    move(id: string, delta: 1 | -1): void;
  };
  // —— 播放 ——
  playTrack(id: string): void;
  advance(delta: 1 | -1): string | undefined;
  /** 播放状态位（Task 7）：只翻状态，真实播放由引擎侧/接线层执行。 */
  play(): void;
  pause(): void;
  togglePlay(): void;
  setPlayMode(mode: PlayMode): void;
  setEQ(enabled: boolean, bands?: number[]): void;
  setVolume(v: number): void;
  setMuted(b: boolean): void;
  // —— 历史 / 恢复点 ——
  pushHistory(trackId: string): void;
  recordResume(trackId: string, ms: number): void;
  clearResume(trackId?: string): void;
}

/** 历史上限（计划 Global Constraints）。 */
const HISTORY_CAP = 200;
/** EQ 段数与增益钳制（Task 7：10×peaking ±12dB）。 */
const EQ_BAND_COUNT = 10;
const EQ_GAIN_LIMIT = 12;
/** playlist id 自增序号（防同毫秒 id 撞车；Go 用 UnixNano）。 */
let playlistSeq = 0;

/** TrackInput → 完整 Track（缺省兜底，title 回退文件名去扩展名）。 */
function normalizeTrack(item: TrackInput): Track {
  return {
    title: titleFromPath(item.path),
    artist: '',
    album: '',
    durationMs: 0,
    status: 'ok',
    hasLyrics: false,
    ...item,
    id: item.id,
    path: item.path,
    liked: false,
  };
}

/** EQ 段值归一：长度裁到 10、逐项钳 ±12。 */
function clampBands(bands: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < EQ_BAND_COUNT; i++) {
    const v = Number.isFinite(bands[i]) ? bands[i] : 0;
    out.push(Math.min(EQ_GAIN_LIMIT, Math.max(-EQ_GAIN_LIMIT, v)));
  }
  return out;
}

export const useStore = create<StoreState>()((set, get) => {
  /** 当前歌单（快照）；不存在时回落 default。 */
  const currentPlaylist = (): Playlist | undefined => {
    const lib = get().library;
    return lib.playlists[lib.currentPlaylist] ?? lib.playlists.default;
  };

  /**
   * 队列变更后统一重指向游标：播放中曲目仍在队列 → 跟随其新下标
   * （等价于 Go MoveTrackUp/Down 的 CurrentIndex==i / i±1 两个分支）；
   * 不在队列 → 保持并钳制到合法区间。
   */
  const repointCursor = (pl: Playlist, trackIds: string[]): number => {
    const playing = get().playback.trackId;
    if (playing) {
      const ni = trackIds.indexOf(playing);
      if (ni >= 0) return ni;
    }
    return Math.min(Math.max(pl.currentIndex, 0), Math.max(trackIds.length - 1, 0));
  };

  const patchPlaylist = (pl: Playlist, patch: Partial<Playlist>): void => {
    set((s) => ({
      library: {
        ...s.library,
        playlists: { ...s.library.playlists, [pl.id]: { ...pl, ...patch } },
      },
    }));
  };

  /** 推进后统一落地：换曲 + 游标 + 位置清零 + 记历史。 */
  const commitAdvance = (pl: Playlist, idx: number): string => {
    const id = pl.trackIds[idx];
    const s = get();
    set({
      library: {
        ...s.library,
        playlists: { ...s.library.playlists, [pl.id]: { ...pl, currentIndex: idx } },
      },
      playback: {
        ...s.playback,
        trackId: id,
        positionMs: 0,
        durationMs: s.library.tracks[id]?.durationMs ?? 0,
      },
    });
    get().pushHistory(id); // Go PlayTrack → AddHistory
    return id;
  };

  return {
    library: {
      tracks: {},
      // default 歌单 = 全库视图，name 照 Go state.go:242（计划 Task 4 Step 4）
      playlists: {
        default: { id: 'default', name: '当前播放列表', trackIds: [], currentIndex: 0, playMode: 'sequence' },
      },
      currentPlaylist: 'default',
      history: [],
    },

    playback: {
      trackId: undefined,
      playing: false, // Task 7 授权增补：状态位，真实播放由引擎侧执行
      positionMs: 0,
      durationMs: 0,
      volume: 0.8, // Go state.go:244
      muted: false,
      playMode: 'sequence',
      eqEnabled: false,
      eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },

    settings: {
      skin: 'aurora',
      vizMode: 'spectrum', // Go VizSpectrum 缺省
      vizRandom: false,
      restoreSession: true,
      desktopLyrics: { colorIdx: 0, fontScale: 1, locked: false },
      lang: 'zh-CN',
    },

    ui: {
      libraryOpen: true, // Go state.go:247
      libraryPinned: false,
      libraryTab: 0,
      query: '',
      browse: { kind: 'album' },
      sidePanel: null,
      panelsPinned: false,
      renamingId: undefined,
    },

    resume: undefined,

    // —— 曲库 ——

    importTracks(items) {
      set((s) => {
        const tracks = { ...s.library.tracks };
        const newIds: string[] = [];
        for (const item of items) {
          if (tracks[item.id]) continue; // 已在库：跳过（Go addTracks）
          tracks[item.id] = normalizeTrack(item);
          newIds.push(item.id);
        }
        if (newIds.length === 0) return {};
        // default 歌单 = 全库视图：新曲目一律追加进 default（Go 追加当前歌单，
        // 计划以"default=全库"为准，语义偏差已报告）。
        const def = s.library.playlists.default;
        return {
          library: {
            ...s.library,
            tracks,
            playlists: {
              ...s.library.playlists,
              default: { ...def, trackIds: [...def.trackIds, ...newIds] },
            },
          },
        };
      });
    },

    setTrackMeta(id, meta) {
      set((s) => {
        const existing = s.library.tracks[id];
        if (!existing) {
          // 未建行先到元数据（爬虫竞态兜底）：按缺省建行，并补进 default
          // （维持"default=全库"不变量，Task 4 审查遗留点 / Task 6 授权点）。
          const def = s.library.playlists.default;
          const trackIds = def && !def.trackIds.includes(id) ? [...def.trackIds, id] : def?.trackIds;
          return {
            library: {
              ...s.library,
              tracks: { ...s.library.tracks, [id]: normalizeTrack({ id, path: id, ...meta }) },
              ...(trackIds && def ? { playlists: { ...s.library.playlists, default: { ...def, trackIds } } } : {}),
            },
          };
        }
        return {
          library: { ...s.library, tracks: { ...s.library.tracks, [id]: { ...existing, ...meta, id: existing.id, path: existing.path } } },
        };
      });
    },

    like(id) {
      const t = get().library.tracks[id];
      if (!t) return false;
      const liked = !t.liked;
      set((s) => ({
        library: { ...s.library, tracks: { ...s.library.tracks, [id]: { ...t, liked } } },
      }));
      return liked;
    },

    // —— 歌单 ——

    addPlaylist(name) {
      const id = `pl-${Date.now()}-${playlistSeq++}`;
      const pl: Playlist = {
        id,
        name: name || '我的歌单', // Go state.go:409 缺省名
        trackIds: [],
        currentIndex: 0,
        playMode: 'sequence',
      };
      set((s) => ({
        library: { ...s.library, playlists: { ...s.library.playlists, [id]: pl }, currentPlaylist: id },
        playback: { ...s.playback, playMode: pl.playMode }, // 镜像跟随（Go 只写 playlist，此处补镜像）
      }));
      return id;
    },

    renamePlaylist(id, name) {
      if (!name) return; // Go RenamePlaylist 空名无效
      const pl = get().library.playlists[id];
      if (pl) patchPlaylist(pl, { name });
    },

    deletePlaylist(id) {
      if (id === 'default') return; // default 保护（Go DeletePlaylist）
      set((s) => {
        if (!s.library.playlists[id]) return {};
        const playlists = { ...s.library.playlists };
        delete playlists[id];
        let current = s.library.currentPlaylist;
        let playMode = s.playback.playMode;
        if (current === id) {
          // 删除当前歌单回落 default（计划逐字断言；Go 同）
          current = 'default';
          playMode = playlists.default?.playMode ?? 'sequence';
        }
        return {
          library: { ...s.library, playlists, currentPlaylist: current },
          playback: { ...s.playback, playMode },
        };
      });
    },

    switchPlaylist(id) {
      const pl = get().library.playlists[id];
      if (!pl) return; // Go SwitchPlaylist 只切存在的
      set((s) => ({
        library: { ...s.library, currentPlaylist: id },
        playback: { ...s.playback, playMode: pl.playMode }, // 镜像跟随
      }));
    },

    addToPlaylist(playlistId, trackId) {
      const pl = get().library.playlists[playlistId];
      if (!pl || pl.trackIds.includes(trackId)) return; // Go AddToPlaylist 跳过重复
      patchPlaylist(pl, { trackIds: [...pl.trackIds, trackId] });
    },

    removeFromPlaylist(playlistId, trackId) {
      const pl = get().library.playlists[playlistId];
      if (!pl) return;
      const trackIds = pl.trackIds.filter((x) => x !== trackId);
      // Go RemoveFromPlaylist：游标越界归 0
      const currentIndex = pl.currentIndex >= trackIds.length ? 0 : pl.currentIndex;
      patchPlaylist(pl, { trackIds, currentIndex });
    },

    // —— 队列 ——

    queueOps: {
      playNext(id) {
        const pl = currentPlaylist();
        if (!pl || !id) return;
        const playing = get().playback.trackId;
        if (id === playing) return; // Go QueueNext：正在播放自身 → 不动作
        const trackIds = queueInsertAfter(pl.trackIds, playing ?? null, id);
        patchPlaylist(pl, { trackIds, currentIndex: repointCursor(pl, trackIds) });
      },

      append(id) {
        const pl = currentPlaylist();
        if (!pl || !id) return;
        const trackIds = queueAppend(pl.trackIds, id);
        patchPlaylist(pl, { trackIds, currentIndex: repointCursor(pl, trackIds) });
      },

      move(id, delta) {
        const pl = currentPlaylist();
        if (!pl) return;
        const trackIds = queueMove(pl.trackIds, id, delta);
        patchPlaylist(pl, { trackIds, currentIndex: repointCursor(pl, trackIds) });
      },
    },

    // —— 播放 ——

    playTrack(id) {
      const t = get().library.tracks[id];
      if (!t) return; // Go PlayTrack：未知曲目早退
      const pl = currentPlaylist();
      const idx = pl ? pl.trackIds.indexOf(id) : -1;
      set((s) => ({
        library:
          pl && idx >= 0
            ? {
                ...s.library,
                playlists: { ...s.library.playlists, [pl.id]: { ...pl, currentIndex: idx } }, // Go SelectTrack 重指向
              }
            : s.library,
        playback: { ...s.playback, trackId: id, positionMs: 0, durationMs: t.durationMs },
      }));
      get().pushHistory(id); // Go PlayTrack → AddHistory
    },

    advance(delta) {
      const pl = currentPlaylist();
      if (!pl) return undefined;
      const s = get();
      const { playback } = s;
      if (pl.trackIds.length === 0) {
        set({ playback: { ...playback, positionMs: 0, playing: false } }); // 空列表 → 停止（Go Stop）
        return undefined;
      }
      // ">3s 重播"（Go app.go Prev :401-407）：位置超 3s 时 prev 回 0 而非切曲。
      // playing 不动 = seek0 续播（与"到尾 Stop"的返回值歧义由 playing 显式化解决）。
      if (delta === -1 && playback.positionMs > 3000) {
        set({ playback: { ...playback, positionMs: 0 } });
        return playback.trackId;
      }
      const mode = pl.playMode; // Go AdvanceIndex 读当前歌单的 PlayMode
      if (mode === 'repeat_one') {
        // 原地重来：trackId 不变、位置归零（Go 返回当前曲目由调用方重播）。
        set({ playback: { ...playback, positionMs: 0 } });
        if (playback.trackId) get().pushHistory(playback.trackId); // 头部去重只刷时间戳
        return playback.trackId;
      }
      const idx = delta === 1 ? nextIndex(mode, pl.currentIndex, pl.trackIds.length) : prevIndex(mode, pl.currentIndex, pl.trackIds.length);
      if (idx === -1) {
        // sequence 到尾（delta=1）→ Stop：Go Next not-ok→Stop（IsPlaying=false）；
        // sequence 到首（delta=-1）→ Go Prev not-ok→Seek 0：playing 不动（续播）。
        set({ playback: { ...playback, positionMs: 0, ...(delta === 1 ? { playing: false } : {}) } });
        return undefined;
      }
      return commitAdvance(pl, idx); // 切曲：playing 不动，真实播放由接线层执行（Go PlayTrack 总是播）
    },

    // playing 纯状态位（Task 7 授权增补）：只翻状态，真实播放由引擎侧执行。
    play() {
      set((s) => ({ playback: { ...s.playback, playing: true } }));
    },

    pause() {
      set((s) => ({ playback: { ...s.playback, playing: false } }));
    },

    togglePlay() {
      set((s) => ({ playback: { ...s.playback, playing: !s.playback.playing } }));
    },

    setPlayMode(mode) {
      const pl = currentPlaylist();
      set((s) => ({
        playback: { ...s.playback, playMode: mode },
        library: pl ? { ...s.library, playlists: { ...s.library.playlists, [pl.id]: { ...pl, playMode: mode } } } : s.library,
      }));
    },

    setEQ(enabled, bands) {
      set((s) => ({
        playback: {
          ...s.playback,
          eqEnabled: enabled,
          ...(bands ? { eqBands: clampBands(bands) } : {}),
        },
      }));
    },

    setVolume(v) {
      const volume = Math.min(1, Math.max(0, v)); // Go SetVolume 钳制
      set((s) => ({ playback: { ...s.playback, volume } }));
    },

    setMuted(b) {
      set((s) => ({ playback: { ...s.playback, muted: b } }));
    },

    // —— 历史 / 恢复点 ——

    pushHistory(trackId) {
      if (!trackId) return;
      const now = Date.now();
      set((s) => {
        const hist = s.library.history;
        if (hist.length > 0 && hist[0].trackId === trackId) {
          // 连续重复只更新时间戳（Go AddHistory :933-948）
          return { library: { ...s.library, history: [{ trackId, playedAt: now }, ...hist.slice(1)] } };
        }
        return {
          library: { ...s.library, history: [{ trackId, playedAt: now }, ...hist].slice(0, HISTORY_CAP) },
        };
      });
    },

    recordResume(trackId, ms) {
      if (!trackId || ms <= 5000) return; // Go SetResume：≤5s 不记
      const s = get();
      const dur = s.library.tracks[trackId]?.durationMs ?? 0;
      if (dur > 0 && ms >= dur - 2000) return; // 距尾 <2s 不记（播放完≠断点）
      const base = s.resume;
      const map = { ...(base && typeof base === 'object' ? base : {}), [trackId]: ms };
      set({ resume: map });
    },

    clearResume(trackId) {
      if (trackId === undefined) {
        set({ resume: null }); // 显式清空（persist 会把快照 resume 键写成 null）
        return;
      }
      const base = get().resume;
      if (!base) return; // undefined=无：不得翻成 null（否则冲掉既有恢复点）
      if (!(trackId in base)) return;
      const map = { ...base };
      delete map[trackId];
      set({ resume: Object.keys(map).length > 0 ? map : null });
    },
  };
});
