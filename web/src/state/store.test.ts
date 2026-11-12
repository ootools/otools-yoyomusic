/**
 * Task 4 Step 2 失败测试：zustand store（slices + actions）。
 * 覆盖计划 Task 4 Step 2 逐字条目 + advance 的 >3s prev 语义
 * （Go app.go:401-407，计划拍板放 store 层）+ resume 清空动作（Task 3 审查遗留点）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useStore, type StoreState } from './store';

/** 建库快照（模块加载后的初始状态，含 actions），beforeEach 里整树复位。 */
const initial: StoreState = useStore.getState();

/** 直接改 playback 片段的便捷方法（模拟引擎 onTime 回填）。 */
function setPlayback(patch: Partial<StoreState['playback']>): void {
  useStore.setState((s) => ({ playback: { ...s.playback, ...patch } }));
}

/** 导入 3 首测试曲目（durationMs 200000 便于 resume 语义断言）。 */
function importThree(): void {
  useStore.getState().importTracks([
    { id: 't1', path: 'C:\\m\\a.mp3', title: 'A', artist: 'X', album: 'AL', durationMs: 200000 },
    { id: 't2', path: 'C:\\m\\b.mp3', title: 'B', artist: 'Y', album: 'AL', durationMs: 200000 },
    { id: 't3', path: 'C:\\m\\c.mp3', title: 'C', artist: 'Z', album: 'AL', durationMs: 200000 },
  ]);
}

beforeEach(() => {
  useStore.setState(initial, true);
});

// --- 初始 slices 形状（计划 Task 4 Interfaces + spec §10.1）---

describe('初始状态', () => {
  it('library：default 歌单 name=当前播放列表，空曲库空历史', () => {
    const { library } = useStore.getState();
    expect(library.currentPlaylist).toBe('default');
    expect(library.playlists.default.name).toBe('当前播放列表');
    expect(library.playlists.default.trackIds).toEqual([]);
    expect(library.playlists.default.currentIndex).toBe(0);
    expect(library.playlists.default.playMode).toBe('sequence');
    expect(library.tracks).toEqual({});
    expect(library.history).toEqual([]);
  });

  it('playback：volume 0.8 / 未静音 / sequence / EQ 关 / 10 段全 0', () => {
    const { playback } = useStore.getState();
    expect(playback.trackId).toBeUndefined();
    expect(playback.volume).toBe(0.8);
    expect(playback.muted).toBe(false);
    expect(playback.playMode).toBe('sequence');
    expect(playback.eqEnabled).toBe(false);
    expect(playback.eqBands).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(playback.positionMs).toBe(0);
    expect(playback.durationMs).toBe(0);
  });

  it('settings：aurora / spectrum / restoreSession / desktopLyrics{colorIdx,fontScale,locked} / zh-CN', () => {
    const { settings } = useStore.getState();
    expect(settings.skin).toBe('aurora');
    expect(settings.vizMode).toBe('spectrum');
    expect(settings.vizRandom).toBe(false);
    expect(settings.restoreSession).toBe(true);
    expect(settings.desktopLyrics).toEqual({ colorIdx: 0, fontScale: 1, locked: false });
    expect(settings.lang).toBe('zh-CN');
  });

  it('ui：曲库开 / 5 页签 / 空查询 / 无侧栏 / 无重命名 / resume 未定义（undefined=无）', () => {
    const s = useStore.getState();
    expect(s.ui.libraryOpen).toBe(true);
    expect(s.ui.libraryPinned).toBe(false);
    expect(s.ui.libraryTab).toBe(0);
    expect(s.ui.query).toBe('');
    expect(s.ui.browse).toEqual({ kind: 'album' });
    expect(s.ui.sidePanel).toBeNull();
    expect(s.ui.panelsPinned).toBe(false);
    expect(s.ui.renamingId).toBeUndefined();
    expect(s.resume).toBeUndefined();
  });
});

// --- 曲库 ---

