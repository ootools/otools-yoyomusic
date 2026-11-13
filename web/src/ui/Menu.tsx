import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem { label: string; disabled?: boolean; checked?: boolean; danger?: boolean; onPick?: () => void; children?: MenuItem[]; }
function FocusedMenuLayer({ root, x, y, nested = false, children, onScroll }: {
  root: RefObject<HTMLDivElement | null>; x: number; y: number; nested?: boolean; children: ReactNode; onScroll?: () => void;
}) {
  const [position, setPosition] = useState({ x, y });
  useLayoutEffect(() => {
    const rect = root.current?.getBoundingClientRect();
    if (rect) setPosition({ x: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)), y: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) });
    root.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [root, x, y]);
  return createPortal(<div ref={root} className={nested ? 'menu menu-submenu' : 'menu'} role="menu"
    style={{ left: position.x, top: position.y }} onScroll={onScroll}>{children}</div>, document.body);
}
export function Menu({ items, x, y, onClose }: { items: MenuItem[]; x: number; y: number; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const childRoot = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [submenu, setSubmenu] = useState<{ index: number; x: number; y: number } | null>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !childRoot.current?.contains(event.target as Node)) close.current();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const active = childRoot.current?.contains(document.activeElement) ? childRoot.current : root.current;
        const buttons = [...active?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
      }
    };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', key); };
  }, [x, y]);
  const openSubmenu = (index: number, button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect();
    setSubmenu({ index, x: rect.right, y: rect.top });
  };
  const drawItems = (values: MenuItem[], nested = false) => values.map((item, index) => (
    <div className="menu-entry" key={`${item.label}-${index}`}>
      <button type="button" role="menuitem" disabled={item.disabled} aria-haspopup={item.children ? 'menu' : undefined}
        className={item.danger ? 'danger' : ''}
        onMouseEnter={(event) => { if (!nested) { if (item.children) openSubmenu(index, event.currentTarget); else setSubmenu(null); } }}
        onClick={(event) => { if (item.children) { if (!nested) openSubmenu(index, event.currentTarget); } else { item.onPick?.(); close.current(); } }}>
        <span className="menu-check">{item.checked ? '✓' : ''}</span><span>{item.label}</span>{item.children && <span className="menu-chevron">›</span>}
      </button>
    </div>
  ));
  const children = submenu ? items[submenu.index]?.children : undefined;
  return <>
    <FocusedMenuLayer root={root} x={x} y={y} onScroll={() => setSubmenu(null)}>{drawItems(items)}</FocusedMenuLayer>
    {submenu && children && <FocusedMenuLayer root={childRoot} x={submenu.x} y={submenu.y} nested>{drawItems(children, true)}</FocusedMenuLayer>}
  </>;
}
