import { createRoot } from 'react-dom/client';
import { routeFromLocation } from './route';
import { createRuntime } from './app/runtime';
import { RuntimeProvider } from './app/context';
import { AppLayout } from './ui/AppLayout';
import { LyricsWindow } from './windows/desktop-lyrics/LyricsWindow';
import { applySkin, SKINS } from './theme/skins';
import { applyTokens } from './theme/tokens';
import { markCustomWindowReady } from './windows/native';
import './ui/styles.css';

const route = routeFromLocation(window.location.search);
if (route === 'lyrics') document.documentElement.dataset.lyricsWindow = 'true';
applySkin(SKINS[0]);
applyTokens();
const runtime = createRuntime({ route });
createRoot(document.getElementById('root')!).render(<RuntimeProvider runtime={runtime}>
  {route === 'lyrics' ? <LyricsWindow /> : <AppLayout route={route} />}
</RuntimeProvider>);
void runtime.start().then(() => markCustomWindowReady(true)).catch(console.error);
window.addEventListener('pagehide', runtime.dispose, { once: true });