describe('importTracks', () => {
  it('合并进曲库并追加到 default（default = 全库视图）', () => {
    importThree();
    const { library } = useStore.getState();
    expect(Object.keys(library.tracks).sort()).toEqual(['t1', 't2', 't3']);
    expect(library.tracks.t1.title).toBe('A');
    expect(library.tracks.t1.status).toBe('ok');
    expect(library.tracks.t1.liked).toBe(false);
    expect(library.playlists.default.trackIds).toEqual(['t1', 't2', 't3']);
  });

  it('重复导入不产生重复行（Go addTracks 语义）', () => {
    importThree();
    importThree();
    expect(useStore.getState().library.playlists.default.trackIds).toEqual(['t1', 't2', 't3']);
  });

  it('title 缺省回退文件名去扩展名（对齐 Task 6 建行约定）', () => {
    useStore.getState().importTracks([{ id: 'p1', path: 'D:\\音乐\\晴天.flac' }]);
    expect(useStore.getState().library.tracks.p1.title).toBe('晴天');
  });
});

describe('setTrackMeta / like', () => {
  it('setTrackMeta 局部合并元数据', () => {
    importThree();
    useStore.getState().setTrackMeta('t1', { title: 'A2', artist: 'X2', durationMs: 30000 });
    const t = useStore.getState().library.tracks.t1;
    expect(t.title).toBe('A2');
    expect(t.artist).toBe('X2');
    expect(t.durationMs).toBe(30000);
    expect(t.album).toBe('AL'); // 未给的字段不动
  });

  it('未知 id 兜底建行 → 同时加入 default（default=全库 不变量，Task 6 授权点）', () => {
    importThree();
    useStore.getState().setTrackMeta('late-1', { title: '迟到的元数据', status: 'ok', durationMs: 123 });
    const { library } = useStore.getState();
    expect(library.tracks['late-1']).toMatchObject({
      id: 'late-1',
      path: 'late-1',
      title: '迟到的元数据',
      durationMs: 123,
    });
    expect(library.playlists.default.trackIds).toContain('late-1');
  });

  it('未知 id 兜底建行不重复追加 default（已存在行时只合并）', () => {
    importThree();
    const before = useStore.getState().library.playlists.default.trackIds.length;
    useStore.getState().setTrackMeta('t1', { title: 'A2' });
    expect(useStore.getState().library.playlists.default.trackIds.length).toBe(before);
  });

  it('like 切换并返回新值', () => {
    importThree();
    expect(useStore.getState().like('t1')).toBe(true);
    expect(useStore.getState().library.tracks.t1.liked).toBe(true);
    expect(useStore.getState().like('t1')).toBe(false);
    expect(useStore.getState().like('zzz')).toBe(false); // 未知 id 不崩
  });
});

// --- 歌单 ---

