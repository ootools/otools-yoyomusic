import { useEffect, useRef, useState, type ButtonHTMLAttributes } from 'react';
import { Icon } from './icons';
import { Tooltip } from './Tooltip';

export function IconButton({ icon, label, active = false, size = 32, radius = 8, className = '', ...props }: {
  icon: string; label: string; active?: boolean; size?: number; radius?: number;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; setTip(null); };
  const reveal = (button: HTMLButtonElement) => {
    if (timer.current) clearTimeout(timer.current);
    const rect = button.getBoundingClientRect();
    timer.current = setTimeout(() => setTip({ x: rect.left + rect.width / 2, y: rect.bottom + 7 }), 300);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return <>
    <button type="button" {...props} aria-label={label} aria-pressed={active}
      className={`icon-button ${active ? 'is-active' : ''} ${className}`}
      onMouseEnter={(event) => { reveal(event.currentTarget); props.onMouseEnter?.(event); }}
      onMouseLeave={(event) => { clear(); props.onMouseLeave?.(event); }}
      onFocus={(event) => { reveal(event.currentTarget); props.onFocus?.(event); }}
      onBlur={(event) => { clear(); props.onBlur?.(event); }}
      onClick={(event) => { clear(); props.onClick?.(event); }}
      style={{ width: size, height: size, borderRadius: radius, ...props.style }}><Icon name={icon} /></button>
    {tip && <Tooltip text={label} {...tip} />}
  </>;
}
