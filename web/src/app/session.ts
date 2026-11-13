import type { StoreApi } from 'zustand';
import { createPlayerStore, type StoreState, type Track, type Playlist, type PlayMode } from '../state/store';
import { VIZ_MODES } from '../viz/registry';
import { getFallbackFile } from '../bridge/otools';

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const number = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const mode = (value: unknown): PlayMode => ['sequence', 'repeat_all', 'repeat_one', 'shuffle'].includes(String(value)) ? value as PlayMode : 'sequence';

export function sessionSnapshot(store: StoreApi<StoreState>): Record<string, unknown> {
  const state = store.getState();
  return { schema: 1, library: state.library, settings: state.settings,
    playback: { ...state.playback, playing: false }, resume: state.resume ?? null };
}

/** 只读取插件自身会话；损坏或旧格式数据不能抹掉默认歌单或启动自动播放。 */
export function hydrateSession(store: StoreApi<StoreState>, raw: unknown, liveMirror = false): void {
  const data = object(raw);
  const defaults = createPlayerStore().getState();
  const sourceLibrary = object(data.library);
  const tracks: Record<string, Track> = {};
  for (const [id, value] of Object.entries(object(sourceLibrary.tracks))) {
    const item = object(value);
    if (!id || id === '__proto__' || typeof item.path !== 'string') continue;
    tracks[id] = { id, path: item.path, title: text(item.title, item.path.split(/[\\/]/).pop() || id),
      artist: text(item.artist), album: text(item.album), durationMs: Math.max(0, number(item.durationMs)),
      liked: item.liked === true, hasLyrics: item.hasLyrics === true,
      status: !liveMirror && item.path.startsWith('blob:') && !getFallbackFile(item.path) ? 'missing' : item.status === 'bad' || item.status === 'missing' ? item.status : 'ok',
      ...(typeof item.coverThumb === 'string' && /^data:image\//.test(item.coverThumb) ? { coverThumb: item.coverThumb } : {}),
    };
  }
  const playlists: Record<string, Playlist> = { default: { ...defaults.library.playlists.default, trackIds: Object.keys(tracks) } };
  for (const [id, value] of Object.entries(object(sourceLibrary.playlists))) {
    if (!id || id === '__proto__') continue;
    const item = object(value);
    const ids = Array.isArray(item.trackIds) ? [...new Set(item.trackIds.filter((value): value is string => typeof value === 'string' && !!tracks[value]))] : [];
    if (id === 'default') for (const trackId of Object.keys(tracks)) if (!ids.includes(trackId)) ids.push(trackId);
    playlists[id] = { id, name: text(item.name, id === 'default' ? '当前播放列表' : '我的歌单'), trackIds: ids,
      currentIndex: Math.max(0, Math.min(ids.length - 1, Math.floor(number(item.currentIndex)))), playMode: mode(item.playMode) };
  }
  const sourceSettings = object(data.settings);
  const desktop = object(sourceSettings.desktopLyrics);
  const settings = { ...defaults.settings,
    skin: ['aurora', 'midnight', 'sunset', 'mint'].includes(String(sourceSettings.skin)) ? sourceSettings.skin as StoreState['settings']['skin'] : 'aurora' as const,
    vizMode: VIZ_MODES.includes(sourceSettings.vizMode as typeof VIZ_MODES[number]) ? sourceSettings.vizMode as typeof VIZ_MODES[number] : 'spectrum' as const,
    vizRandom: sourceSettings.vizRandom === true, restoreSession: sourceSettings.restoreSession !== false,
    lang: sourceSettings.lang === 'en-US' ? 'en-US' as const : 'zh-CN' as const,
    desktopLyrics: { colorIdx: Math.max(0, Math.min(4, Math.floor(number(desktop.colorIdx)))), fontScale: Math.max(0.6, Math.min(3, number(desktop.fontScale, 1))), locked: desktop.locked === true },
  };
  const resume: Record<string, number> = {};
  for (const [id, value] of Object.entries(object(data.resume))) if (tracks[id] && number(value) > 5000) resume[id] = number(value);
  const sourcePlayback = object(data.playback);
  const trackId = typeof sourcePlayback.trackId === 'string' && tracks[sourcePlayback.trackId] ? sourcePlayback.trackId : undefined;
  const currentPlaylist = typeof sourceLibrary.currentPlaylist === 'string' && playlists[sourceLibrary.currentPlaylist] ? sourceLibrary.currentPlaylist : 'default';
  const history = Array.isArray(sourceLibrary.history) ? sourceLibrary.history.map(object).filter((entry) => typeof entry.trackId === 'string' && tracks[entry.trackId])
    .slice(0, 200).map((entry) => ({ trackId: String(entry.trackId), playedAt: number(entry.playedAt) })) : [];
  store.setState({ library: { tracks, playlists, history, currentPlaylist }, settings, resume: Object.keys(resume).length ? resume : null,
    playback: { ...defaults.playback, trackId, playing: false,
      positionMs: settings.restoreSession && trackId ? resume[trackId] ?? 0 : 0, durationMs: trackId ? tracks[trackId].durationMs : 0,
      volume: Math.max(0, Math.min(1, number(sourcePlayback.volume, 0.8))), muted: sourcePlayback.muted === true,
      playMode: playlists[currentPlaylist].playMode, eqEnabled: sourcePlayback.eqEnabled === true,
      eqBands: defaults.playback.eqBands.map((_, index) => Math.max(-12, Math.min(12, number(Array.isArray(sourcePlayback.eqBands) ? sourcePlayback.eqBands[index] : 0)))),
    },
  });
}
