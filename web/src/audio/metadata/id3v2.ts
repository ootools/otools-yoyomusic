/**
 * ID3v2.3 / ID3v2.4 标签解析（mp3.ts 专用子模块，不算独立格式解析器）。
 * 只取 TIT2/TPE1/TALB/USLT/APIC；压缩/加密/unsynchronisation 帧一律安全跳过不实现。
 */
import { decodeLatin1, decodeUtf16, decodeUtf16be, decodeUtf8, hasBytes, syncsafe32, u16be, u32be, type ParsedMeta } from './bytes';

export interface Id3Tags extends ParsedMeta {
  /** 标签总长结尾（含 padding），即音频数据起始偏移。 */
  tagEnd: number;
}

export function parseId3v2(b: Uint8Array): Id3Tags {
  if (b.length < 10 || !hasBytes(b, 0, 'ID3')) throw new Error('bad id3v2 header');
  const major = b[3];
  if (major !== 3 && major !== 4) throw new Error(`unsupported id3v2.${major}`);
  const flags = b[5];
  const size = major === 4 ? syncsafe32(b, 6) : u32be(b, 6); // v2.4 同步安全 / v2.3 普通 u32
  const tagEnd = Math.min(10 + size, b.length);
  const out: Id3Tags = { tagEnd };
  if ((flags & 0x80) !== 0) return out; // 全局 unsynchronisation：不实现，跳过帧解析防崩
  let off = 10;
  if ((flags & 0x40) !== 0 && off + 4 <= tagEnd) {
    // extended header：v2.4 尺寸含自身（syncsafe）；v2.3 尺寸不含 4 字节长度域
    off += major === 4 ? syncsafe32(b, 10) : 4 + u32be(b, 10);
    if (off > tagEnd) return out;
  }
  while (off + 10 <= tagEnd) {
    if (b[off] === 0x00) break; // padding
    const id = String.fromCharCode(b[off], b[off + 1], b[off + 2], b[off + 3]);
    const fsize = major === 4 ? syncsafe32(b, off + 4) : u32be(b, off + 4);
    const fflags = u16be(b, off + 8);
    const bodyEnd = off + 10 + fsize;
    if (fsize <= 0 || bodyEnd > tagEnd) break; // 尺寸异常：停在安全处
    let body = off + 10;
    if (major === 3) {
      if ((fflags & 0x00c0) !== 0) { off = bodyEnd; continue; } // 压缩/加密 → 跳过
      if ((fflags & 0x0020) !== 0) body += 1; // grouping
    } else {
      if ((fflags & 0x000e) !== 0) { off = bodyEnd; continue; } // 压缩/加密/逐帧 unsync → 跳过
      if ((fflags & 0x0040) !== 0) body += 1; // grouping
      if ((fflags & 0x0001) !== 0) body += 4; // data length indicator
    }
    const content = b.subarray(Math.min(body, bodyEnd), bodyEnd);
    if (id === 'TIT2') out.title = textFrame(content);
    else if (id === 'TPE1') out.artist = textFrame(content);
    else if (id === 'TALB') out.album = textFrame(content);
    else if (id === 'USLT') out.lyricsText = usltFrame(content);
    else if (id === 'APIC') out.coverBytes = apicFrame(content);
    off = bodyEnd;
  }
  return out;
}

/** 按 ID3 编码字节解码文本（0=ISO-8859-1，1=UTF-16 w/BOM，2=UTF-16BE 无 BOM，3=UTF-8）。 */
function decodeText(b: Uint8Array, enc: number): string {
  if (enc === 0) return decodeLatin1(b);
  if (enc === 2) return decodeUtf16be(b); // enc=2 规范无 BOM，恒大端（ID3v2.4 §4）
  if (enc === 3) return decodeUtf8(b);
  return decodeUtf16(b); // enc=1：按 BOM 定字节序
}

/** 文本帧：enc(1) + 文本（带终结符，解码到首个终结符为止）。 */
function textFrame(content: Uint8Array): string | undefined {
  if (content.length < 2) return undefined;
  const enc = content[0];
  const rest = content.subarray(1);
  let end: number;
  if (enc === 1 || enc === 2) {
    end = rest.length;
    for (let i = 0; i + 1 < rest.length; i++) {
      if (rest[i] === 0 && rest[i + 1] === 0) { end = i; break; }
    }
  } else {
    const z = rest.indexOf(0);
    end = z === -1 ? rest.length : z;
  }
  const s = decodeText(rest.subarray(0, end), enc);
  return s.length > 0 ? s : undefined;
}

/** USLT 歌词帧：enc(1) + lang(3) + 终结符描述 + 歌词文本。 */
function usltFrame(content: Uint8Array): string | undefined {
  if (content.length < 5) return undefined;
  const enc = content[0];
  let off = 4; // enc + 3 字节语言码
  if (enc === 1 || enc === 2) {
    while (off + 1 < content.length && !(content[off] === 0 && content[off + 1] === 0)) off += 2;
    off += 2;
  } else {
    while (off < content.length && content[off] !== 0) off += 1;
    off += 1;
  }
  const rest = content.subarray(Math.min(off, content.length));
  let end = rest.length;
  if (enc === 1 || enc === 2) {
    if (end >= 2 && rest[end - 2] === 0 && rest[end - 1] === 0) end -= 2;
  } else if (end >= 1 && rest[end - 1] === 0) end -= 1;
  const s = decodeText(rest.subarray(0, end), enc);
  return s.length > 0 ? s : undefined;
}

/** APIC 封面帧：enc(1) + mime\0 + type(1) + 终结符描述 + 图片数据。 */
function apicFrame(content: Uint8Array): Uint8Array | undefined {
  if (content.length < 4) return undefined;
  const enc = content[0];
  let off = 1;
  while (off < content.length && content[off] !== 0) off += 1; // mime（latin1）
  off += 2; // mime 终结符 + picture type
  if (enc === 1 || enc === 2) {
    while (off + 1 < content.length && !(content[off] === 0 && content[off + 1] === 0)) off += 2;
    off += 2;
  } else {
    while (off < content.length && content[off] !== 0) off += 1;
    off += 1;
  }
  if (off > content.length) return undefined;
  const data = content.subarray(off);
  return data.length > 0 ? data : undefined;
}
