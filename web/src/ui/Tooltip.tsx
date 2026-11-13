import { createPortal } from 'react-dom';

export function Tooltip({ text, x, y }: { text: string; x: number; y: number }) {
  const width = Math.min(320, text.length * 12 + 20);
  const left = Math.max(8, Math.min(x - width / 2, window.innerWidth - width - 8));
  return createPortal(<div className="tooltip" role="tooltip" style={{ left, top: Math.max(8, Math.min(y, window.innerHeight - 35)), maxWidth: width }}>{text}</div>, document.body);
}
