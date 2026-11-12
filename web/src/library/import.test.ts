/**
 * Task 6 Step 1 失败测试：导入流程（spec §10.2 扫描流程：先建行文件名先行 → 后台爬虫）。
 *  - dialog 取消 → 不建行不爬；
 *  - 扩展名过滤 [mp3,wav,flac,ogg,aac,m4a,opus]（大小写不敏感）；blob: 条目放行；
 *  - 建行 title=titleFromPath、durationMs=0，并追加进 default（default=全库）；
 *  - 只爬新增（重复导入不重爬）；多次导入共享同一爬虫（总并发恒 ≤2）；
 *  - onTrack/onThumb 接线 setTrackMeta；priority 接线可见行（当前歌单 × 搜索过滤）；
 *  - directory：listDirectoryRecursive 过滤扩展名；取消 → 无动作；扫描失败 → 不建行不炸。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useStore, type StoreState } from '../state/store';
import { importFromDialog, importFromDirectory, resetImportCrawlerForTests } from './import';

/* ------------------------------------------------------------------ *
 * mock：宿主桥（pick/list）+ 爬虫工厂（记录 push/cancel 与 opts）
 * ------------------------------------------------------------------ */

const bridgeMock = vi.hoisted(() => ({
  pickAudioFiles: vi.fn<() => Promise<string[] | null>>(),
  pickDirectory: vi.fn<() => Promise<string | null>>(),
  listDirectoryRecursive: vi.fn<
    (dir: string) => Promise<{ path: string; size: number }[]>
  >(),
  readFileBytes: vi.fn(),
}));
vi.mock('../bridge/otools', () => ({ ...bridgeMock }));

interface RecordedCrawler {
  pushes: string[][];
  cancels: number;
  opts: {
    transport: unknown;
    onTrack: (path: string, meta: Record<string, unknown>) => void;
    onThumb: (path: string, dataUrl: string) => void;
    isCancelled: () => boolean;
    priority: () => string[] | null;
  } | null;
}

const crawlerMock = vi.hoisted(() => ({ createCrawler: vi.fn() }));
vi.mock('./crawler', () => ({ createCrawler: crawlerMock.createCrawler }));

/** 记录型爬虫：单例被 import 层缓存，故用稳定对象 + beforeEach 清零。 */
const recorded: RecordedCrawler = { pushes: [], cancels: 0, opts: null };

crawlerMock.createCrawler.mockImplementation((opts: RecordedCrawler['opts']) => {
  recorded.opts = opts!;
  return {
    push: (paths: string[]) => {
      recorded.pushes.push([...paths]);
    },
    cancel: () => {
      recorded.cancels += 1;
    },
    done: Promise.resolve(),
  };
});

/* ------------------------------------------------------------------ *
 * store 复位（与 store.test.ts 同款快照复位）
 * ------------------------------------------------------------------ */

const initial: StoreState = useStore.getState();

