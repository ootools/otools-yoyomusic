/**
 * FLAC：'fLaC' + 元数据块遍历。
 * 时长 ← STREAMINFO（sampleRate 20bit + totalSamples 36bit）；
 * 标签/歌词 ← VORBIS_COMMENT（TITLE/ARTIST/ALBUM/LYRICS/UNSYNCEDLYRICS）；
 * 封面 ← PICTURE 块。last-block 标志结束遍历，块越界即损坏 → 抛给上层兜底。
 */
import { hasBytes, parseFlacPicture, readVorbisComments, u24be, u32be, type ParsedMeta } from './bytes';

export function parseFlac(b: Uint8Array): ParsedMeta {
  if (!hasBytes(b, 0, 'fLaC')) throw new Error('not flac');
  const out: ParsedMeta = {};
  let sampleRate = 0;
  let totalSamples = 0;
  let off = 4;
  while (off + 4 <= b.length) {
    const header = b[off];
    const type = header & 0x7f;
    const last = (header & 0x80) !== 0;
    const len = u24be(b, off + 1);
    const body = off + 4;
    if (body + len > b.length) throw new Error('flac block overrun');
    if (type === 0 && len >= 18) {
      // 块体：min/max blocksize(2+2) min/max framesize(3+3) 之后是 8 字节打包字段（+10 起）：
      // 20bit 采样率 + 3bit 声道-1 + 5bit 位深-1 + 36bit 总样本数
      sampleRate = (b[body + 10] << 12) | (b[body + 11] << 4) | (b[body + 12] >> 4);
      totalSamples = (b[body + 13] & 0x0f) * 4294967296 + u32be(b, body + 14);
    } else if (type === 4) {
      applyComments(out, readVorbisComments(b, body, body + len));
    } else if (type === 6) {
      try {
        out.coverBytes = parseFlacPicture(b.subarray(body, body + len)).data;
      } catch {
        // 坏封面只丢封面，标签/时长照常（与 ogg 侧 METADATA_BLOCK_PICTURE 同语义）
      }
    }
    off = body + len;
    if (last) break;
  }
  if (sampleRate <= 0) throw new Error('no flac STREAMINFO');
  if (totalSamples > 0) out.durationMs = Math.round((totalSamples / sampleRate) * 1000);
  return out;
}

/** Vorbis 注释键 → 元数据字段（LYRICS 优先于 UNSYNCEDLYRICS）。 */
function applyComments(out: ParsedMeta, c: Record<string, string>): void {
  out.title = c['TITLE'];
  out.artist = c['ARTIST'];
  out.album = c['ALBUM'];
  out.lyricsText = c['LYRICS'] ?? c['UNSYNCEDLYRICS'];
}
