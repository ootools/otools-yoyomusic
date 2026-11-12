/**
 * MP4/M4A：ISO BMFF 盒子遍历（含 64bit size 变体与 size=0 到文件尾）。
 * 时长 ← moov/mvhd（v0: timescale+duration 各 4 字节；v1: duration 为 64bit）；
 * 标签/封面/歌词 ← moov/udta/meta/ilst 的 ©nam/©ART/©alb/©lyr/covr。
 * 无 moov/mvhd 或盒子尺寸越界 → 抛给上层兜底。
 */
import { decodeUtf8, hasBytes, u32be, u64be, type ParsedMeta } from './bytes';

/** 盒子载荷区间（不含头）。 */
interface BoxRange {
  start: number;
  end: number;
}

export function parseMp4(b: Uint8Array): ParsedMeta {
  if (b.length < 12 || !hasBytes(b, 4, 'ftyp')) throw new Error('not mp4');
  const out: ParsedMeta = {};
  const moov = findBox(b, 0, b.length, 'moov');
  if (!moov) throw new Error('no moov box');
  const mvhd = findBox(b, moov.start, moov.end, 'mvhd');
  if (!mvhd) throw new Error('no mvhd box');
  const version = b[mvhd.start];
  let timescale = 0;
  let duration = 0;
  if (version === 1) {
    timescale = u32be(b, mvhd.start + 20);
    duration = Number(u64be(b, mvhd.start + 24));
  } else {
    timescale = u32be(b, mvhd.start + 12);
    duration = u32be(b, mvhd.start + 16);
  }
  if (timescale > 0 && duration > 0) out.durationMs = Math.round((duration / timescale) * 1000);
  readIlst(b, moov, out);
  return out;
}

/** 在 [start,end) 内找指定类型盒子；结构损坏（尺寸越界）抛错，找不到返回 null。 */
function findBox(b: Uint8Array, start: number, end: number, type: string): BoxRange | null {
  let off = start;
  while (off + 8 <= end) {
    let size = u32be(b, off);
    let hdr = 8;
    if (size === 1) {
      const big = u64be(b, off + 8);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('box size too large');
      size = Number(big);
      hdr = 16;
    } else if (size === 0) {
      size = end - off; // 到父容器/文件尾
    }
    if (size < hdr || off + size > end) throw new Error('bad box size');
    if (boxType(b, off + 4) === type) return { start: off + hdr, end: off + size };
    off += size;
  }
  return null;
}

function boxType(b: Uint8Array, off: number): string {
  return String.fromCharCode(b[off], b[off + 1], b[off + 2], b[off + 3]);
}

/** moov → udta → meta(4 字节 version/flags) → ilst 逐项读 data 盒。 */
function readIlst(b: Uint8Array, moov: BoxRange, out: ParsedMeta): void {
  const udta = findBox(b, moov.start, moov.end, 'udta');
  if (!udta) return;
  const meta = findBox(b, udta.start, udta.end, 'meta');
  if (!meta) return;
  // meta 载荷前有 4 字节 version/flags；个别 QuickTime 文件没有，两种都试
  const ilst = findBox(b, meta.start + 4, meta.end, 'ilst') ?? findBox(b, meta.start, meta.end, 'ilst');
  if (!ilst) return;
  let off = ilst.start;
  while (off + 8 <= ilst.end) {
    let size = u32be(b, off);
    let hdr = 8;
    if (size === 1) {
      size = Number(u64be(b, off + 8));
      hdr = 16;
    } else if (size === 0) {
      size = ilst.end - off;
    }
    if (size < hdr || off + size > ilst.end) break;
    const data = findBox(b, off + hdr, off + size, 'data');
    if (data) applyItem(boxType(b, off + 4), u32be(b, data.start) & 0xffffff, b.subarray(data.start + 8, data.end), out);
    off += size;
  }
}

function applyItem(type: string, flags: number, payload: Uint8Array, out: ParsedMeta): void {
  if (type === 'covr') {
    if (payload.length > 0) out.coverBytes = payload;
    return;
  }
  // data 盒 flags：1=UTF-8 文本、2=UTF-16 文本；其余（如图片类型指示）不当文本解
  const text = flags === 1 ? decodeUtf8(payload).replace(/\u0000+$/, '') : '';
  if (text.length === 0) return;
  if (type === '©nam') out.title = text;
  else if (type === '©ART' || type === 'aART') out.artist = out.artist ?? text;
  else if (type === '©alb') out.album = text;
  else if (type === '©lyr') out.lyricsText = text;
}