describe('歌单管理', () => {
  it('addPlaylist 缺省名=我的歌单 并切换为当前', () => {
    const id = useStore.getState().addPlaylist();
    expect(id).not.toBe('default');
    expect(useStore.getState().library.playlists[id].name).toBe('我的歌单');
    expect(useStore.getState().library.currentPlaylist).toBe(id);
  });

  it('addPlaylist 指定名生效', () => {
    const id = useStore.getState().addPlaylist('摇滚');
    expect(useStore.getState().library.playlists[id].name).toBe('摇滚');
  });

  it('renamePlaylist 生效；空名无效', () => {
    const id = useStore.getState().addPlaylist('x');
    useStore.getState().renamePlaylist(id, '摇滚');
    expect(useStore.getState().library.playlists[id].name).toBe('摇滚');
    useStore.getState().renamePlaylist(id, '');
    expect(useStore.getState().library.playlists[id].name).toBe('摇滚');
  });

  it('deletePlaylist("default") 无效（计划逐字断言）', () => {
    useStore.getState().deletePlaylist('default');
    expect(useStore.getState().library.playlists.default).toBeDefined();
    expect(useStore.getState().library.currentPlaylist).toBe('default');
  });

  it('删除当前歌单回落 default（计划逐字断言）', () => {
    const id = useStore.getState().addPlaylist('tmp');
    expect(useStore.getState().library.currentPlaylist).toBe(id);
    useStore.getState().deletePlaylist(id);
    expect(useStore.getState().library.playlists[id]).toBeUndefined();
    expect(useStore.getState().library.currentPlaylist).toBe('default');
  });

  it('switchPlaylist 只切已存在的歌单', () => {
    useStore.getState().switchPlaylist('nope');
    expect(useStore.getState().library.currentPlaylist).toBe('default');
    const id = useStore.getState().addPlaylist('p');
    useStore.getState().switchPlaylist(id);
    expect(useStore.getState().library.currentPlaylist).toBe(id);
  });

  it('addToPlaylist 追加且跳过重复；removeFromPlaylist 移除并钳制游标', () => {
    importThree();
    const id = useStore.getState().addPlaylist('p');
    useStore.getState().addToPlaylist(id, 't1');
    useStore.getState().addToPlaylist(id, 't2');
    useStore.getState().addToPlaylist(id, 't1'); // 重复跳过
    expect(useStore.getState().library.playlists[id].trackIds).toEqual(['t1', 't2']);
    useStore.getState().playTrack('t2');
    expect(useStore.getState().library.playlists[id].currentIndex).toBe(1);
    useStore.getState().removeFromPlaylist(id, 't2');
    expect(useStore.getState().library.playlists[id].trackIds).toEqual(['t1']);
    expect(useStore.getState().library.playlists[id].currentIndex).toBe(0); // 钳制
  });
});

// --- 队列 ops（光标跟随，对照 Go MoveTrackUp/Down/QueueNext）---

