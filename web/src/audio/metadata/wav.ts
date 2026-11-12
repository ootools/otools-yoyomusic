/**
 * WAV：RIFF/WAVE 块遍历。
 * 时长 ← fmt 的 byteRate + data 块大小（dataSize/byteRate×1000）；
 * 标签 ← LIST/INFO 的 INAM/IART/IPRD 尽力解析。
 * 无 fmt 块 → 抛给上层兜底。
 */
import { decodeUtf8, hasBytes, u32le, type ParsedMeta } from './bytes';

export function parseWav(b: Uint8Array): ParsedMeta {
  if (b.length < 12 || !hasBytes(b, 0, 'RIFF') || !hasBytes(b, 8, 'WAVE')) throw new Error('not wav');
  const out: ParsedMeta = {};
  let byteRate = 0;
  let dataSize = 0;
  let off = 12;
  while (off + 8 <= b.length) {
    const id = String.fromCharCode(b[off], b[off + 1], b[off + 2], b[off + 3]);
    const size = u32le(b, off + 4);
    const body = off + 8;
    if (id === 'fmt ' && size >= 16 && body + 16 <= b.length) {
      // audioFormat(2) channels(2) sampleRate(4) byteRate(4) blockAlign(2) bits(2)
      byteRate = u32le(b, body + 8);
    } else if (id === 'data') {
      dataSize = size;
    } else if (id === 'LIST' && hasBytes(b, body, 'INFO')) {
      readListInfo(b, body + 4, Math.min(body + size, b.length), out);
    }
    off = body + size + (size & 1); // RIFF 块按 2 字节对齐；size=0 也会推进 8 字节，无死循环
  }
  if (byteRate <= 0) throw new Error('no wav fmt chunk');
  if (dataSize > 0) out.durationMs = Math.round((dataSize / byteRate) * 1000);
  return out;
}

/** LIST/INFO 子块：INAM=标题、IART=艺术家、IPRD=专辑（null 结尾文本）。 */
function readListInfo(b: Uint8Array, start: number, end: number, out: ParsedMeta): void {
  let off = start;
  while (off + 8 <= end) {
    const id = String.fromCharCode(b[off], b[off + 1], b[off + 2], b[off + 3]);
    const size = u32le(b, off + 4);
    const body = off + 8;
    if (body + size > end) break; // 子块越界=损坏
    const text = decodeUtf8(b.subarray(body, body + size)).replace(/\u0000+$/, '');
    if (id === 'INAM') out.title = text;
    else if (id === 'IART') out.artist = text;
    else if (id === 'IPRD') out.album = text;
    off = body + size + (size & 1);
  }
}
