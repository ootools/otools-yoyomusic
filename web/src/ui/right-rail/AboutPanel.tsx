import { useStore } from '../../state/store';
import { useRuntime } from '../../app/context';
import { t, currentLocale, setLocale } from '../../i18n';
import { detectHost } from '../../bridge/otools';

export function AboutPanel() {
  const settings = useStore((s) => s.settings);
  const runtime = useRuntime();
  return <div className="about-panel"><img className="about-logo" src={new URL('../../../../logo.svg', import.meta.url).href} alt="" />
    <h2>{t('app.name')}</h2><p className="muted">{t('app.tagline')}</p><p>{t('about.info')}</p>
    <div className="panel-divider" /><p className="muted">{t('about.features')}</p><p>{t('about.version')} <strong>0.1.1</strong></p>
    <label className="switch-row"><span>{t('about.restore')}</span><input type="checkbox" role="switch" checked={settings.restoreSession}
      onChange={(event) => runtime.action({ type: 'settings', patch: { restoreSession: event.target.checked } })} /></label>
    <label className="switch-row"><span>{t('about.language')}</span><select value={currentLocale()} onChange={(event) => {
      const lang = event.target.value as 'zh-CN' | 'en-US'; setLocale(lang); runtime.action({ type: 'settings', patch: { lang } });
    }}><option value="zh-CN">简体中文</option><option value="en-US">English</option></select></label>
    {!detectHost().host && <p className="browser-note">{t('about.browser')}</p>}
    <small className="muted">YoYoMusic · AGPL-3.0-or-later<br />OTools plugin · by xyito</small>
    <p><a href="LICENSE" target="_blank" rel="noreferrer">License</a> · <a href="THIRD_PARTY_NOTICES.md" target="_blank" rel="noreferrer">Third-party notices / source</a></p>
  </div>;
}
