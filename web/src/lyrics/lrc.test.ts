import { describe, expect, it } from 'vitest';
import { lineAt, parseLrc } from './lrc';
import { resolveLyrics } from './resolve';
import type { Track } from '../state/store';

const track: Track = { id: 'D:/music/song.mp3', path: 'D:/music/song.mp3', title: 'Song', artist: '', album: '', durationMs: 30000, status: 'ok', liked: false, hasLyrics: true };
describe('LRC 解析与歌词来源', () => {
  it('多时间戳、毫秒精度、offset 与非时间文本', () => {
    expect(parseLrc('[ti:Song]\n[offset:500]\n[00:10.5][00:20]双时间\n普通文字')).toEqual([
      { timeMs: 0, text: '普通文字' }, { timeMs: 11000, text: '双时间' }, { timeMs: 20500, text: '双时间' },
    ]);
  });
  it('时间边界前没有歌词，恰好到达高亮当前行', () => {
    const lines = parseLrc('[00:05]first\n[00:10]second');
    expect(lineAt(lines, 4999)).toBe(-1);
    expect(lineAt(lines, 5000)).toBe(0);
    expect(lineAt(lines, 10000)).toBe(1);
  });
  it('同名 .lrc 优先且缺失时回退内嵌歌词', async () => {
    const read = async (path: string) => {
      if (path.endsWith('.lrc')) return new TextEncoder().encode('[00:01]sidecar');
      throw new Error('missing');
    };
    expect(await resolveLyrics(track, read, '[00:02]embedded')).toMatchObject({ source: 'sidecar', lines: [{ timeMs: 1000, text: 'sidecar' }] });
    expect(await resolveLyrics(track, async () => { throw new Error('missing'); }, '[00:02]embedded')).toMatchObject({ source: 'embedded', lines: [{ timeMs: 2000, text: 'embedded' }] });
  });
});
