import type { StoreApi } from 'zustand';
import type { StoreState } from '../state/store';
import type { DataAction } from './actions';

/** 跨窗传递操作而非陈旧整库快照，由唯一写者顺序应用。 */
export function applyDataAction(store: StoreApi<StoreState>, action: DataAction): void {
  const state = store.getState();
  switch (action.type) {
    case 'like': state.like(action.id); break;
    case 'playlist-create': state.addPlaylist(action.name); break;
    case 'playlist-rename': state.renamePlaylist(action.id, action.name); break;
    case 'playlist-delete': state.deletePlaylist(action.id); break;
    case 'playlist-switch': state.switchPlaylist(action.id); break;
    case 'playlist-add': state.addToPlaylist(action.id, action.trackId); break;
    case 'playlist-remove': state.removeFromPlaylist(action.id, action.trackId); break;
    case 'queue-next': state.queueOps.playNext(action.id); break;
    case 'queue-append': state.queueOps.append(action.id); break;
    case 'queue-move': state.queueOps.move(action.id, action.delta); break;
    case 'play-mode': state.setPlayMode(action.mode); break;
    case 'eq': state.setEQ(action.enabled, action.bands); break;
    case 'volume': state.setVolume(action.value); break;
    case 'mute':
      if (state.playback.muted && !action.value && state.playback.volume <= 0) state.setVolume(0.5);
      store.getState().setMuted(action.value);
      break;
    case 'settings': store.setState({ settings: { ...state.settings, ...action.patch } }); break;
    case 'window-position': break; // native 位置由窗口协调层单写者持久化。
    case 'crawl-cancel': break; // 扫描队列生命周期由协调层拥有。
  }
}
