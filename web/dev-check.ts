// 独立本地验收夹具：不进入默认入口/生产包，不宣称是真实OTools宿主。
import './src/bridge/otools';
import { createRuntime } from './src/app/runtime';
import { RuntimeProvider } from './src/app/context';
import { AppLayout } from './src/ui/AppLayout';
import { LyricsWindow } from './src/windows/desktop-lyrics/LyricsWindow';
import { routeFromLocation } from './src/route';
import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import './src/ui/styles.css';

function wave(tone: number, seconds = 45): Uint8Array {
  const rate = 22050;
  const count = rate * seconds;
  const bytes = new Uint8Array(44 + count * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i); };
  text(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) view.setInt16(44 + i * 2, Math.sin(i / rate * Math.PI * 2 * tone) * (0.55 + 0.45 * Math.sin(i / rate * 8)) * 1200, true);
  return bytes;
}
const files = new Map([
  ['D:/YoYoCheck/晨光.wav', wave(220)],
  ['D:/YoYoCheck/晚风.wav', wave(440)],
]);
const directory = 'D:/YoYoCheck';
const entries = [...files].map(([path, bytes]) => ({ path, name: path.split('/').pop()!, kind: 'file', size: bytes.length, mime: 'audio/wav' }));
window.otools = {
  listHostDir: async () => entries,
  browseHostDir: async () => ({ currentPath: directory, parentPath: 'D:/', roots: [{ name: '验收音乐', path: directory }], entries }),
  readHostFile: async (path: string) => {
    if (path.toLowerCase().endsWith('.lrc')) return { dataBase64: btoa(String.fromCharCode(...new TextEncoder().encode('[00:00]本地音乐，随声而动\n[00:05]桌面歌词逐行同步\n[00:12]十段均衡器与九种可视化\n[00:22]音乐保持原路径，不上传\n[00:35]悠悠乐听，OTools 独立插件'))) };
    const bytes = files.get(path); if (!bytes) throw new Error('not found');
    let binary = ''; for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
    return { dataBase64: btoa(binary) };
  },
  getPluginLocalState: async () => JSON.parse(localStorage.getItem('yoyomusic.dev-check') || 'null'),
  patchPluginLocalState: async (_plugin, patch) => {
    const existing = JSON.parse(localStorage.getItem('yoyomusic.dev-check') || '{}');
    localStorage.setItem('yoyomusic.dev-check', JSON.stringify({ ...existing, ...patch }));
  },
};
const route = routeFromLocation(location.search);
const runtime = createRuntime({ route });
createRoot(document.getElementById('root')!).render(createElement(RuntimeProvider, { runtime,
  children: route === 'lyrics' ? createElement(LyricsWindow) : createElement(AppLayout, { route }),
}));
void runtime.start();
window.addEventListener('pagehide', runtime.dispose, { once: true });
