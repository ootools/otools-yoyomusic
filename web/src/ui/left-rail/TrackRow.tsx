import { useState } from 'react';
import type { Track } from '../../state/store';
import { useStore } from '../../state/store';
import { useRuntime } from '../../app/context';
import { t } from '../../i18n';
import { IconButton } from '../IconButton';
import { Menu, type MenuItem } from '../Menu';

export function formatTime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export function TrackRow({ track, index }: { track: Track; index: number }) {
  const library = useStore((s) => s.library);
  const playback = useStore((s) => s.playback);
  const runtime = useRuntime();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const playing = playback.trackId === track.id;
  const queue = library.playlists[library.currentPlaylist]?.trackIds ?? [];
  const items: MenuItem[] = [
    { label: t('track.next'), disabled: playing, onPick: () => runtime.action({ type: 'queue-next', id: track.id }) },
    { label: t('track.addToPlaylist'), children: Object.values(library.playlists).map((playlist) => ({
      label: playlist.name, onPick: () => runtime.action({ type: 'playlist-add', id: playlist.id, trackId: track.id }),
    })) },
    { label: t('track.append'), disabled: queue.includes(track.id), onPick: () => runtime.action({ type: 'queue-append', id: track.id }) },
    { label: t('track.up'), disabled: queue.indexOf(track.id) <= 0, onPick: () => runtime.action({ type: 'queue-move', id: track.id, delta: -1 }) },
    { label: t('track.down'), disabled: queue.indexOf(track.id) < 0 || queue.indexOf(track.id) === queue.length - 1, onPick: () => runtime.action({ type: 'queue-move', id: track.id, delta: 1 }) },
    ...(library.currentPlaylist === 'default' ? [] : [{ label: t('track.remove'), danger: true, onPick: () => runtime.action({ type: 'playlist-remove', id: library.currentPlaylist, trackId: track.id }) }]),
  ];
  const activate = () => runtime.command({ op: 'setTrack', arg: track.id });
  return <>
    <div className={`track-row ${playing ? 'is-playing' : ''}`} tabIndex={0} role="button" aria-label={`播放 ${track.title}`}
      onClick={activate} onKeyDown={(event) => { if (event.key === 'Enter' && event.target === event.currentTarget) activate(); }}
      onContextMenu={(event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY }); }}>
      <div className="track-index">{playing && playback.playing ? <span className="track-eq"><i /><i /><i /></span> : String(index + 1).padStart(2, '0')}</div>
      <div className="track-copy"><strong>{track.title}</strong><span>{track.artist || t('library.unknownArtist')}
        {track.status !== 'ok' && ` · ${t(track.status === 'missing' ? 'library.missing' : 'library.bad')}`}</span></div>
      <IconButton icon={track.liked ? 'heart-fill' : 'heart'} label={`${t(track.liked ? 'track.unlike' : 'track.like')} ${track.title}`}
        size={24} radius={6} className={track.liked ? 'liked' : ''} onClick={(event) => { event.stopPropagation(); runtime.action({ type: 'like', id: track.id }); }} />
      <time>{track.durationMs ? formatTime(track.durationMs) : '—'}</time>
    </div>
    {menu && <Menu {...menu} items={items} onClose={() => setMenu(null)} />}
  </>;
}