describe('queueOps（光标跟随）', () => {
  beforeEach(() => {
    importThree();
  });

  it('playNext：把曲目移动到播放中曲目之后，游标跟随（Go QueueNext）', () => {
    useStore.getState().playTrack('t2'); // [t1,t2,t3] cursor=1
    useStore.getState().queueOps.playNext('t1'); // t1 移到 t2 后
    const pl = useStore.getState().library.playlists.default;
    expect(pl.trackIds).toEqual(['t2', 't1', 't3']);
    expect(pl.currentIndex).toBe(0); // 游标锚定播放中的 t2 → 跟随
  });

  it('playNext：无播放→插队首（计划 anchorId=null→队首；Go 为队尾，以计划为准）', () => {
    useStore.getState().queueOps.playNext('t3');
    expect(useStore.getState().library.playlists.default.trackIds).toEqual(['t3', 't1', 't2']);
  });

  it('playNext：播放中的曲目自身→不动作（Go trackID==cur 早退）', () => {
    useStore.getState().playTrack('t2');
    useStore.getState().queueOps.playNext('t2');
    expect(useStore.getState().library.playlists.default.trackIds).toEqual(['t1', 't2', 't3']);
  });

  it('append：已在队列→静默跳过队列不变（Go AddToPlaylist 语义，审查修正）', () => {
    useStore.getState().playTrack('t1'); // [t1,t2,t3] cursor=0
    useStore.getState().queueOps.append('t3'); // t3 已在队列 → 原样返回
    let pl = useStore.getState().library.playlists.default;
    expect(pl.trackIds).toEqual(['t1', 't2', 't3']);
    expect(pl.currentIndex).toBe(0); // 正在播放的 t1 不被挪到队尾
    const pid = useStore.getState().addPlaylist('q'); // 空歌单
    useStore.getState().queueOps.append('t1'); // 不在队列 → 追加末尾
    pl = useStore.getState().library.playlists[pid];
    expect(pl.trackIds).toEqual(['t1']);
  });

  it('move：移动播放游标锚定曲目时游标跟着走（Go MoveTrackUp/Down）', () => {
    useStore.getState().playTrack('t2'); // [t1,t2,t3] cursor=1
    useStore.getState().queueOps.move('t2', 1); // t2 下移
    let pl = useStore.getState().library.playlists.default;
    expect(pl.trackIds).toEqual(['t1', 't3', 't2']);
    expect(pl.currentIndex).toBe(2); // 游标跟随 t2
    useStore.getState().queueOps.move('t2', -1); // 移回
    pl = useStore.getState().library.playlists.default;
    expect(pl.trackIds).toEqual(['t1', 't2', 't3']);
    expect(pl.currentIndex).toBe(1);
  });

  it('move：移动的对象是播放曲目的交换邻居时，游标同样跟随（Go：CurrentIndex==i±1）', () => {
    useStore.getState().playTrack('t1'); // cursor=0
    useStore.getState().queueOps.move('t2', -1); // t2 上移与 t1 交换 → [t2,t1,t3]
    const pl = useStore.getState().library.playlists.default;
    expect(pl.trackIds).toEqual(['t2', 't1', 't3']);
    expect(pl.currentIndex).toBe(1); // t1 挪到了 1
  });

  it('move：首元素上移/末元素下移为边界不动作', () => {
    useStore.getState().playTrack('t1');
    useStore.getState().queueOps.move('t1', -1);
    expect(useStore.getState().library.playlists.default.trackIds).toEqual(['t1', 't2', 't3']);
    useStore.getState().queueOps.move('t3', 1);
    expect(useStore.getState().library.playlists.default.trackIds).toEqual(['t1', 't2', 't3']);
  });

  it('move：首元素 delta=1 与末元素 delta=-1 光标跟随（计划 Task 4 Step 1 点名对）', () => {
    useStore.getState().playTrack('t1'); // [t1,t2,t3] cursor=0
    useStore.getState().queueOps.move('t1', 1); // 首元素 delta=1 下移
    let pl = useStore.getState().library.playlists.default;
    expect(pl.trackIds).toEqual(['t2', 't1', 't3']);
    expect(pl.currentIndex).toBe(1); // 游标跟随播放中的 t1
    useStore.getState().playTrack('t3'); // t3 现在在末尾 idx2
    useStore.getState().queueOps.move('t3', -1); // 末元素 delta=-1 上移
    pl = useStore.getState().library.playlists.default;
    expect(pl.trackIds).toEqual(['t2', 't3', 't1']);
    expect(pl.currentIndex).toBe(1); // 游标跟随播放中的 t3
  });
});

// --- 播放推进 ---

describe('playTrack', () => {
  it('设置 trackId、清零位置、游标重指向、记历史', () => {
    importThree();
    const { playback } = useStore.getState();
    useStore.setState({ resume: undefined });
    useStore.getState().playTrack('t2');
    const s = useStore.getState();
    expect(s.playback.trackId).toBe('t2');
    expect(s.playback.positionMs).toBe(0);
    expect(s.playback.durationMs).toBe(200000);
    expect(s.library.playlists.default.currentIndex).toBe(1);
    expect(s.library.history).toHaveLength(1);
    expect(s.library.history[0].trackId).toBe('t2');
    expect(playback.trackId).not.toBe('t1');
  });

  it('未知 id 不动作', () => {
    importThree();
    useStore.getState().playTrack('zzz');
    expect(useStore.getState().playback.trackId).toBeUndefined();
  });
});

