import { useState } from 'react';
import { useStore } from '../state/store';
import { useRuntime } from '../app/context';
import { pageMode } from '../bridge/otools';
import { VIZ_MODES, VIZ_HINTS, type VizMode } from '../viz/registry';
import { t, useLocale } from '../i18n';
import { IconButton } from './IconButton';
import { Menu } from './Menu';
import { nativeWindowCommand } from '../windows/native';

export function TopBar({ mode, route }: { mode: VizMode; route: 'panel' | 'main' }) {
  useLocale();
  const ui = useStore((s) => s.ui);
  const settings = useStore((s) => s.settings);
  const runtime = useRuntime();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return <header className="top-bar" onPointerDown={(event) => {
    if (route === 'main' && event.button === 0 && !(event.target as HTMLElement).closest('button,input')) void nativeWindowCommand('start_dragging');
  }}>
    {pageMode() !== 'panel' && <div className="brand"><img src={new URL('../../../logo.svg', import.meta.url).href} alt="" /><strong>{t('app.name')}</strong></div>}
    <IconButton icon="playlist" label={t('top.library')} active={ui.libraryOpen} onClick={() => runtime.patchUi({ libraryOpen: !ui.libraryOpen })} />
    <div className="top-spacer" />
    <button className="viz-picker" title={`${t(`viz.${mode}`)} · ${VIZ_HINTS[mode]}`} aria-label={t('top.viz')}
      onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.bottom + 5 }); }}>
      <IconButtonContent mode={mode} /><span>{t(`viz.${mode}`)}</span><small>⌄</small>
    </button>
    <div className="top-spacer" />
    <div className="panel-buttons">
      {(['eq', 'lyrics', 'skins', 'about'] as const).map((panel) => <IconButton key={panel} icon={panel} label={t(`panel.${panel}`)} active={ui.sidePanel === panel}
        onClick={() => runtime.patchUi({ sidePanel: ui.sidePanel === panel ? null : panel })} />)}
      <span className="toolbar-divider" />
      <IconButton icon="window" label={t('top.main')} onClick={() => { void runtime.openWindow('yoyomusic-main'); }} />
    </div>
    {route === 'main' && <div className="window-controls">
      <IconButton icon="minus" label={t('window.minimize')} onClick={() => { void nativeWindowCommand('minimize'); }} />
      <IconButton icon="maximize" label={t('window.maximize')} onClick={() => { void nativeWindowCommand('toggle_maximize'); }} />
      <IconButton icon="close" label={t('common.close')} className="close-window" onClick={() => {
        void (async () => { await runtime.shutdown?.(); await nativeWindowCommand('close'); })().catch(console.error);
      }} />
    </div>}
    {menu && <Menu {...menu} onClose={() => setMenu(null)} items={[
      ...VIZ_MODES.map((value) => ({ label: t(`viz.${value}`), checked: mode === value, onPick: () => runtime.action({ type: 'settings', patch: { vizMode: value } }) })),
      { label: t('viz.random'), checked: settings.vizRandom, onPick: () => runtime.action({ type: 'settings', patch: { vizRandom: !settings.vizRandom } }) },
    ]} />}
  </header>;
}
import { Icon } from './icons';
function IconButtonContent({ mode }: { mode: VizMode }) { return <Icon name={`viz-${mode}`} size={18} />; }
