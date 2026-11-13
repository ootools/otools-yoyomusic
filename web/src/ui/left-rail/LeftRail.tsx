import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Track } from '../../state/store';
import { useStore } from '../../state/store';
import { useRuntime, useRuntimeState } from '../../app/context';
import { filterTracks, relativeTime } from '../../state/logic';
import { t, useLocale } from '../../i18n';
import { detectHost } from '../../bridge/otools';
import { PlaylistSelector } from './PlaylistSelector';
import { TrackRow } from './TrackRow';
import { SegmentedControl } from '../SegmentedControl';
import { IconButton } from '../IconButton';
import { Icon } from '../icons';
import { Menu } from '../Menu';

function VirtualRows({ rows, render }: { rows: Track[]; render: (track: Track, index: number) => ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const height = 54;
  const start = Math.max(0, Math.floor(top / height) - 4);
  const end = Math.min(rows.length, start + 28);
  useEffect(() => { setTop(0); if (container.current) container.current.scrollTop = 0; }, [rows.length]);
  return <div className="library-scroll" ref={container} onScroll={(event) => setTop(event.currentTarget.scrollTop)}>
    <div style={{ height: start * height }} />{rows.slice(start, end).map((track, index) => <div style={{ height }} key={`${track.id}-${start + index}`}>{render(track, start + index)}</div>)}
    <div style={{ height: Math.max(0, rows.length - end) * height }} />
  </div>;
}

export function LeftRail() {
  useLocale();
  const library = useStore((s) => s.library);
  const ui = useStore((s) => s.ui);
  const runtime = useRuntime();
  const runtimeState = useRuntimeState();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [group, setGroup] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const all = Object.values(library.tracks);
  const playlist = library.playlists[library.currentPlaylist] ?? library.playlists.default;
  const tracks = filterTracks(playlist.trackIds.map((id) => library.tracks[id]).filter((track): track is Track => !!track), ui.query);
  const filteredAll = filterTracks(all, ui.query);
  const likes = filteredAll.filter((track) => track.liked);
  const browseKind = ui.libraryTab === 1 ? 'album' : 'artist';
  const unknown = t(browseKind === 'album' ? 'library.unknownAlbum' : 'library.unknownArtist');
  const groups = new Map<string, Track[]>();
  for (const track of filteredAll) { const name = track[browseKind] || unknown; groups.set(name, [...groups.get(name) ?? [], track]); }
  const runImport = async (folder: boolean) => { setImporting(true); try { await (folder ? runtime.importFolder() : runtime.importFiles()); } finally { setImporting(false); } };
  const renderTrack = (track: Track, index: number) => <TrackRow track={track} index={index} />;
  let content: ReactNode;
  if (ui.libraryTab === 0) content = tracks.length ? <VirtualRows rows={tracks} render={renderTrack} /> : <p className="empty-state">{t(all.length ? 'library.noResults' : 'library.empty')}</p>;
  else if (ui.libraryTab === 4) content = likes.length ? <VirtualRows rows={likes} render={renderTrack} /> : <p className="empty-state">{t('likes.empty')}</p>;
  else if (ui.libraryTab === 3) {
    const history = library.history.map((entry) => ({ ...entry, track: library.tracks[entry.trackId] })).filter((entry) => entry.track && filteredAll.some((track) => track.id === entry.trackId));
    content = history.length ? <div className="library-scroll">{history.map((entry, index) => <div className="history-entry" key={`${entry.trackId}-${index}`}>
      <TrackRow track={entry.track} index={index} /><small>{relativeTime(entry.playedAt, Date.now())}</small></div>)}</div> : <p className="empty-state">{t('history.empty')}</p>;
  } else if (group) {
    const grouped = (groups.get(group) ?? []).sort((a, b) => a.title.localeCompare(b.title));
    content = <><div className="browse-heading"><button onClick={() => setGroup(null)}><Icon name="back" size={14} />{t('common.back')}</button><strong>{group}</strong></div><VirtualRows rows={grouped} render={renderTrack} /></>;
  } else content = <div className="library-scroll">{[...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, values], index) => <button className={`browse-row ${index % 2 === 0 ? 'is-striped' : ''}`} key={name} onClick={() => setGroup(name)}>
    <span className="browse-icon"><Icon name={browseKind} size={18} /></span><span className="track-copy"><strong>{name}</strong><span>{browseKind === 'album' && `${values[0].artist || t('library.unknownArtist')} · `}{t('library.countTracks', { count: values.length })}</span></span><Icon name="chevron-right" size={14} />
  </button>)}{!groups.size && <p className="empty-state">{t('library.noResults')}</p>}</div>;
  return <div className="left-rail-content">
    <PlaylistSelector />
    <div className="library-tools">
      <SegmentedControl tabs={['list', 'albums', 'artists', 'history', 'likes'].map((tab) => t(`library.tab.${tab}`))} value={ui.libraryTab} onChange={(index) => { runtime.patchUi({ libraryTab: index as 0 | 1 | 2 | 3 | 4 }); setGroup(null); }} />
      <IconButton icon="plus" label={t('library.importFiles')} size={28} radius={7} disabled={importing} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.bottom + 5 }); }} />
      <IconButton icon="pin" label={t(ui.libraryPinned ? 'common.unpin' : 'common.pin')} size={28} radius={7} active={ui.libraryPinned} onClick={() => runtime.patchUi({ libraryPinned: !ui.libraryPinned })} />
    </div>
    <div className="search-field"><Icon name="search" size={14} /><input value={ui.query} placeholder={t('library.search')} onChange={(event) => runtime.patchUi({ query: event.target.value })} /></div>
    {importing && <div className="import-status"><span className="loading-dot" />{t('library.importing')}</div>}
    {content}
    {menu && <Menu {...menu} onClose={() => setMenu(null)} items={[
      { label: t('library.importFiles'), onPick: () => { void runImport(false); } },
      { label: t('library.importFolder'), disabled: !detectHost().hostDir, onPick: () => { void runImport(true); } },
      { label: t('library.cancelCrawl'), onPick: () => runtime.action({ type: 'crawl-cancel' }) },
    ]} />}
    {!runtimeState.ready && <div className="import-status">{t('common.loading')}</div>}
  </div>;
}
