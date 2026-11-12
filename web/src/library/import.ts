/**
 * 曲库导入（spec §10.2 扫描流程 / 计划 Task 6）：
 *  1. pickAudioFiles / pickDirectory + listDirectoryRecursive 拿到 path 列表；
 *  2. 过滤音频扩展名 [mp3,wav,flac,ogg,aac,m4a,opus]（大小写不敏感；blob: 条目
 *     是浏览器降级 objectURL，直接放行）；
 *  3. importTracks 先建行（title=titleFromPath、durationMs=0）即时出列表；
 *  4. crawler.push 后台爬元数据（并发 2、可取消、可见行优先）。
 *
 * 多次导入共享同一爬虫实例（队列累加），总并发恒 ≤2；重复导入只爬新增，
 * 已建行的曲目不重爬。取消/失败约定：对话框取消 → 不建行不爬；目录扫描
 * 失败（bridge 根目录 listHostDir 失败会 reject，区别于空目录的 []）→ 不建行、
 * console.warn 供诊断，不炸 UI。
 */

import { createBlobTransport, type AudioTransport } from '../audio/transport';
import { listDirectoryRecursive, pickAudioFiles, pickDirectory } from '../bridge/otools';
import { filterTracks, type Track } from '../state/logic';
import { useStore } from '../state/store';
import { createCrawler, type Crawler } from './crawler';

/** 支持的音频扩展名（对齐 pickAudioFiles 的 dialog filters，spec §10.2）。 */
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a', 'opus']);

/** 音频路径判定：blob: 条目直接放行；其余按扩展名（大小写不敏感）。 */
export function isAudioPath(path: string): boolean {
  if (path.startsWith('blob:')) return true;
  const base = path.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 && AUDIO_EXTENSIONS.has(base.slice(dot + 1).toLowerCase());
}

let sharedCrawler: Crawler | null = null;

/** 共享爬虫 + 传输层（惰性创建一次；多次导入累加队列，总并发恒 ≤2）。 */
function crawlerForImport(): Crawler {
  if (sharedCrawler) return sharedCrawler;
  const transport: AudioTransport = createBlobTransport();
  sharedCrawler = createCrawler({
    transport,
    concurrency: 2,
    isCancelled: () => false,
    priority: visiblePaths,
    onTrack: (path, meta) => useStore.getState().setTrackMeta(path, meta),
    onThumb: (path, dataUrl) => useStore.getState().setTrackMeta(path, { coverThumb: dataUrl }),
  });
  return sharedCrawler;
}

/** 丢弃共享爬虫单例（仅测试隔离用：单例跨用例存活会让 mock 计数串味）。 */
export function resetImportCrawlerForTests(): void {
  sharedCrawler = null;
}

/**
 * 可见行近似：当前歌单 × 搜索过滤（曲库打开时通常就是用户盯着的行）。
 * TODO(Task 12): 虚拟列表落地后换成真实可见窗口的 path 集。
 */
function visiblePaths(): string[] | null {
  const s = useStore.getState();
  const pl = s.library.playlists[s.library.currentPlaylist] ?? s.library.playlists.default;
  if (!pl) return null;
  const rows = pl.trackIds
    .map((id) => s.library.tracks[id])
    .filter((t): t is Track => !!t);
  if (rows.length === 0) return null;
  return filterTracks(rows, s.ui.query).map((t) => t.path);
}

/** 建行（文件名先行）→ 只把新增的交给爬虫。 */
function importAndCrawl(paths: string[]): void {
  const audio = paths.filter(isAudioPath);
  if (audio.length === 0) return;

  const { library, importTracks } = useStore.getState();
  importTracks(audio.map((path) => ({ id: path, path }))); // store 去重；title/durationMs 缺省兜底
  const fresh = audio.filter((path) => !library.tracks[path]); // 已在库的不重爬
  if (fresh.length === 0) return;
  crawlerForImport().push(fresh);
}

/** 文件对话框导入：取消（null）→ 不建行不爬。 */
export async function importFromDialog(): Promise<void> {
  const picked = await pickAudioFiles();
  if (!picked) return;
  importAndCrawl(picked);
}

/** 文件夹导入：递归扫描后过滤扩展名；扫描失败不建行不炸。 */
export async function importFromDirectory(): Promise<void> {
  const dir = await pickDirectory();
  if (!dir) return;
  let entries: { path: string; size: number }[];
  try {
    entries = await listDirectoryRecursive(dir);
  } catch (err) {
    // 根目录读不了（bridge reject，区别于空目录）：不建行，留诊断信息
    console.warn('[yoyomusic] 目录扫描失败', err);
    return;
  }
  importAndCrawl(entries.map((entry) => entry.path));
}
