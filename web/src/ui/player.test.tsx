import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { RuntimeProvider } from '../app/context';
import type { AppRuntime, RuntimeState } from '../app/actions';
import { useStore } from '../state/store';
import { LeftRail } from './left-rail/LeftRail';
import { RightRail } from './right-rail/RightRail';
import { Transport } from './transport/Transport';
import { AppLayout } from './AppLayout';
import { applyDataAction } from '../app/data';
import { setLocale } from '../i18n';

const initial = useStore.getState();
const state: RuntimeState = { loading: false, ready: true, error: null, owner: null, lyrics: { lines: [], source: 'none' }, updatedAt: 0, route: 'panel' };
const runtime: AppRuntime = {
  action: (action) => applyDataAction(useStore, action),
  patchUi: (patch) => useStore.setState((s) => ({ ui: { ...s.ui, ...patch } })),
  command: (command) => { if (command.op === 'setTrack') useStore.getState().playTrack(String(command.arg)); },
  importFiles: async () => {}, importFolder: async () => {}, importPaths: () => {}, openWindow: async () => {},
  getState: () => state, subscribe: () => () => {}, getFrame: () => ({ bands: new Float32Array(56), wave: new Float32Array(256), level: 0, beat: 0 }),
  position: () => 0, clearError: () => {}, start: async () => {}, dispose: () => {},
};
const wrap = (node: React.ReactNode) => render(<RuntimeProvider runtime={runtime}>{node}</RuntimeProvider>);
beforeEach(() => {
  useStore.setState(initial, true); setLocale('zh-CN');
  useStore.getState().importTracks([{ id: 'a', path: 'D:/Song.mp3', title: 'Song A', artist: 'Artist X', album: 'Album Y', durationMs: 65000 }]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
// jsdom没有ResizeObserver；保留真实AppLayout，只补不可用的浏览器观察器。
const wrapLayout = (appRuntime = runtime) => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  return render(<RuntimeProvider runtime={appRuntime}><AppLayout route="panel" /></RuntimeProvider>);
};

describe('播放器可操作界面', () => {
  it('曲目行播放，心形可切换喜欢，搜索隐藏不匹配曲目', () => {
    wrap(<LeftRail />);
    fireEvent.click(screen.getByText('Song A'));
    expect(useStore.getState().playback.trackId).toBe('a');
    fireEvent.click(screen.getByRole('button', { name: '喜欢 Song A' }));
    expect(useStore.getState().library.tracks.a.liked).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('搜索标题、歌手或专辑'), { target: { value: 'none' } });
    expect(screen.queryByText('Song A')).toBeNull();
  });
  it('在喜欢按钮上按Enter不会冒泡触发整行播放', () => {
    wrap(<LeftRail />);
    const like = screen.getByRole('button', { name: '喜欢 Song A' });
    fireEvent.keyDown(like, { key: 'Enter' });
    expect(useStore.getState().playback.trackId).toBeUndefined();
  });
  it('右键菜单默认歌单没有移除，命名歌单允许移除', () => {
    const view = wrap(<LeftRail />);
    fireEvent.contextMenu(screen.getByText('Song A'));
    expect(screen.queryByRole('menuitem', { name: '从当前歌单移除' })).toBeNull();
    view.unmount();
    const id = useStore.getState().addPlaylist('旅行');
    useStore.getState().addToPlaylist(id, 'a');
    wrap(<LeftRail />);
    fireEvent.contextMenu(screen.getByText('Song A'));
    fireEvent.click(screen.getByRole('menuitem', { name: '从当前歌单移除' }));
    expect(useStore.getState().library.playlists[id].trackIds).toEqual([]);
  });
  it('删除确认弹层挂在body而不是被曲库玻璃浮层裁切', () => {
    useStore.getState().addPlaylist('旅行');
    wrap(<LeftRail />);
    fireEvent.click(screen.getByRole('button', { name: '旅行' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '删除歌单' }));
    const dialog = screen.getByRole('dialog', { name: '删除歌单' });
    expect(dialog.closest('.left-rail-content')).toBeNull();
  });
  it('删除确认Escape取消并保留歌单、曲目与文件路径', () => {
    const id = useStore.getState().addPlaylist('旅行');
    useStore.getState().addToPlaylist(id, 'a');
    wrap(<LeftRail />);
    fireEvent.click(screen.getByRole('button', { name: '旅行' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '删除歌单' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useStore.getState().library.playlists[id].trackIds).toEqual(['a']);
    expect(useStore.getState().library.currentPlaylist).toBe(id);
    expect(useStore.getState().library.tracks.a.path).toBe('D:/Song.mp3');
  });
  it('删除确认初始聚焦取消，Tab循环且卸载后回到歌单按钮', () => {
    useStore.getState().addPlaylist('旅行');
    wrap(<LeftRail />);
    const trigger = screen.getByRole('button', { name: '旅行' });
    act(() => trigger.focus());
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: '删除歌单' }));
    const dialog = screen.getByRole('dialog', { name: '删除歌单' });
    const cancel = within(dialog).getByRole('button', { name: '取消' });
    const confirm = within(dialog).getByRole('button', { name: '删除' });
    expect(document.activeElement).toBe(cancel);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(cancel, { key: 'Tab' });
    expect(document.activeElement).toBe(confirm);
    act(() => trigger.focus());
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.click(cancel);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it('默认歌单删除仍禁用，确认只移除命名歌单而保留原音乐', () => {
    wrap(<LeftRail />);
    fireEvent.click(screen.getByRole('button', { name: '当前播放列表' }));
    const protectedItem = screen.getByRole('menuitem', { name: '删除歌单' }) as HTMLButtonElement;
    expect(protectedItem.disabled).toBe(true);
    fireEvent.click(protectedItem);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    let id = '';
    act(() => { id = useStore.getState().addPlaylist('旅行'); useStore.getState().addToPlaylist(id, 'a'); });
    fireEvent.click(screen.getByRole('button', { name: '旅行' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '删除歌单' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '删除' }));
    expect(useStore.getState().library.playlists[id]).toBeUndefined();
    expect(useStore.getState().library.currentPlaylist).toBe('default');
    expect(useStore.getState().library.tracks.a.path).toBe('D:/Song.mp3');
    expect(useStore.getState().library.playlists.default.trackIds).toEqual(['a']);
  });
  it('删除弹窗存在时背景Space不执行command，取消后恢复播放快捷键', () => {
    useStore.getState().addPlaylist('旅行');
    useStore.setState((s) => ({ ui: { ...s.ui, libraryOpen: true } }));
    const commands: string[] = [];
    wrapLayout({ ...runtime, command: (command) => {
      commands.push(command.op);
      if (command.op === 'toggle') useStore.getState().togglePlay();
    } });
    fireEvent.click(screen.getByRole('button', { name: '旅行' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '删除歌单' }));
    const background = document.querySelector('.player-layout') as HTMLElement;
    fireEvent.keyDown(background, { key: ' ', code: 'Space' });
    expect(commands).toEqual([]);
    expect(useStore.getState().playback.playing).toBe(false);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.keyDown(background, { key: ' ', code: 'Space' });
    expect(commands).toEqual(['toggle']);
    expect(useStore.getState().playback.playing).toBe(true);
  });
  it('重命名编辑离开曲库3秒不卸载草稿，blur后按原规则折叠', () => {
    vi.useFakeTimers();
    useStore.getState().addPlaylist('旅行');
    useStore.setState((s) => ({ ui: { ...s.ui, libraryOpen: true, libraryPinned: false } }));
    wrapLayout();
    fireEvent.click(screen.getByRole('button', { name: '旅行' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名歌单' }));
    const input = document.querySelector('.playlist-selector input') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: '夜行草稿' } });
    fireEvent.pointerLeave(document.querySelector('.left-rail') as HTMLElement);
    act(() => vi.advanceTimersByTime(3000));
    expect(document.querySelector('.playlist-selector input')).toBe(input);
    expect(input.value).toBe('夜行草稿');
    act(() => input.blur());
    act(() => vi.advanceTimersByTime(3000));
    expect(document.querySelector('.left-rail')).toBeNull();
  });
  it('专辑与歌手页可下钻曲目，喜欢页只显示已标喜欢', () => {
    wrap(<LeftRail />);
    fireEvent.click(screen.getByRole('tab', { name: '专辑' }));
    fireEvent.click(screen.getByText('Album Y'));
    expect(screen.getByText('Song A')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    fireEvent.click(screen.getByRole('tab', { name: '歌手' }));
    fireEvent.click(screen.getByText('Artist X'));
    expect(screen.getByText('Song A')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '喜欢' }));
    expect(screen.queryByText('Song A')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '列表' }));
    fireEvent.click(screen.getByRole('button', { name: '喜欢 Song A' }));
    fireEvent.click(screen.getByRole('tab', { name: '喜欢' }));
    expect(screen.getByText('Song A')).toBeTruthy();
  });
  it('歌单新建与内联重命名后不会删除原音乐', () => {
    wrap(<LeftRail />);
    fireEvent.click(screen.getByRole('button', { name: '当前播放列表' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '新建歌单' }));
    const id = useStore.getState().library.currentPlaylist;
    expect(id).not.toBe('default');
    fireEvent.click(screen.getByRole('button', { name: '我的歌单' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名歌单' }));
    const input = document.querySelector('.playlist-selector input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '夜行' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useStore.getState().library.playlists[id].name).toBe('夜行');
    expect(useStore.getState().library.tracks.a.title).toBe('Song A');
  });
  it('均衡器显示10频段，预设修改真实store', () => {
    useStore.setState((s) => ({ ui: { ...s.ui, sidePanel: 'eq' } }));
    wrap(<RightRail />);
    expect(screen.getAllByRole('slider')).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: '重低音' }));
    expect(useStore.getState().playback.eqEnabled).toBe(true);
    expect(useStore.getState().playback.eqBands[0]).toBe(8);
  });
  it('播放条展示曲名和时长，没有曲目时禁用进度条', () => {
    wrap(<Transport />);
    expect(screen.getByText('尚未播放')).toBeTruthy();
    expect((screen.getByRole('slider', { name: '播放进度' }) as HTMLInputElement).disabled).toBe(true);
  });
});
