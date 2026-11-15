import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RuntimeProvider } from '../app/context';
import type { AppRuntime, RuntimeState } from '../app/actions';
import type { OToolsAPI } from '../bridge/otools';
import { setLocale } from '../i18n';
import { useStore } from '../state/store';
import { TopBar } from './TopBar';

const initial = useStore.getState();
const state: RuntimeState = { loading: false, ready: true, error: null, owner: null,
  lyrics: { lines: [], source: 'none' }, updatedAt: 0, route: 'panel' };
const runtime: AppRuntime = {
  command() {}, action() {}, patchUi() {}, importFiles: async () => {}, importFolder: async () => {},
  importPaths() {}, openWindow: async () => {}, getState: () => state, subscribe: () => () => {},
  getFrame: () => ({ bands: new Float32Array(56), wave: new Float32Array(256), level: 0, beat: 0 }),
  position: () => 0, clearError() {}, start: async () => {}, dispose() {},
};
const renderBar = (route: 'panel' | 'main' = 'panel') => render(
  <RuntimeProvider runtime={runtime}><TopBar mode="spectrum" route={route} /></RuntimeProvider>,
);

beforeEach(() => { useStore.setState(initial, true); setLocale('zh-CN'); });
afterEach(() => { cleanup(); delete window.otools; delete window.utools; vi.restoreAllMocks(); });

describe('宿主页模式控制顶栏品牌', () => {
  it('实际pageMode为panel时隐藏logo和名称，保留播放及面板入口', () => {
    window.otools = { pageMode: () => 'panel' } as OToolsAPI;
    const view = renderBar('main');
    expect(view.container.querySelector('.brand')).toBeNull();
    expect(screen.queryByText('悠悠乐听')).toBeNull();
    expect(screen.getByRole('button', { name: '播放列表' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '均衡器' })).toBeTruthy();
  });

  it.each(['tabs', 'window'] as const)('实际pageMode为%s时保留品牌，即使本地route为panel', (mode) => {
    window.otools = { pageMode: () => mode } as OToolsAPI;
    const view = renderBar('panel');
    expect(view.container.querySelector('.brand img')).not.toBeNull();
    expect(screen.getByText('悠悠乐听')).toBeTruthy();
  });

  it('utools兼容接口返回panel也隐藏品牌', () => {
    window.utools = { pageMode: () => 'panel' } as OToolsAPI;
    expect(renderBar().container.querySelector('.brand')).toBeNull();
  });

  it('旧宿主没有pageMode时保留原品牌', () => {
    window.otools = {} as OToolsAPI;
    expect(renderBar().container.querySelector('.brand img')).not.toBeNull();
  });

  it('pageMode读取失败时不导致顶栏崩溃', () => {
    window.otools = { getPluginLocalState: async () => null, pageMode: () => { throw new Error('unavailable'); } };
    expect(renderBar().container.querySelector('.brand img')).not.toBeNull();
  });
});
