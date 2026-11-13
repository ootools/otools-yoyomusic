import { useStore } from '../../state/store';
import { useRuntime } from '../../app/context';
import { EQ_FREQS, EQ_PRESETS, type EqPresetName } from '../../audio/eq';
import { t } from '../../i18n';

export function EQPanel() {
  const playback = useStore((s) => s.playback);
  const runtime = useRuntime();
  return <div className="eq-panel">
    <label className="switch-row"><span>{t('common.enabled')}</span><input type="checkbox" role="switch" checked={playback.eqEnabled}
      onChange={(event) => runtime.action({ type: 'eq', enabled: event.target.checked })} /></label>
    <div className="eq-presets">{(Object.keys(EQ_PRESETS) as EqPresetName[]).map((name) => <button type="button" key={name}
      className={playback.eqEnabled && EQ_PRESETS[name].every((value, index) => value === playback.eqBands[index]) ? 'is-active' : ''}
      onClick={() => runtime.action({ type: 'eq', enabled: true, bands: [...EQ_PRESETS[name]] })}>{t(`eq.preset.${name}`)}</button>)}</div>
    <div className="panel-divider" />
    {EQ_FREQS.map((frequency, index) => <label className="eq-band" key={frequency}>
      <span>{frequency >= 1000 ? `${frequency / 1000}k` : frequency}</span>
      <input type="range" min={-12} max={12} step={0.5} aria-label={`${frequency} Hz`} value={playback.eqBands[index] ?? 0}
        onChange={(event) => { const bands = [...playback.eqBands]; bands[index] = Number(event.target.value); runtime.action({ type: 'eq', enabled: playback.eqEnabled, bands }); }} />
      <output>{playback.eqBands[index] > 0 ? '+' : ''}{(playback.eqBands[index] ?? 0).toFixed(1)}</output>
    </label>)}
  </div>;
}
