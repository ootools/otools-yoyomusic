import type { Track } from '../state/store';
import { getFallbackFile } from '../bridge/otools';
import { parseMetadata } from '../audio/metadata';
import type { LyricLine } from './lrc';
import { parseLyricsDocument } from './parse-document';

export interface LyricsDocument { lines: LyricLine[]; source: 'sidecar' | 'embedded' | 'none'; }

export async function resolveLyrics(
  track: Track,
  read: (path: string) => Promise<Uint8Array>,
  embeddedText?: string,
): Promise<LyricsDocument> {
  if (!track.path.startsWith('blob:')) {
    const base = track.path.replace(/\.[^.\\/]+$/, '');
    for (const extension of ['.lrc', '.LRC']) {
      try {
        const lines = await parseLyricsDocument(new TextDecoder().decode(await read(base + extension)));
        if (lines.length) return { lines, source: 'sidecar' };
      } catch { /* 同名 sidecar 缺失时继续查内嵌歌词。 */ }
    }
  }
  let embedded = embeddedText;
  if (embedded === undefined && track.hasLyrics) {
    try {
      const file = getFallbackFile(track.path);
      const bytes = file ? new Uint8Array(await file.arrayBuffer()) : await read(track.path);
      embedded = parseMetadata(bytes, file?.name ?? track.path).lyricsText;
    } catch { /* 读不到歌词不影响音频播放。 */ }
  }
  const lines = embedded ? await parseLyricsDocument(embedded) : [];
  return { lines, source: lines.length ? 'embedded' : 'none' };
}
