/**
 * 元数据解析入口：魔数嗅探分发到 5 个格式解析器。
 * 契约（计划 Task 5）：parseMetadata 绝不抛异常 —— 任何非法结构
 * → kind:'unknown' + title=fileName 去扩展名兜底；
 * artist/album 缺省返回 undefined（“未知艺术家/未知专辑”回退命名在 UI 层做，
 * 对齐 Go library.go loadTrack：标题缺省用文件名）。
 */
import { hasBytes, type ParsedMeta } from './bytes';
import { parseFlac } from './flac';
import { parseMp3 } from './mp3';
import { parseMp4 } from './mp4';
import { parseOgg } from './ogg';
import { parseWav } from './wav';

export interface TrackMeta {
  kind: 'mp3' | 'flac' | 'ogg' | 'wav' | 'mp4' | 'unknown';
  title?: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  coverBytes?: Uint8Array;
  lyricsText?: string;
}

type FormatKind = Exclude<TrackMeta['kind'], 'unknown'>;

const PARSERS: Record<FormatKind, (b: Uint8Array) => ParsedMeta> = {
  mp3: parseMp3,
  flac: parseFlac,
  ogg: parseOgg,
  wav: parseWav,
  mp4: parseMp4,
};

export function parseMetadata(bytes: Uint8Array, fileName: string): TrackMeta {
  const fallbackTitle = stripExtension(fileName);
  try {
    const kind = sniff(bytes);
    const parser = kind === 'unknown' ? undefined : PARSERS[kind];
    if (!parser) return { kind: 'unknown', title: fallbackTitle };
    const meta = parser(bytes);
    return {
      kind,
      title: meta.title && meta.title.length > 0 ? meta.title : fallbackTitle,
      artist: meta.artist && meta.artist.length > 0 ? meta.artist : undefined,
      album: meta.album && meta.album.length > 0 ? meta.album : undefined,
      durationMs: meta.durationMs,
      coverBytes: meta.coverBytes,
      lyricsText: meta.lyricsText,
    };
  } catch {
    // 损坏/不完整文件：落 unknown，不崩 UI（计划 Review Focus #3）
    return { kind: 'unknown', title: fallbackTitle };
  }
}

/** ID3 → mp3；0xFFEx → mp3；fLaC / OggS / RIFF+WAVE / ..ftyp 各归其位。 */
function sniff(b: Uint8Array): FormatKind | 'unknown' {
  if (hasBytes(b, 0, 'ID3')) return 'mp3';
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'mp3';
  if (hasBytes(b, 0, 'fLaC')) return 'flac';
  if (hasBytes(b, 0, 'OggS')) return 'ogg';
  if (hasBytes(b, 0, 'RIFF') && hasBytes(b, 8, 'WAVE')) return 'wav';
  if (hasBytes(b, 4, 'ftyp')) return 'mp4';
  return 'unknown';
}

/** 文件名去扩展名（无扩展名/点开头文件原样返回）。 */
function stripExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}
