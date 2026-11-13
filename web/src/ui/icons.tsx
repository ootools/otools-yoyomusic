import type { CSSProperties } from 'react';

// YoYoMusic internal/ui/icons.go，24×24 单色图标；不引入平台 emoji。
const paths: Record<string, string> = {
  play: '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor" stroke="none"/>',
  prev: '<path d="M6 6h2v12H6zm12 0v12l-9-6z" fill="currentColor" stroke="none"/>',
  next: '<path d="M16 6h2v12h-2zM6 6l9 6-9 6z" fill="currentColor" stroke="none"/>',
  'volume-high': '<path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  'volume-mid': '<path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7"/>',
  'volume-low': '<path d="M11 5 6 9H2v6h4l5 4zM16 9.5l5 5M21 9.5l-5 5"/>',
  'volume-mute': '<path d="M11 5 6 9H2v6h4l5 4zM17 9l5 6M22 9l-5 6"/>',
  eq: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><circle cx="4" cy="12" r="2"/><circle cx="12" cy="10" r="2"/><circle cx="20" cy="14" r="2"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 4v4h4M12 8v4l3 2"/>',
  lyrics: '<path d="M12 3v18"/><ellipse cx="7" cy="7" rx="4" ry="3" transform="rotate(-20 7 7)"/><ellipse cx="17" cy="17" rx="4" ry="3" transform="rotate(-20 17 17)"/>',
  skins: '<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="9.5" r="1.4"/><circle cx="15.5" cy="9.5" r="1.4"/><circle cx="12" cy="15" r="1.4"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  playlist: '<path d="M4 6h11M4 12h11M4 18h7M21.6 17V9l-2.6.6"/><circle cx="19" cy="17" r="2.6"/>',
  pin: '<path d="M9 4h6l-1 6 4 3H6l4-3zM12 13v7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>', chevron: '<path d="M6 9l6 6 6-6"/>',
  'chevron-right': '<path d="M9 6l6 6-6 6"/>', back: '<path d="M15 18l-6-6 6-6"/>',
  sequence: '<path d="M3 6h9M3 12h6M3 18h9M16 9l4 3-4 3"/>',
  repeat: '<path d="M17 2l4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3"/>',
  'repeat-one': '<path d="M17 2l4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3M11 11h1.6v4"/>',
  shuffle: '<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>',
  check: '<path d="M4 12.5 9.5 18 20 6.5"/>',
  heart: '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>',
  'viz-spectrum': '<path d="M4 19v-7M9 19V5M14 19v-9M19 19v-4"/>',
  'viz-waveform': '<path d="M2 12c2-7 4-7 6 0s4 7 6 0 4-7 6 0"/>',
  'viz-radial': '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/>',
  'viz-aurora': '<path d="M2 9c3-5 7-5 10 0s7 5 10 0M2 15c3-5 7-5 10 0s7 5 10 0"/>',
  'viz-particles': '<circle cx="6" cy="6" r="1.9"/><circle cx="17" cy="5" r="1.9"/><circle cx="12" cy="13" r="1.9"/><circle cx="6" cy="18" r="1.9"/><circle cx="18" cy="17" r="1.9"/>',
  'viz-waterfall': '<path d="M5 3v18M12 3v18M19 3v18"/>',
  'viz-generative': '<circle cx="6" cy="7" r="1.9"/><circle cx="17" cy="9" r="1.9"/><circle cx="12" cy="17" r="1.9"/><path d="M6 7l11 2M6 7l6 10M17 9l-5 8"/>',
  'viz-kaleidoscope': '<path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
  'viz-piano': '<rect x="3" y="6" width="18" height="13" rx="1.5"/><path d="M7 6v7M11 6v7M15 6v7M19 6v7"/><rect x="6" y="6" width="2.2" height="5" fill="currentColor"/><rect x="10" y="6" width="2.2" height="5" fill="currentColor"/><rect x="14" y="6" width="2.2" height="5" fill="currentColor"/>',
  'lyrics-screen': '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M7 9h7M7 13h5"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1 .9-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-3.9-4-7-9-7z"/><circle cx="7.5" cy="10.5" r="1.2"/><circle cx="12" cy="7.5" r="1.2"/><circle cx="16.5" cy="10.5" r="1.2"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  window: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12"/>',
  maximize: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  album: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  artist: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
};
paths['heart-fill'] = paths.heart;
export function Icon({ name, size = 18, style }: { name: string; size?: number; style?: CSSProperties }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" style={style}
    fill={name === 'heart-fill' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: paths[name] ?? paths.music }} />;
}
