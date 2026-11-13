import { useEffect, useRef, useState } from 'react';
import { useStore, type PlayMode } from '../../state/store';
import { useRuntime, useRuntimeState } from '../../app/context';
import { t, useLocale } from '../../i18n';
import { IconButton } from '../IconButton';
import { Icon } from '../icons';
import { formatTime } from '../left-rail/TrackRow';

export const PLAY_MODE_CYCLE: PlayMode[] = ['sequence', 'repeat_all', 'repeat_one', 'shuffle'];
const MODE_ICONS: Record<PlayMode, string> = { sequence: 'sequence', repeat_all: 'repeat', repeat_one: 'repeat-one', shuffle: 'shuffle' };
const MODE_KEYS: Record<PlayMode, string> = { sequence: 'sequence', repeat_all: 'repeatAll', repeat_one: 'repeatOne', shuffle: 'shuffle' };
export function muteIconKind(volume: number, muted: boolean): 'high' | 'mid' | 'low' | 'mute' {
  return muted ? 'mute' : volume > 0.67 ? 'high' : volume > 0.34 ? 'mid' : 'low';
}

export function useScrubHold(durationMs: number, positionMs: number, holdMs = 250) {
  const [draft, setDraft] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return {
    value: Math.max(0, Math.min(durationMs || 0, draft ?? positionMs)),
    onScrub(value: number) {
      setDraft(value);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setDraft(null), holdMs);
    },
  };
}

export function Transport() {
  useLocale();
  const runtime = useRuntime();
  const status = useRuntimeState();
  const playback = useStore((state) => state.playback);
  const track = useStore((state) => playback.trackId ? state.library.tracks[playback.trackId] : undefined);
  const scrub = useScrubHold(playback.durationMs, playback.positionMs);
  const progress = playback.durationMs ? scrub.value / playback.durationMs * 100 : 0;
  const switchMode = () => runtime.action({ type: 'play-mode', mode: PLAY_MODE_CYCLE[(PLAY_MODE_CYCLE.indexOf(playback.playMode) + 1) % 4] });
  return <footer className="transport">
    <div className="seek-row">
      <input className="seek-slider" type="range" aria-label={t('transport.seek')} min={0} max={playback.durationMs || 1} step={100}
        disabled={!track || !playback.durationMs} value={scrub.value} style={{ '--progress': `${progress}%` } as React.CSSProperties}
        onChange={(event) => { const ms = Number(event.target.value); scrub.onScrub(ms); runtime.command({ op: 'seek', arg: ms }); }} />
    </div>
    <div className="transport-deck">
      <div className="now-playing">
        <div className={`cover-art ${playback.playing ? 'is-live' : ''}`}>
          {track?.coverThumb ? <img src={track.coverThumb} alt="" /> : <Icon name="music" size={22} />}
        </div>
        <div className="now-copy"><strong title={track?.title}>{track?.title || t('transport.idle')}</strong>
          <span>{track ? `${track.artist || t('library.unknownArtist')} · ${track.album || t('library.unknownAlbum')}` : t('transport.idleHint')}</span>
        </div>
      </div>
      <div className="play-controls">
        <IconButton icon={MODE_ICONS[playback.playMode]} label={t('transport.modeTip', { mode: t(`playMode.${MODE_KEYS[playback.playMode]}`) })}
          size={34} radius={9} onClick={switchMode} active={playback.playMode !== 'sequence'} />
        <IconButton icon="prev" label={t('transport.previous')} size={38} radius={19} onClick={() => runtime.command({ op: 'prev' })} />
        <IconButton icon={status.loading ? 'music' : playback.playing ? 'pause' : 'play'} label={t(playback.playing ? 'transport.pause' : 'transport.play')}
          size={46} radius={23} className={`play-primary ${status.loading ? 'is-loading' : ''}`} onClick={() => runtime.command({ op: 'toggle' })} />
        <IconButton icon="next" label={t('transport.next')} size={38} radius={19} onClick={() => runtime.command({ op: 'next' })} />
      </div>
      <div className="volume-controls">
        <time>{formatTime(scrub.value)} <span>/</span> {formatTime(playback.durationMs)}</time>
        <IconButton icon={`volume-${muteIconKind(playback.volume, playback.muted)}`} label={t(playback.muted ? 'transport.unmute' : 'transport.mute')}
          onClick={() => runtime.command({ op: 'mute', arg: !playback.muted })} />
        <input type="range" className="volume-slider" aria-label={t('transport.volume')} min={0} max={1} step={0.01} value={playback.volume}
          style={{ '--progress': `${playback.volume * 100}%` } as React.CSSProperties} onChange={(event) => runtime.command({ op: 'volume', arg: Number(event.target.value) })} />
      </div>
    </div>
  </footer>;
}
