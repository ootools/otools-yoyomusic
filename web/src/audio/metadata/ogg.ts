/**
 * OGG：OggS 页遍历（轻量：头页取 vorbis id header + comment header，尾部取末页 granule）。
 * durationMs = 末页 granule / sampleRate × 1000；页链损坏/缺 id header → 抛给上层兜底。
 * METADATA_BLOCK_PICTURE = base64(FLAC PICTURE 块)。
 */
import {
  base64Decode,
  hasBytes,
  parseFlacPicture,
  readVorbisComments,
  u32le,
  u64le,
  type ParsedMeta,
} from './bytes';

const MAX_HEADER_PAGES = 32; // 头页只可能出现在文件开头，32 页封顶防大文件全量扫描

export function parseOgg(b: Uint8Array): ParsedMeta {
  if (!hasBytes(b, 0, 'OggS')) throw new Error('not ogg');
  const out: ParsedMeta = {};
  let sampleRate = 0;
  let gotComments = false;
  let off = 0;
  for (let page = 0; page < MAX_HEADER_PAGES && off + 27 <= b.length; page++) {
    if (!hasBytes(b, off, 'OggS')) throw new Error('broken ogg page chain');
    const segCount = b[off + 26];
    const tableOff = off + 27;
    if (tableOff + segCount > b.length) throw new Error('truncated ogg page header');
    let payloadLen = 0;
    for (let i = 0; i < segCount; i++) payloadLen += b[tableOff + i];
    const payloadOff = tableOff + segCount;
    if (payloadOff + payloadLen > b.length) throw new Error('truncated ogg page payload');
    const payload = b.subarray(payloadOff, payloadOff + payloadLen);
    if (sampleRate === 0 && payload.length >= 30 && payload[0] === 0x01 && hasBytes(payload, 1, 'vorbis')) {
      sampleRate = u32le(payload, 12); // identification header
    } else if (!gotComments && payload.length >= 7 && payload[0] === 0x03 && hasBytes(payload, 1, 'vorbis')) {
      gotComments = true;
      applyComments(out, payload);
    }
    off = payloadOff + payloadLen;
    if (sampleRate > 0 && gotComments) break;
  }
  if (sampleRate <= 0) throw new Error('no vorbis identification header');
  const granule = lastGranule(b);
  if (granule > 0n) out.durationMs = Math.round((Number(granule) / sampleRate) * 1000);
  return out;
}

/** 从尾部反向找最后一个 OggS 页，读其 64bit granule（页序号 +6）。 */
function lastGranule(b: Uint8Array): bigint {
  for (let p = b.length - 27; p >= 0; p--) {
    if (hasBytes(b, p, 'OggS')) return u64le(b, p + 6);
  }
  return 0n;
}

function applyComments(out: ParsedMeta, payload: Uint8Array): void {
  const c = readVorbisComments(payload, 7, payload.length); // 跳过 0x03 'vorbis'
  out.title = c['TITLE'];
  out.artist = c['ARTIST'];
  out.album = c['ALBUM'];
  out.lyricsText = c['LYRICS'] ?? c['UNSYNCEDLYRICS'];
  const b64 = c['METADATA_BLOCK_PICTURE'];
  if (b64) {
    try {
      out.coverBytes = parseFlacPicture(base64Decode(b64.replace(/\s+/g, ''))).data;
    } catch {
      // 封面损坏不影响其余元数据
    }
  }
}