describe('advance（含 >3s prev 重播语义）', () => {
  it('repeat_all 越尾回 0（计划逐字断言）', () => {
    importThree();
    useStore.getState().playTrack('t3');
    useStore.getState().setPlayMode('repeat_all');
    const id = useStore.getState().advance(1);
    expect(id).toBe('t1');
    expect(useStore.getState().library.playlists.default.currentIndex).toBe(0);
    expect(useStore.getState().playback.trackId).toBe('t1');
    expect(useStore.getState().playback.positionMs).toBe(0);
  });

  it('sequence 到尾返回 undefined 表示停止（位置清零、trackId 保留——Go Stop 语义）', () => {
    importThree();
    useStore.getState().playTrack('t3');
    const id = useStore.getState().advance(1);
    expect(id).toBeUndefined();
    expect(useStore.getState().playback.positionMs).toBe(0);
    expect(useStore.getState().playback.trackId).toBe('t3');
  });

  it('repeat_one 原地重来：trackId 不变、位置归零', () => {
    importThree();
    useStore.getState().playTrack('t2');
    useStore.getState().setPlayMode('repeat_one');
    expect(useStore.getState().advance(1)).toBe('t2');
    expect(useStore.getState().playback.trackId).toBe('t2');
    expect(useStore.getState().playback.positionMs).toBe(0);
  });

  it('shuffle 前进 (idx+1)%len', () => {
    importThree();
    useStore.getState().playTrack('t2');
    useStore.getState().setPlayMode('shuffle');
    expect(useStore.getState().advance(1)).toBe('t3');
  });

  it('>3s prev：positionMs>3000 时回 0 而非切曲（Go app.go:401-407，store 层）', () => {
    importThree();
    useStore.getState().playTrack('t2');
    setPlayback({ positionMs: 5000 });
    const id = useStore.getState().advance(-1);
    expect(id).toBe('t2'); // 不切曲
    expect(useStore.getState().playback.trackId).toBe('t2');
    expect(useStore.getState().playback.positionMs).toBe(0); // 回 0
    expect(useStore.getState().library.playlists.default.currentIndex).toBe(1); // 游标不动
  });

  it('≤3s prev：真正切到上一首（sequence 首个→-1 停止回 0）', () => {
    importThree();
    useStore.getState().playTrack('t1');
    setPlayback({ positionMs: 1000 });
    expect(useStore.getState().advance(-1)).toBeUndefined(); // sequence 首元素
    expect(useStore.getState().playback.positionMs).toBe(0);
    // repeat_all 下 ≤3s prev 越首回尾
    useStore.getState().setPlayMode('repeat_all');
    expect(useStore.getState().advance(-1)).toBe('t3');
    expect(useStore.getState().library.playlists.default.currentIndex).toBe(2);
  });

  it('推进时记历史（Go PlayTrack → AddHistory）', () => {
    importThree();
    useStore.getState().playTrack('t1');
    useStore.getState().advance(1);
    const hist = useStore.getState().library.history;
    expect(hist[0].trackId).toBe('t2'); // 新曲头部插入
    expect(hist[1].trackId).toBe('t1');
    expect(hist).toHaveLength(2);
  });
});

describe('setPlayMode（镜像 playback 与当前歌单，Go SetPlayMode）', () => {
  it('双处同步', () => {
    useStore.getState().setPlayMode('shuffle');
    expect(useStore.getState().playback.playMode).toBe('shuffle');
    expect(useStore.getState().library.playlists.default.playMode).toBe('shuffle');
  });

  it('switchPlaylist 后镜像跟随该歌单的模式', () => {
    const id = useStore.getState().addPlaylist('p');
    useStore.getState().switchPlaylist('default'); // addPlaylist 已切到 p，先切回
    useStore.getState().setPlayMode('shuffle'); // 只改 default
    expect(useStore.getState().playback.playMode).toBe('shuffle');
    useStore.getState().switchPlaylist(id);
    expect(useStore.getState().playback.playMode).toBe('sequence'); // p 默认 sequence
  });
});

// --- 设置 ---

