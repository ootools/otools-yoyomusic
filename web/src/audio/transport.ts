/**
 * Blob 传输层（spec §6.1 / 计划 Task 6）—— v1 唯一 AudioTransport 实现。
 *
 * resolve = readFileBytes 整读（内部已做 base64 解码）→ Blob →
 * URL.createObjectURL，产出可直接给 `<audio src>` 的 blob: URL；
 * revoke 统一释放（引擎换曲时调用）。
 *
 * prime(path) 预读下一首（Review Focus #1）：30–60MB FLAC 整读 base64 有 1–3s
 * 换曲延迟，后台先把下一首烤成 Blob URL，换曲 resolve 直接命中零等待。
 * 缓存容量 1、换曲即换：新 prime 顶掉旧槽位，未消费的旧预读落地后立即
 * revoke（大文件不双份驻留内存）；被 resolve 消费过的 URL 归引擎所有，
 * 不做 revoke（引擎自己换曲时释放）。
 *
 * blob: 前缀条目（浏览器降级约定，Task 2）：path 以 blob: 开头时直接作为
 * resolve 结果使用（无宿主读盘）；readBytes 对其走 fetch 读 Blob 字节。
 */

import { readFileBytes } from '../bridge/otools';

export interface AudioTransport {
  /** 返回可直接给 `<audio src>` / fetch 的 URL */
  resolve(path: string): Promise<string>;
  /** 读取文件字节（元数据解析用） */
  readBytes(path: string): Promise<Uint8Array>;
  /** 释放 resolve 产出的 URL */
  revoke(url: string): void;
}

/** createBlobTransport 的具体类型：在 AudioTransport 之上多一个 prime 预读。 */
export interface BlobTransport extends AudioTransport {
  /** 预读下一首进缓存（容量 1，换曲即换）；blob: 条目无需预读 */
  prime(path: string): void;
}

const BLOB_PREFIX = 'blob:';

/** 扩展名 → MIME：给 `<audio>` 解码器正确提示（未知扩展名留空交给浏览器嗅探）。 */
const MIME_BY_EXT: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  opus: 'audio/ogg',
};

function mimeForPath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  return MIME_BY_EXT[ext] ?? '';
}

/** 预读槽位：容量 1。consumed 标记 resolve 是否已接管其 URL。 */
interface PrimeSlot {
  path: string;
  promise: Promise<string>;
  consumed: boolean;
}

/**
 * BlobPart 收窄：readFileBytes 产出的 Uint8Array 底层实际都是普通 ArrayBuffer
 * （宿主 base64 解码路径），TS 的 ArrayBufferLike 泛型口径在此一次性收窄；
 * 不做 bytes 拷贝（大 FLAC 整读双倍内存不可接受，Review Focus #1）。
 */
const asBlobPart = (bytes: Uint8Array): BlobPart => bytes as unknown as BlobPart;

export function createBlobTransport(): BlobTransport {
  let slot: PrimeSlot | null = null;

  // readFileBytes（Task 2）已含 base64 解码（atob+循环，勿引依赖），返回原始字节；
  // 这里只剩 整读 → Blob → objectURL。
  const resolveFresh = async (path: string): Promise<string> => {
    const bytes = await readFileBytes(path);
    return URL.createObjectURL(new Blob([asBlobPart(bytes)], { type: mimeForPath(path) }));
  };

  return {
    async resolve(path) {
      if (path.startsWith(BLOB_PREFIX)) return path; // 降级条目：本身就是 URL
      if (slot && slot.path === path) {
        const hit = slot;
        hit.consumed = true; // URL 归调用方（引擎）所有
        const url = await hit.promise;
        if (slot === hit) slot = null; // 消费即清，槽位让给下一次 prime
        return url;
      }
      return resolveFresh(path);
    },

    async readBytes(path) {
      if (path.startsWith(BLOB_PREFIX)) {
        const res = await fetch(path);
        return new Uint8Array(await res.arrayBuffer());
      }
      return readFileBytes(path);
    },

    revoke(url) {
      URL.revokeObjectURL(url);
    },

    prime(path) {
      if (path.startsWith(BLOB_PREFIX)) return;
      const prev = slot;
      slot = { path, consumed: false, promise: resolveFresh(path) };
      if (prev && !prev.consumed) {
        // 被顶掉的未消费预读：落地即释放，避免大 FLAC 双份驻留
        void prev.promise.then(
          (url) => URL.revokeObjectURL(url),
          () => {}, // 读失败本就没有 URL
        );
      }
    },
  };
}
