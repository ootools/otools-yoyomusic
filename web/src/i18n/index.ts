import { messages as zh } from './zh-CN';
import { messages as en } from './en-US';
import { useSyncExternalStore } from 'react';

export type Locale = 'zh-CN' | 'en-US';
const normalize = (value: string): Locale => /^zh/i.test(value) ? 'zh-CN' : 'en-US';
const initial = (): Locale => {
  const injected = typeof window !== 'undefined' ? window.__OTOOLS_LOCALE__?.locale : undefined;
  const value = injected || (typeof navigator !== 'undefined' ? navigator?.language : '');
  return value ? normalize(value) : 'zh-CN';
};
let locale = initial();
const listeners = new Set<(value: Locale) => void>();
let listening = false;

function hostChanged(event: Event): void {
  const value = (event as CustomEvent<{ locale?: string }>).detail?.locale;
  if (value) setLocale(normalize(value));
}
export function currentLocale(): Locale { return locale; }
export function setLocale(value: Locale): void {
  if (locale === value) return;
  locale = value;
  for (const listener of [...listeners]) listener(locale);
}
export function t(key: string, vars: Record<string, string | number> = {}): string {
  const text = (locale === 'en-US' ? en[key] : zh[key]) ?? zh[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => vars[name] === undefined ? placeholder : String(vars[name]));
}
export function onLocaleChange(callback: (value: Locale) => void): () => void {
  listeners.add(callback);
  if (!listening && typeof window !== 'undefined') {
    window.addEventListener('otools-locale-changed', hostChanged);
    listening = true;
  }
  callback(locale);
  return () => {
    listeners.delete(callback);
    if (!listeners.size && listening) {
      window.removeEventListener('otools-locale-changed', hostChanged);
      listening = false;
    }
  };
}
const subscribe = (notify: () => void): (() => void) => onLocaleChange(notify);
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, currentLocale, currentLocale);
}
