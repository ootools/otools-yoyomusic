import { describe, expect, it } from 'vitest';
import { createPlayerStore } from '../state/store';
import { hydrateSession, sessionSnapshot } from './session';

describe('插件会话恢复', () => {
  it('无效JSON结构不破坏默认歌单或允许自动播放', () => {
    const store = createPlayerStore();
    hydrateSession(store, { library: { tracks: null, playlists: [] }, playback: { volume: 99, playing: true } });
    expect(store.getState().library.playlists.default.trackIds).toEqual([]);
    expect(store.getState().playback.playing).toBe(false);
    expect(store.getState().playback.volume).toBe(1);
  });
  it('保存完整会话，再启动暂停在恢复点，不导入Go版数据', () => {
    const first = createPlayerStore();
    first.getState().importTracks([{ id: 'a', path: 'D:/a.mp3', durationMs: 30000 }]);
    first.getState().playTrack('a');
    first.getState().play();
    first.getState().recordResume('a', 9000);
    first.getState().setVolume(0.4);
    const other = createPlayerStore();
    hydrateSession(other, sessionSnapshot(first));
    expect(other.getState().playback.trackId).toBe('a');
    expect(other.getState().playback.positionMs).toBe(9000);
    expect(other.getState().playback.playing).toBe(false);
    expect(other.getState().playback.volume).toBe(0.4);
  });
  it('重载后旧blob失效被标成缺失，不误认为持久磁盘路径', () => {
    const first = createPlayerStore();
    first.getState().importTracks([{ id: 'blob:old', path: 'blob:old', title: 'file.mp3' }]);
    const other = createPlayerStore();
    hydrateSession(other, sessionSnapshot(first));
    expect(other.getState().library.tracks['blob:old'].status).toBe('missing');
  });
});