beforeEach(() => {
  useStore.setState(initial, true);
  resetImportCrawlerForTests(); // 单例爬虫逐用例重建，mock 计数/opts 不串味
  recorded.pushes = [];
  recorded.cancels = 0;
  recorded.opts = null;
  crawlerMock.createCrawler.mockClear();
  bridgeMock.pickAudioFiles.mockReset();
  bridgeMock.pickDirectory.mockReset();
  bridgeMock.listDirectoryRecursive.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ *
 * importFromDialog
 * ------------------------------------------------------------------ */

describe('importFromDialog', () => {
  it('取消（null）→ 不建行不爬', async () => {
    bridgeMock.pickAudioFiles.mockResolvedValue(null);
    await importFromDialog();
    const { library } = useStore.getState();
    expect(library.tracks).toEqual({});
    expect(library.playlists.default.trackIds).toEqual([]);
    expect(recorded.pushes).toEqual([]);
    expect(crawlerMock.createCrawler).not.toHaveBeenCalled();
  });

  it('选中文件 → 建行（title=titleFromPath、durationMs=0、status ok）并入 default，crawler.push 全量', async () => {
    bridgeMock.pickAudioFiles.mockResolvedValue(['D:\\音乐\\晴天.flac', 'D:/m/B.MP3']);
    await importFromDialog();

    const { library } = useStore.getState();
    expect(library.tracks['D:\\音乐\\晴天.flac']).toMatchObject({
      id: 'D:\\音乐\\晴天.flac',
      path: 'D:\\音乐\\晴天.flac',
      title: '晴天',
      durationMs: 0,
      status: 'ok',
    });
    expect(library.tracks['D:/m/B.MP3']?.title).toBe('B'); // 扩展名大小写不敏感
    expect(library.playlists.default.trackIds).toEqual(['D:\\音乐\\晴天.flac', 'D:/m/B.MP3']);
    expect(recorded.pushes).toEqual([['D:\\音乐\\晴天.flac', 'D:/m/B.MP3']]);
  });

  it('过滤非音频扩展名与无扩展名条目', async () => {
    bridgeMock.pickAudioFiles.mockResolvedValue([
      'D:/a.mp3',
      'D:/notes.txt',
      'D:/noext',
      'D:/c.OGG',
    ]);
    await importFromDialog();
    expect(useStore.getState().library.tracks).toHaveProperty('D:/a.mp3');
    expect(useStore.getState().library.tracks).toHaveProperty('D:/c.OGG');
    expect(useStore.getState().library.tracks).not.toHaveProperty('D:/notes.txt');
    expect(useStore.getState().library.tracks).not.toHaveProperty('D:/noext');
    expect(recorded.pushes).toEqual([['D:/a.mp3', 'D:/c.OGG']]);
  });

  it('blob: 条目（浏览器降级 objectURL）放行建行', async () => {
    bridgeMock.pickAudioFiles.mockResolvedValue(['blob:mock-0', 'blob:mock-1']);
    await importFromDialog();
    expect(Object.keys(useStore.getState().library.tracks).sort()).toEqual(['blob:mock-0', 'blob:mock-1']);
    expect(recorded.pushes).toEqual([['blob:mock-0', 'blob:mock-1']]);
  });

  it('重复导入：建行走 store 去重，爬虫只推新增，且共享同一爬虫实例', async () => {
    bridgeMock.pickAudioFiles.mockResolvedValueOnce(['D:/a.mp3']);
    await importFromDialog();
    bridgeMock.pickAudioFiles.mockResolvedValueOnce(['D:/a.mp3', 'D:/b.mp3']);
    await importFromDialog();

    expect(recorded.pushes).toEqual([['D:/a.mp3'], ['D:/b.mp3']]);
    expect(crawlerMock.createCrawler).toHaveBeenCalledTimes(1); // 单例爬虫：总并发恒 ≤2
    expect(useStore.getState().library.playlists.default.trackIds).toEqual(['D:/a.mp3', 'D:/b.mp3']);
  });

  it('onTrack/onThumb 接线 setTrackMeta（行先建，元数据后补）', async () => {
    bridgeMock.pickAudioFiles.mockResolvedValue(['D:/a.mp3']);
    await importFromDialog();
    expect(recorded.opts).not.toBeNull();

    recorded.opts!.onTrack('D:/a.mp3', { status: 'ok', title: '真标题', artist: '歌手', durationMs: 42 });
    const t = useStore.getState().library.tracks['D:/a.mp3'];
    expect(t.title).toBe('真标题');
    expect(t.artist).toBe('歌手');
    expect(t.durationMs).toBe(42);
    expect(t.status).toBe('ok');

    recorded.opts!.onThumb('D:/a.mp3', 'data:image/jpeg;base64,AA');
    expect(useStore.getState().library.tracks['D:/a.mp3']?.coverThumb).toBe('data:image/jpeg;base64,AA');
  });

  it('爬虫 opts 携带 Blob 传输层与可见行 priority', async () => {
    bridgeMock.pickAudioFiles.mockResolvedValue(['D:/a.mp3', 'D:/b.mp3']);
    await importFromDialog();

    const transport = recorded.opts!.transport as Record<string, unknown>;
    expect(typeof transport.resolve).toBe('function');
    expect(typeof transport.readBytes).toBe('function');
    expect(typeof transport.revoke).toBe('function');
    expect(typeof (transport as { prime?: unknown }).prime).toBe('function');

    // priority = 当前歌单 × 搜索过滤（可见行近似）
    expect(recorded.opts!.priority()).toEqual(['D:/a.mp3', 'D:/b.mp3']); // 空查询 → 全部
    useStore.setState((s) => ({ ui: { ...s.ui, query: 'a' } }));
    expect(recorded.opts!.priority()).toEqual(['D:/a.mp3']);
    useStore.setState((s) => ({ ui: { ...s.ui, query: '' } }));
  });
});

/* ------------------------------------------------------------------ *
 * importFromDirectory
 * ------------------------------------------------------------------ */

describe('importFromDirectory', () => {
  it('选目录 → listDirectoryRecursive 过滤扩展名后建行并爬', async () => {
    bridgeMock.pickDirectory.mockResolvedValue('D:/music');
    bridgeMock.listDirectoryRecursive.mockResolvedValue([
      { path: 'D:/music/a.mp3', size: 1 },
      { path: 'D:/music/sub/b.ogg', size: 2 },
      { path: 'D:/music/cover.jpg', size: 3 },
    ]);
    await importFromDirectory();

    expect(bridgeMock.listDirectoryRecursive).toHaveBeenCalledWith('D:/music');
    expect(Object.keys(useStore.getState().library.tracks).sort()).toEqual([
      'D:/music/a.mp3',
      'D:/music/sub/b.ogg',
    ]);
    expect(recorded.pushes).toEqual([['D:/music/a.mp3', 'D:/music/sub/b.ogg']]);
  });

  it('取消选目录（null）→ 不建行不爬', async () => {
    bridgeMock.pickDirectory.mockResolvedValue(null);
    await importFromDirectory();
    expect(useStore.getState().library.tracks).toEqual({});
    expect(recorded.pushes).toEqual([]);
    expect(bridgeMock.listDirectoryRecursive).not.toHaveBeenCalled();
  });

  it('扫描失败（根目录读不了，bridge reject）→ 不建行不炸、不爬', async () => {
    bridgeMock.pickDirectory.mockResolvedValue('D:/locked');
    bridgeMock.listDirectoryRecursive.mockRejectedValue(new Error('access denied'));
    await expect(importFromDirectory()).resolves.toBeUndefined();
    expect(useStore.getState().library.tracks).toEqual({});
    expect(recorded.pushes).toEqual([]);
  });

  it('空目录（成功返回 []）→ 无行无爬（与失败区分）', async () => {
    bridgeMock.pickDirectory.mockResolvedValue('D:/empty');
    bridgeMock.listDirectoryRecursive.mockResolvedValue([]);
    await importFromDirectory();
    expect(useStore.getState().library.tracks).toEqual({});
    expect(recorded.pushes).toEqual([]);
  });
});
