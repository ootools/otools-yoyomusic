/**
 * MP3：MPEG1/2/2.5 Layer3 帧头 + Xing/Info/VBRI → 时长；ID3v2 标签交给 id3v2.ts。
 * 无 VBR 头 → CBR 估算 durationMs ≈ fileSize×8/比特率（spec §6.4 表口径）。
 * 尾部 ID3v1（128 字节 'TAG'）仅识别跳过：首帧扫描从 ID3v2 结束处开始，永不触及尾部。
 */
import { hasBytes, u32be, type ParsedMeta } from './bytes';
import { parseId3v2, type Id3Tags } from './id3v2';

/** MPEG1 Layer3 比特率表（kbps，index=比特率槽位）。 */
const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
/** MPEG2/2.5 Layer3 比特率表。 */
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
/** 采样率表（按版本位：3=MPEG1，2=MPEG2，0=MPEG2.5）。 */
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

interface FrameInfo {
  offset: number;
  version: number; // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
  brIdx: number;
  srIdx: number;
  mode: number; // 声道模式：3=单声道
}

export function parseMp3(b: Uint8Array): ParsedMeta {
  let tags: Id3Tags = { tagEnd: 0 };
  let audioStart = 0;
  if (hasBytes(b, 0, 'ID3')) {
    tags = parseId3v2(b);
    audioStart = tags.tagEnd;
  }
  const frame = findFirstFrame(b, audioStart);
  return { ...tags, durationMs: frameDuration(b, frame) };
}

/** 找首个合法 MPEG Layer3 帧头（容忍 ID3v2 后的垃圾前缀，最多扫 64KB）。 */
function findFirstFrame(b: Uint8Array, from: number): FrameInfo {
  const limit = Math.min(b.length - 4, from + 65536);
  for (let o = Math.max(from, 0); o <= limit; o++) {
    if (b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) continue;
    const version = (b[o + 1] >> 3) & 0x03;
    const layer = (b[o + 1] >> 1) & 0x03;
    const brIdx = (b[o + 2] >> 4) & 0x0f;
    const srIdx = (b[o + 2] >> 2) & 0x03;
    if (version === 1 || layer !== 0x01) continue; // 版本保留位 / 非 Layer3
    if (brIdx === 0 || brIdx === 15 || srIdx === 3) continue; // 自由/保留槽位
    return { offset: o, version, brIdx, srIdx, mode: (b[o + 3] >> 6) & 0x03 };
  }
  throw new Error('no mpeg audio frame found');
}

function frameDuration(b: Uint8Array, f: FrameInfo): number | undefined {
  const sampleRate = (SAMPLE_RATES[f.version] ?? [])[f.srIdx] ?? 0;
  const bitrate = (f.version === 3 ? BITRATES_V1_L3 : BITRATES_V2_L3)[f.brIdx] ?? 0;
  if (sampleRate <= 0 || bitrate <= 0) return undefined;
  const samplesPerFrame = f.version === 3 ? 1152 : 576; // Layer3：MPEG1=1152，MPEG2/2.5=576
  // Xing/Info VBR 头：位于帧头+side info（MPEG1：单声道 17/立体声 32；MPEG2/2.5：9/17）
  const sideInfo = f.version === 3 ? (f.mode === 3 ? 17 : 32) : f.mode === 3 ? 9 : 17;
  const xingOff = f.offset + 4 + sideInfo;
  if (hasBytes(b, xingOff, 'Xing') || hasBytes(b, xingOff, 'Info')) {
    const flags = u32be(b, xingOff + 4);
    if ((flags & 0x01) !== 0) {
      const frames = u32be(b, xingOff + 8);
      if (frames > 0) return Math.round((frames * samplesPerFrame * 1000) / sampleRate);
    }
  }
  // VBRI（Fraunhofer）：固定在帧头后 36 字节，frames 在其 +14
  const vbriOff = f.offset + 36;
  if (hasBytes(b, vbriOff, 'VBRI')) {
    const frames = u32be(b, vbriOff + 14);
    if (frames > 0) return Math.round((frames * samplesPerFrame * 1000) / sampleRate);
  }
  // 无 VBR 头 → CBR 估算：fileSize×8/比特率（spec：文件大小/比特率）
  return Math.round((b.length * 8) / bitrate);
}
