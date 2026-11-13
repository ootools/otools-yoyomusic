import { useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { useRuntime } from '../../app/context';
import { t } from '../../i18n';
import { Icon } from '../icons';
import { IconButton } from '../IconButton';
import { Menu, type MenuItem } from '../Menu';
import { ConfirmDialog } from '../ConfirmDialog';

export function PlaylistSelector() {
  const library = useStore((s) => s.library);
  const runtime = useRuntime();
  const current = library.playlists[library.currentPlaylist] ?? library.playlists.default;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [deleting, setDeleting] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const finish = () => { if (draft.trim()) runtime.action({ type: 'playlist-rename', id: current.id, name: draft.trim() }); setRenaming(false); };
  const items: MenuItem[] = [
    ...Object.values(library.playlists).map((playlist) => ({ label: playlist.name, checked: current.id === playlist.id,
      onPick: () => runtime.action({ type: 'playlist-switch', id: playlist.id }) })),
    { label: t('playlist.new'), onPick: () => runtime.action({ type: 'playlist-create', name: t('playlist.mine') }) },
    { label: t('playlist.rename'), onPick: () => { setDraft(current.name); setRenaming(true); } },
    { label: t('playlist.delete'), disabled: current.id === 'default', danger: true, onPick: () => setDeleting(true) },
  ];
  return <>
    <div className="playlist-selector">
      {renaming ? <><input value={draft} autoFocus onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') finish(); if (event.key === 'Escape') setRenaming(false); }} />
        <IconButton icon="check" label={t('common.confirm')} size={28} onClick={finish} />
        <IconButton icon="close" label={t('common.cancel')} size={28} onClick={() => setRenaming(false)} /></>
        : <button ref={trigger} className="playlist-dropdown" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.bottom + 6 }); }}>
          <span>{current.id === 'default' ? t('playlist.default') : current.name}</span><Icon name="chevron" size={16} />
        </button>}
    </div>
    {menu && <Menu {...menu} items={items} onClose={() => setMenu(null)} />}
    {deleting && <ConfirmDialog label={t('playlist.delete')} message={t('playlist.deleteConfirm', { name: current.name })}
      confirmLabel={t('common.delete')} returnFocus={trigger} onCancel={() => setDeleting(false)}
      onConfirm={() => { runtime.action({ type: 'playlist-delete', id: current.id }); setDeleting(false); }} />}
  </>;
}
