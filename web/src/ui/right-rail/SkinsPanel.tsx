import { useStore } from '../../state/store';
import { useRuntime } from '../../app/context';
import { SKINS } from '../../theme/skins';
import { Icon } from '../icons';

export function SkinsPanel() {
  const selected = useStore((s) => s.settings.skin);
  const runtime = useRuntime();
  return <div className="skin-list">{SKINS.map((skin) => <button key={skin.id} className={`skin-card ${selected === skin.id ? 'is-active' : ''}`}
    onClick={() => runtime.action({ type: 'settings', patch: { skin: skin.id } })} aria-pressed={selected === skin.id}>
    <span className="skin-swatches">{[skin.primary, skin.accent, skin.bg].map((color) => <i style={{ background: color }} key={color} />)}</span>
    <span className="track-copy"><strong>{skin.name}</strong><span>@{skin.author}</span></span>
    {selected === skin.id && <Icon name="check" size={16} />}
  </button>)}</div>;
}
