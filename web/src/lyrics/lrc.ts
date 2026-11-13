export interface LyricLine { timeMs: number; text: string; }

/** 同 Go LRC 语义：多时间戳、metadata 跳过，保留普通文本和时间空行。 */
export function parseLrc(text: string): LyricLine[] {
  const offset = Number(text.match(/\[offset\s*:\s*([+-]?\d+)\]/i)?.[1] ?? 0);
  const lines: LyricLine[] = [];
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const timestamps = [...raw.matchAll(/\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    const content = raw.replace(/\[[^\]]*\]/g, '').trim();
    if (timestamps.length) {
      for (const match of timestamps) {
        const fraction = match[3] ? Number(`0.${match[3]}`) * 1000 : 0;
        lines.push({ timeMs: Math.max(0, Number(match[1]) * 60000 + Number(match[2]) * 1000 + fraction + offset), text: content });
      }
    } else if (content && !/^\s*\[[a-z]+:/i.test(raw)) {
      lines.push({ timeMs: 0, text: content });
    }
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs);
}
export function lineAt(lines: LyricLine[], positionMs: number, offsetMs = 0): number {
  let lo = 0;
  let hi = lines.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].timeMs <= positionMs + offsetMs) { result = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return result;
}
