import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { useRuntime, useRuntimeState } from '../app/context';
import { getSkin, SKINS, applySkin } from '../theme/skins';
import { applyTokens } from '../theme/tokens';
import { syncTempHostThemeBackground } from '../bridge/host-theme';
import { setLocale, t, useLocale } from '../i18n';
import { Visualizer } from '../viz/Visualizer';
import type { VizMode } from '../viz/registry';
import { TopBar } from './TopBar';
import { Transport } from './transport/Transport';
import { LeftRail } from './left-rail/LeftRail';
import { RightRail } from './right-rail/RightRail';
import { useIdleFold } from './useIdleFold';
import { IconButton } from './IconButton';

export function AppLayout({ route }: { route: 'panel' | 'main' }) {
  useLocale();
  const runtime = useRuntime();
  const status = useRuntimeState();
  const settings = useStore((state) => state.settings);
  const ui = useStore((state) => state.ui);
  const playing = useStore((state) => state.playback.playing);
  const skin = getSkin(settings.skin) ?? SKINS[0];
  const [liveMode, setLiveMode] = useState<VizMode>(settings.vizMode);
  const left = useIdleFold({ idleMs: 10000, leaveMs: 3000, pinned: ui.libraryPinned, sticky: status.picking });
  const right = useIdleFold({ idleMs: 10000, leaveMs: 10000, pinned: ui.panelsPinned, sticky: ui.sidePanel === 'lyrics' });
  useEffect(() => { applySkin(skin); applyTokens(); syncTempHostThemeBackground(skin.bg); }, [skin]);
  useEffect(() => { setLocale(settings.lang); }, [settings.lang]);
  useEffect(() => { setLiveMode(settings.vizMode); }, [settings.vizMode]);
  useEffect(() => { if (ui.libraryOpen) left.notifyEnter(); }, [ui.libraryOpen]);
  useEffect(() => { if (ui.sidePanel) right.notifyActivity(); }, [ui.sidePanel]);
  useEffect(() => {
    const space = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
      if ((event.target as HTMLElement)?.closest('input,textarea,select,button,[contenteditable], [role="dialog"],[role="menu"]')) return;
      if (document.querySelector('[data-host-tree],[role="dialog"]')) return;
      event.preventDefault(); runtime.command({ op: 'toggle' });
    };
    window.addEventListener('keydown', space);
    return () => window.removeEventListener('keydown', space);
  }, [runtime]);
  return <div className="player-layout" data-route={route} data-skin={settings.skin}
    onPointerMove={() => { if (ui.sidePanel) right.notifyActivity(); }}>
    <div className="ambient-backdrop" aria-hidden="true"><i /><i /><i /></div>
    <div className="visualizer-backdrop"><Visualizer getFrame={runtime.getFrame} palette={{ a: skin.vizA, b: skin.vizB, ink: skin.vizInk }} onModeChange={setLiveMode} /></div>
    <div className="chrome-layer"><TopBar route={route} mode={liveMode} /><div className="chrome-spacer" /><Transport /></div>
    {ui.libraryOpen && !left.folded && <aside className="left-rail glass-panel" aria-label={t('top.library')}
      onPointerEnter={left.notifyEnter} onPointerLeave={left.notifyLeave}><LeftRail /></aside>}
    {ui.libraryOpen && left.folded && <button className="rail-reveal" aria-label={t('top.library')} onPointerEnter={left.notifyEnter} onClick={left.notifyEnter} />}
    {ui.sidePanel && !right.folded && <aside className="right-rail glass-panel" aria-label={t(`panel.${ui.sidePanel}`)}><RightRail /></aside>}
    <div className="viz-status" aria-hidden="true"><span className={playing ? 'status-dot live' : 'status-dot'} />{playing ? t('viz.live') : 'YOYO MUSIC'}<span className="viz-status-line" />{t(`viz.${liveMode}`)}</div>
    {status.error && <div className="error-toast" role="alert"><span>{status.error}</span><IconButton icon="close" label={t('common.close')} size={26} onClick={runtime.clearError} /></div>}
  </div>;
}