describe('setEQ / setVolume / setMuted', () => {
  it('setEQ 开关 + 段值（±12 钳制、长度归一到 10）', () => {
    useStore.getState().setEQ(true, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(useStore.getState().playback.eqEnabled).toBe(true);
    expect(useStore.getState().playback.eqBands).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    useStore.getState().setEQ(true, [99, -99]);
    const bands = useStore.getState().playback.eqBands;
    expect(bands).toHaveLength(10);
    expect(bands[0]).toBe(12); // 钳制
    expect(bands[1]).toBe(-12);
    expect(bands[2]).toBe(0);
    useStore.getState().setEQ(false);
    expect(useStore.getState().playback.eqEnabled).toBe(false);
    expect(useStore.getState().playback.eqBands).toHaveLength(10); // 段值保留
  });

  it('setVolume 钳制 0..1（Go SetVolume）', () => {
    useStore.getState().setVolume(0.5);
    expect(useStore.getState().playback.volume).toBe(0.5);
    useStore.getState().setVolume(2);
    expect(useStore.getState().playback.volume).toBe(1);
    useStore.getState().setVolume(-1);
    expect(useStore.getState().playback.volume).toBe(0);
  });

  it('setMuted', () => {
    useStore.getState().setMuted(true);
    expect(useStore.getState().playback.muted).toBe(true);
  });
});

// --- 历史（计划 Step 2 逐字断言）---

describe('pushHistory', () => {
  beforeEach(() => {
    importThree();
    vi.restoreAllMocks();
  });

  it('连续同曲两次后 length===1 且时间戳更新（计划逐字断言）', () => {
    const t = useStore.getState();
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000);
    t.pushHistory('t1');
    vi.spyOn(Date, 'now').mockReturnValueOnce(2000);
    t.pushHistory('t1');
    const hist = useStore.getState().library.history;
    expect(hist).toHaveLength(1);
    expect(hist[0].trackId).toBe('t1');
    expect(hist[0].playedAt).toBe(2000);
  });

  it('cap 200：3 条不同曲循环 205 次 length===200（计划逐字断言）', () => {
    const t = useStore.getState();
    for (let i = 0; i < 205; i++) {
      t.pushHistory(['t1', 't2', 't3'][i % 3]);
    }
    expect(useStore.getState().library.history).toHaveLength(200);
    // 最新在头部
    expect(useStore.getState().library.history[0].trackId).toBe('t1');
  });

  it('空 id 不动作', () => {
    useStore.getState().pushHistory('');
    expect(useStore.getState().library.history).toHaveLength(0);
  });
});

// --- 恢复点（Go SetResume :900-913 + Task 3 审查遗留点）---

describe('recordResume / clearResume', () => {
  beforeEach(() => {
    importThree();
    useStore.setState({ resume: undefined });
  });

  it('recordResume(5000) 不记、recordResume(5001) 记（计划逐字断言）', () => {
    useStore.getState().recordResume('t1', 5000);
    expect(useStore.getState().resume).toBeUndefined();
    useStore.getState().recordResume('t1', 5001);
    expect(useStore.getState().resume).toEqual({ t1: 5001 });
  });

  it('距尾 <2000 不记（Go: ms >= durationMs-2000 跳过）', () => {
    useStore.getState().recordResume('t1', 198000); // 200000-2000
    expect(useStore.getState().resume).toBeUndefined();
    useStore.getState().recordResume('t1', 197999);
    expect(useStore.getState().resume).toEqual({ t1: 197999 });
  });

  it('未知时长（库内 durationMs=0）→ 只按 >5000 判定（Go durationMs>0 守卫）', () => {
    useStore.getState().importTracks([{ id: 't9', path: 'C:\\m\\x.mp3', title: 'X', durationMs: 0 }]);
    useStore.getState().recordResume('t9', 6000);
    expect(useStore.getState().resume).toEqual({ t9: 6000 });
  });

  it('多曲目累加 Record<trackId, ms>（persist 快照 resume 键形状）', () => {
    useStore.getState().recordResume('t1', 10000);
    useStore.getState().recordResume('t2', 20000);
    expect(useStore.getState().resume).toEqual({ t1: 10000, t2: 20000 });
  });

  it('clearResume() 显式清空 → resume=null（Task 3 审查遗留点）', () => {
    useStore.getState().recordResume('t1', 10000);
    expect(useStore.getState().resume).toBeDefined();
    useStore.getState().clearResume();
    expect(useStore.getState().resume).toBeNull();
    // 清空后再记录 → 新 map 起步
    useStore.getState().recordResume('t2', 20000);
    expect(useStore.getState().resume).toEqual({ t2: 20000 });
  });

  it('clearResume(trackId) 单条删除；空 map 归 null；resume 未定义时不动', () => {
    useStore.getState().recordResume('t1', 10000);
    useStore.getState().recordResume('t2', 20000);
    useStore.getState().clearResume('t1');
    expect(useStore.getState().resume).toEqual({ t2: 20000 });
    useStore.getState().clearResume('t2');
    expect(useStore.getState().resume).toBeNull();
    useStore.setState({ resume: undefined });
    useStore.getState().clearResume('t2'); // undefined=无：不得翻成 null
    expect(useStore.getState().resume).toBeUndefined();
  });
});

