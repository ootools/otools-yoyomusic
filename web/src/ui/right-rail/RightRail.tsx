import { useStore } from '../../state/store';
import { useRuntime } from '../../app/context';
import { t, useLocale } from '../../i18n';
import { IconButton } from '../IconButton';
import { EQPanel } from './EQPanel';
import { LyricsPanel } from './LyricsPanel';
import { SkinsPanel } from './SkinsPanel';
import { AboutPanel } from './AboutPanel';

export function RightRail() {
  useLocale();
  const panel = useStore((s) => s.ui.sidePanel);
  const runtime = useRuntime();
  if (!panel) return null;
  return <div className="right-rail-content"><div className="panel-heading"><strong>{t(`panel.${panel}`)}</strong>
    <IconButton icon="close" label={t('common.close')} size={26} radius={6} onClick={() => runtime.patchUi({ sidePanel: null })} /></div>
    <div className="feature-scroll">{panel === 'eq' ? <EQPanel /> : panel === 'lyrics' ? <LyricsPanel /> : panel === 'skins' ? <SkinsPanel /> : <AboutPanel />}</div>
  </div>;
}
