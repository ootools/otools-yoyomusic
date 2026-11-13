import { useEffect, useRef } from 'react';
import { useStore } from '../../state/store';
import { useRuntime, useRuntimeState } from '../../app/context';
import { t } from '../../i18n';
import { lineAt } from '../../lyrics/lrc';
import { IconButton } from '../IconButton';

export function LyricsPanel() {
  const runtime = useRuntime();
  const { lyrics } = useRuntimeState();
  const position = useStore((s) => s.playback.positionMs);
  const active = lineAt(lyrics.lines, position);
  const activeRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { activeRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }, [active]);
  return <div className="lyrics-panel">
    <div className="lyrics-description"><p>{t('lyrics.description')}</p>
      <IconButton icon="lyrics-screen" label={t('top.desktop')} size={28} radius={7} onClick={() => { void runtime.openWindow('yoyomusic-lyrics'); }} />
    </div>
    <div className="panel-divider" />
    <div className="lyric-lines">{lyrics.lines.length ? lyrics.lines.map((line, index) => <p key={`${line.timeMs}-${index}`}
      className={`lyric-line ${index === active ? 'is-active' : ''}`} ref={index === active ? activeRef : undefined}>{line.text || '\u00a0'}</p>)
      : <p className="empty-state">{t('lyrics.empty')}</p>}</div>
  </div>;
}
