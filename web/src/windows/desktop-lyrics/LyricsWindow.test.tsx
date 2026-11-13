import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createPlayerStore, useStore } from '../../state/store';
import { RuntimeProvider } from '../../app/context';
import type { AppRuntime, RuntimeState } from '../../app/actions';
import { applyDataAction } from '../../app/data';
import { LyricsWindow, clampFontScale, nextColorIdx } from './LyricsWindow';
import { setLocale } from '../../i18n';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const state: RuntimeState = { loading: false, ready: true, error: null, owner: 'main', route: 'lyrics', updatedAt: 0,
  lyrics: { source: 'sidecar', lines: [{ timeMs: 0, text: '当前歌词' }, { timeMs: 5000, text: '下一句' }] } };
const runtime: AppRuntime = { command() {}, action: (action) => applyDataAction(useStore, action), patchUi() {}, importFiles: async () => {}, importFolder: async () => {}, importPaths() {}, openWindow: async () => {},
  getState: () => state, subscribe: () => () => {}, getFrame: () => ({ bands: new Float32Array(56), wave: new Float32Array(256), level: 0, beat: 0 }),
  position: () => 0, clearError() {}, start: async () => {}, dispose() {} };

describe('桌面歌词窗口', () => {
  it('显示当前和下一句，五个工具按钮可调色锁定字号', () => {
    useStore.setState(createPlayerStore().getState(), true); setLocale('zh-CN');
    render(<RuntimeProvider runtime={runtime}><LyricsWindow /></RuntimeProvider>);
    expect(screen.getByText('当前歌词')).toBeTruthy();
    expect(screen.getByText('下一句')).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: '切换歌词颜色' }));
    expect(useStore.getState().settings.desktopLyrics.colorIdx).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: '锁定位置' }));
    expect(useStore.getState().settings.desktopLyrics.locked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '放大字号' }));
    expect(useStore.getState().settings.desktopLyrics.fontScale).toBe(1.15);
  });
  it('字号限制0.6..3，颜色五色循环', () => {
    expect(clampFontScale(0.5)).toBe(0.6);
    expect(clampFontScale(3.5)).toBe(3);
    expect(nextColorIdx(4)).toBe(0);
  });
});
