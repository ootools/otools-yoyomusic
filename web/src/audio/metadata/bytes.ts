/**
 * Task 5 共享字节工具：5 个解析器（mp3/flac/ogg/wav/mp4）互不 import 对方，
 * 全部从本模块取整数/文本读法；FLAC PICTURE 与 Vorbis 注释结构被 flac 与 ogg
 * 共用（ogg 的 METADATA_BLOCK_PICTURE 就是 base64 过的 FLAC PICTURE 块），
 * 因此这两个结构读取器也放在这里。
 */

/** 五个解析器共同返回的原始元数据（缺省字段一律 undefined，命名回退在 UI 层做）。 */
export interface ParsedMeta {
  title?: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  coverBytes?: Uint8Array;
  lyricsText?: string;
}

// ---------- 整数读法 ----------

export function u8(b: Uint8Array, o: number): number {
  return b[o];
}
export function u16be(b: Uint8Array, o: number): number {
  return (b[o] << 8) | b[o + 1];
}
export function u16le(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}
export function u24be(b: Uint8Array, o: number): number {
  return (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
}
export function u32be(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}
export function u32le(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}
export function u64be(b: Uint8Array, o: number): bigint {
  return (BigInt(u32be(b, o)) << 32n) | BigInt(u32be(b, o + 4));
}
export function u64le(b: Uint8Array, o: number): bigint {
  return BigInt(u32le(b, o)) | (BigInt(u32le(b, o + 4)) << 32n);
}
/** ID3v2.4 同步安全整数（每字节仅低 7 位）。 */
export function syncsafe32(b: Uint8Array, o: number): number {
  return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
}

/** ASCII 魔数比较（越界=不匹配，绝不抛）。 */
export function hasBytes(b: Uint8Array, off: number, s: string): boolean {
  if (off < 0 || off + s.length > b.length) return false;
  for (let i = 0; i < s.length; i++) {
    if (b[off + i] !== s.charCodeAt(i)) return false;
  }
  return true;
}

// ---------- 文本解码 ----------

export function decodeLatin1(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

export function decodeUtf8(b: Uint8Array): string {
  return new TextDecoder('utf-8').decode(b);
}

/** UTF-16：带 BOM 按 BOM 走，无 BOM 按 LE（ID3 实践惯例）。 */
export function decodeUtf16(b: Uint8Array): string {
  if (b.length < 2) return '';
  let le = true;
  let start = 2;
  if (b[0] === 0xff && b[1] === 0xfe) le = true;
  else if (b[0] === 0xfe && b[1] === 0xff) le = false;
  else start = 0;
  return new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(b.subarray(start));
}

// ---------- Vorbis 注释（FLAC VORBIS_COMMENT 块 / OGG comment 头共用） ----------

/**
 * 从 b[off] 起读 vendor + 注释列表，键统一大写；任何截断都安全停下不抛。
 * end 为注释区右边界（不含）。
 */
export function readVorbisComments(b: Uint8Array, off: number, end: number): Record<string, string> {
  const out: Record<string, string> = {};
  const safeEnd = Math.min(end, b.length);
  if (off + 4 > safeEnd) return out;
  const vendorLen = u32le(b, off);
  off += 4 + vendorLen;
  if (off + 4 > safeEnd) return out;
  const count = u32le(b, off);
  off += 4;
  for (let i = 0; i < count && off + 4 <= safeEnd; i++) {
    const len = u32le(b, off);
    off += 4;
    if (len > safeEnd - off) break; // 长度越界=截断/损坏
    const entry = decodeUtf8(b.subarray(off, off + len));
    off += len;
    const eq = entry.indexOf('=');
    if (eq > 0) out[entry.slice(0, eq).toUpperCase()] = entry.slice(eq + 1);
  }
  return out;
}

// ---------- FLAC PICTURE 结构（flac PICTURE 块 / ogg METADATA_BLOCK_PICTURE 共用） ----------

export function parseFlacPicture(b: Uint8Array): { mime: string; pictureType: number; data: Uint8Array } {
  if (b.length < 32) throw new Error('flac picture too short');
  const pictureType = u32be(b, 0);
  const mimeLen = u32be(b, 4);
  let off = 8;
  if (mimeLen > b.length - off - 20) throw new Error('flac picture mime overrun');
  const mime = decodeUtf8(b.subarray(off, off + mimeLen));
  off += mimeLen;
  const descLen = u32be(b, off);
  off += 4;
  if (descLen > b.length - off - 20) throw new Error('flac picture desc overrun');
  off += descLen + 16; // 描述 + width/height/depth/colors
  const dataLen = u32be(b, off);
  off += 4;
  if (dataLen > b.length - off) throw new Error('flac picture data overrun');
  return { mime, pictureType, data: b.subarray(off, off + dataLen) };
}

// ---------- base64（ogg METADATA_BLOCK_PICTURE 用；浏览器/Node 全局 atob） ----------

export function base64Decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
