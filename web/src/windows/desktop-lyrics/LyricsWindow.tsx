import { useEffect, useRef } from 'react';
import { useStore } from '../../state/store';
import { useRuntime, useRuntimeState } from '../../app/context';
import { t, useLocale } from '../../i18n';
import { getSkin, SKINS, applySkin } from '../../theme/skins';
import { applyTokens } from '../../theme/tokens';
import { lineAt } from '../../lyrics/lrc';
import { IconButton } from '../../ui/IconButton';
import { markCustomWindowReady, nativeWindowCommand, observeWindowPosition } from '../native';

export const LYRICS_COLORS = ['#ffffff', '#ffd666', '#78e6ff', '#ffa0c8', '#a0ffaa'] as const;
export function nextColorIdx(index: number): number { return (index + 1) % LYRICS_COLORS.length; }
export function clampFontScale(value: number): number { return Math.round(Math.max(0.6, Math.min(3, value)) * 100) / 100; }

export function LyricsWindow() {
  useLocale();
  const runtime = useRuntime();
  const status = useRuntimeState();
  const { lyrics } = status;
  const positionRestored = useRef(false);
  const settings = useStore((state) => state.settings);
  const positionMs = useStore((state) => state.playback.positionMs);
  const controls = settings.desktopLyrics;
  const active = lineAt(lyrics.lines, positionMs);
  const current = lyrics.lines[active]?.text || t('lyricsDesktop.none');
  const next = lyrics.lines[active + 1]?.text || '';
  const skin = getSkin(settings.skin) ?? SKINS[0];
  const change = (patch: Partial<typeof controls>) => runtime.action({ type: 'settings', patch: { desktopLyrics: { ...controls, ...patch } } });
  useEffect(() => { applySkin(skin); applyTokens(); }, [skin]);
  useEffect(() => {
    document.documentElement.dataset.lyricsWindow = 'true';
    void markCustomWindowReady(true).catch(() => {});
    return () => { delete document.documentElement.dataset.lyricsWindow; void markCustomWindowReady(false).catch(() => {}); };
  }, []);
  useEffect(() => {
    if (!status.ready || positionRestored.current || !window.__OTOOLS_CUSTOM_WINDOW__) return;
    const position = runtime.windowPosition?.('yoyomusic-lyrics');
    if (!position) return;
    positionRestored.current = true;
    void nativeWindowCommand('set_position', { value: { Physical: position } }).catch(() => {});
  }, [runtime, status.ready, status.updatedAt]);
  useEffect(() => {
    // 固定不可手动缩放的窗体，字号变大时自适应内容高度，避免3倍字号被110px裁掉。
    if (window.__OTOOLS_CUSTOM_WINDOW__) {
      void nativeWindowCommand('set_size', { value: { Logical: { width: 880, height: Math.max(110, Math.round(54 * controls.fontScale + 42)) } } }).catch(() => {});
    }
  }, [controls.fontScale]);
  useEffect(() => {
    let stopped = false;
    let unlisten: (() => Promise<void>) | undefined;
    void observeWindowPosition((position) => runtime.action({ type: 'window-position', id: 'yoyomusic-lyrics', ...position }))
      .then((stop) => { if (stopped) void stop().catch(() => {}); else unlisten = stop; })
      .catch(() => {});
    return () => { stopped = true; void unlisten?.().catch(() => {}); };
  }, [runtime]);
  return <main className={`desktop-lyrics ${controls.locked ? 'is-locked' : ''}`} data-route="lyrics"
    style={{ '--lyric-color': LYRICS_COLORS[controls.colorIdx], '--lyric-scale': controls.fontScale } as React.CSSProperties}
    onPointerDown={(event) => {
      if (controls.locked || event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
      void nativeWindowCommand('start_dragging').catch(() => {});
    }}>
    <div className="desktop-lyrics-toolbar">
      <IconButton icon="palette" label={t('lyricsDesktop.color')} size={26} radius={6} onClick={() => change({ colorIdx: nextColorIdx(controls.colorIdx) })} />
      <IconButton icon={controls.locked ? 'lock' : 'unlock'} label={t(controls.locked ? 'lyricsDesktop.unlock' : 'lyricsDesktop.lock')}
        active={controls.locked} size={26} radius={6} onClick={() => change({ locked: !controls.locked })} />
      <IconButton icon="minus" label={t('lyricsDesktop.smaller')} size={26} radius={6} onClick={() => change({ fontScale: clampFontScale(controls.fontScale - 0.15) })} />
      <IconButton icon="plus" label={t('lyricsDesktop.larger')} size={26} radius={6} onClick={() => change({ fontScale: clampFontScale(controls.fontScale + 0.15) })} />
      <IconButton icon="close" label={t('common.close')} size={26} radius={6} onClick={() => { void nativeWindowCommand('close').catch(() => {}); }} />
    </div>
    <div className="desktop-lyrics-pill"><p className="desktop-lyrics-current">{current}</p>{next && <p className="desktop-lyrics-next">{next}</p>}</div>
  </main>;
}
