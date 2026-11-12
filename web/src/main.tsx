import { createRoot } from 'react-dom/client';
import { routeFromLocation } from './route';

/**
 * Task 1 占位页：证明三路由活着。宿主桥（window.otools 能力探测）在 Task 2 接入。
 */
const PLACEHOLDER: Record<string, string> = {
  panel: '悠悠乐听 · 面板页（占位，Task 11 起装配全功能 UI）',
  main: '悠悠乐听 · 主窗口页（占位）',
  lyrics: '悠悠乐听 · 桌面歌词页（占位）',
};

function App() {
  const route = routeFromLocation(window.location.search);
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      <p data-route={route} style={{ fontSize: 14, opacity: 0.8 }}>
        {PLACEHOLDER[route]}
      </p>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