// --- VizMode 占位（Task 9 替换）---

describe('VizMode 占位', () => {
  it('vizMode 接受字符串（占位类型 string，Task 9 换联合类型）', () => {
    useStore.setState((s) => ({ settings: { ...s.settings, vizMode: 'spectrum' } }));
    expect(useStore.getState().settings.vizMode).toBe('spectrum');
  });
});

// --- playing 状态位（Task 7 授权增补：纯状态位，真实播放由引擎侧执行）---

describe('playing 状态位（Task 7 授权增补）', () => {
  it('初始 false；play/pause/togglePlay 纯状态位翻转', () => {
    expect(useStore.getState().playback.playing).toBe(false);
    useStore.getState().play();
    expect(useStore.getState().playback.playing).toBe(true);
    useStore.getState().togglePlay();
    expect(useStore.getState().playback.playing).toBe(false);
    useStore.getState().togglePlay();
    expect(useStore.getState().playback.playing).toBe(true);
    useStore.getState().pause();
    expect(useStore.getState().playback.playing).toBe(false);
  });

  it('advance(1) sequence 到尾 → playing=false（Go Next→Stop，Stop 置 IsPlaying=false）', () => {
    importThree();
    useStore.getState().playTrack('t3');
    useStore.getState().play();
    expect(useStore.getState().advance(1)).toBeUndefined();
    expect(useStore.getState().playback.playing).toBe(false);
    expect(useStore.getState().playback.trackId).toBe('t3'); // Go Stop：trackId 保留
  });

  it('advance(1) 中途切曲 → playing 不动（真实播放由 Task 15 接线决定）', () => {
    importThree();
    useStore.getState().playTrack('t1');
    useStore.getState().play();
    expect(useStore.getState().advance(1)).toBe('t2');
    expect(useStore.getState().playback.playing).toBe(true);
    useStore.getState().pause();
    useStore.getState().advance(1);
    expect(useStore.getState().playback.playing).toBe(false); // 暂停中切曲不自动变播放
  });

  it('prev>3s seek0 续播 → playing 保持 true（返回值歧义由 playing 显式化解决）', () => {
    importThree();
    useStore.getState().playTrack('t2');
    useStore.getState().play();
    setPlayback({ positionMs: 5000 });
    expect(useStore.getState().advance(-1)).toBe('t2');
    expect(useStore.getState().playback.playing).toBe(true);
    expect(useStore.getState().playback.positionMs).toBe(0);
  });

  it('≤3s prev 到首（Go Prev not-ok→Seek 0，不 Stop）→ playing 不动', () => {
    importThree();
    useStore.getState().playTrack('t1');
    useStore.getState().play();
    setPlayback({ positionMs: 1000 });
    expect(useStore.getState().advance(-1)).toBeUndefined();
    expect(useStore.getState().playback.playing).toBe(true); // Go：Seek(0) 续播，非 Stop
    expect(useStore.getState().playback.positionMs).toBe(0);
  });

  it('空歌单 advance → playing=false（Go Stop，Task 4 既定语义）', () => {
    useStore.getState().play();
    expect(useStore.getState().advance(1)).toBeUndefined();
    expect(useStore.getState().playback.playing).toBe(false);
  });
});
