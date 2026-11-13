import { parseLrc, type LyricLine } from './lrc';

/** 精确架构包的可选lib；OS兼容包disabled时不主动加载，失败仍用已验证的TS解析。 */
export async function parseLyricsDocument(text: string): Promise<LyricLine[]> {
  const host = window.otools ?? window.utools;
  if (host?.probeNative && host.invokeNative) {
    try {
      const status = await host.probeNative();
      if (status.enabled) {
        const data = await host.invokeNative('lyrics.parse', { text }) as { lines?: unknown };
        if (Array.isArray(data?.lines) && data.lines.every((line) => line && typeof line.timeMs === 'number' && Number.isFinite(line.timeMs) && typeof line.text === 'string')) {
          return data.lines as LyricLine[];
        }
      }
    } catch { /* 原生可选库不阻断完整音乐播放/桌面歌词能力。 */ }
  }
  return parseLrc(text);
}
