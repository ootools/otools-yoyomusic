/**
 * 元数据爬虫（spec §10.2 扫描流程 / 计划 Task 6）：
 * 导入先建行（文件名做标题、时长 0）即时出列表，后台队列逐个整读 →
 * parseMetadata → onTrack 回填 setTrackMeta。约束（spec §10.2/§13）：
 *  - 并发默认 2（大曲库限流，1,000 首 FLAC 爬完 3–8 分钟属预期）；
 *  - 可取消（cancel() + isCancelled() 轮询，取消后在途项静默不回调）；
 *  - priority() 可见行置顶（虚拟列表可见/过滤命中的行先爬）；
 *  - 单个失败不炸整体：读失败 → onTrack 标 'missing'（文件缺失，对齐
 *    恢复对账口径 spec §6.4），解析 unknown → 'bad'（Review Focus #3）；
 *  - 封面 coverBytes → makeThumb 压 96×96 JPEG 缩略图 → onThumb（spec §6.4）。
 */

import { parseMetadata } from '../audio/metadata';
import type { AudioTransport } from '../audio/transport';
import { titleFromPath, type TrackStatus } from '../state/logic';

/** onTrack 回填给 setTrackMeta 的元数据片（status 必带）。 */
export interface CrawlMeta {
  status: TrackStatus;
  title?: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  hasLyrics?: boolean;
}

export interface CrawlerOptions {
  transport: AudioTransport;
  /** 并发数，默认 2（spec §10.2 拍板） */
  concurrency?: number;
  onTrack(path: string, meta: CrawlMeta): void;
  onThumb(path: string, dataUrl: string): void;
  /** 每次取队/回调前轮询：true 即停（导入层/页面卸载置位） */
  isCancelled(): boolean;
  /** 当前可见行 path（虚拟列表/过滤结果）；null/空 = 无优先 */
  priority(): string[] | null;
}

export interface Crawler {
  push(paths: string[]): void;
  cancel(): void;
  /** 静默（无在途 worker 且队列空）时 resolve；cancel 后必然 resolve */
  readonly done: Promise<void>;
}

/** 缩略图边长（Global Constraints：96px JPEG q0.75）。 */
export const THUMB_SIZE = 96;
const THUMB_QUALITY = 0.75;

/**
 * 封面字节 → 96×96 居中裁切 JPEG data URL（spec §6.4）。
 * createImageBitmap/canvas 不可用（jsdom、老 webview）→ 返回 ''（无缩略图，不炸）。
 */
export async function makeThumb(coverBytes: Uint8Array): Promise<string> {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return '';
  let bitmap: ImageBitmap;
  try {
    // coverBytes 底层为普通 ArrayBuffer（解析器产物）；BlobPart 口径收窄，不拷贝
    bitmap = await createImageBitmap(new Blob([coverBytes as unknown as BlobPart]));
  } catch {
    return ''; // 坏封面（Task 5 已防解析炸，解码再防一道）
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_SIZE;
    canvas.height = THUMB_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    // 居中裁切（cover fit）：源图中央正方形 → 96×96
    const side = Math.min(bitmap.width, bitmap.height);
    if (side <= 0) return '';
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, THUMB_SIZE, THUMB_SIZE);
    return canvas.toDataURL('image/jpeg', THUMB_QUALITY);
  } finally {
    bitmap.close();
  }
}

export function createCrawler(opts: CrawlerOptions): Crawler {
  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? 2));
  let queue: string[] = [];
  let localCancelled = false;
  let workers = 0;

  // done 语义：静默（无 worker 且队列空）时拿到的是已 resolve 的 promise；
  // push 使其进入忙碌（懒惰武装新 promise），队列排空/取消后 resolve。
  let donePromise: Promise<void> = Promise.resolve();
  let resolveDone: (() => void) | null = null;
  let quiescent = true;

  const cancelled = (): boolean => localCancelled || opts.isCancelled();

  /** 取下一个：priority() 置顶（Set 加速扫队列），否则 FIFO。 */
  const pickNext = (): string | null => {
    const pri = opts.priority();
    if (pri && pri.length > 0) {
      const priSet = new Set(pri);
      for (let i = 0; i < queue.length; i += 1) {
        if (priSet.has(queue[i] ?? '')) return queue.splice(i, 1)[0] ?? null;
      }
    }
    return queue.shift() ?? null;
  };

  const maybeFinish = (): void => {
    if (workers > 0) return;
    if (cancelled()) queue = []; // 已取消：残余队列作废（保证 done 必然 resolve）
    if (queue.length === 0 && !quiescent && resolveDone) {
      resolveDone();
      quiescent = true;
      resolveDone = null;
    }
  };

  const processOne = async (path: string): Promise<void> => {
    let bytes: Uint8Array;
    try {
      bytes = await opts.transport.readBytes(path);
    } catch {
      if (!cancelled()) opts.onTrack(path, { status: 'missing' }); // 读失败：文件缺失口径
      return;
    }
    if (cancelled()) return;
    const meta = parseMetadata(bytes, titleFromPath(path));
    if (meta.kind === 'unknown') {
      if (!cancelled()) opts.onTrack(path, { status: 'bad' }); // 解析不了：格式不支持口径
      return;
    }
    if (!cancelled()) {
      opts.onTrack(path, {
        status: 'ok',
        title: meta.title,
        artist: meta.artist,
        album: meta.album,
        durationMs: meta.durationMs,
        hasLyrics: !!meta.lyricsText,
      });
    }
    if (meta.coverBytes && meta.coverBytes.length > 0 && !cancelled()) {
      try {
        const thumb = await makeThumb(meta.coverBytes);
        if (thumb && !cancelled()) opts.onThumb(path, thumb);
      } catch {
        // 封面解码失败不影响曲目元数据
      }
    }
  };

  const worker = async (): Promise<void> => {
    try {
      for (;;) {
        if (cancelled()) return;
        const path = pickNext();
        if (!path) return;
        try {
          await processOne(path);
        } catch {
          // onTrack/onThumb 等消费方回调抛错不炸爬虫（该项静默跳过）
        }
      }
    } finally {
      workers -= 1;
      maybeFinish();
    }
  };

  const pump = (): void => {
    while (!cancelled() && workers < concurrency && queue.length > 0) {
      workers += 1;
      void worker();
    }
    maybeFinish();
  };

  return {
    push(paths) {
      if (cancelled() || paths.length === 0) return;
      if (quiescent) {
        // 懒惰武装：进入忙碌期才创建 pending promise，静默期 done 恒为已 resolve
        donePromise = new Promise<void>((res) => {
          resolveDone = res;
        });
        quiescent = false;
      }
      queue.push(...paths);
      pump();
    },
    cancel() {
      localCancelled = true;
      queue = [];
      maybeFinish(); // 在途 worker 退出后也会走到这里兜底
    },
    get done() {
      return donePromise;
    },
  };
}
