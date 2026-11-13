import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { Menu } from './Menu';
import { useIdleFold } from './useIdleFold';

// Vitest默认置空CSS导入；加载实际文件让jsdom验证菜单的计算样式。
const { readFileSync } = await vi.importActual<{ readFileSync(path: string, encoding: 'utf8'): string }>('node:fs');
const styles = readFileSync(`${(import.meta as ImportMeta & { dirname: string }).dirname}/styles.css`, 'utf8');
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('菜单和面板折叠', () => {
  it('菜单选择子项目，Esc关闭，disabled不执行', () => {
    let picked = '';
    const close = vi.fn();
    render(<Menu x={20} y={30} onClose={close} items={[
      { label: 'disabled', disabled: true, onPick: () => { picked = 'bad'; } },
      { label: '歌单', children: [{ label: '旅行', onPick: () => { picked = 'trip'; } }] },
    ]} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'disabled' }));
    expect(picked).toBe('');
    fireEvent.click(screen.getByRole('menuitem', { name: /歌单/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: '旅行' }));
    expect(picked).toBe('trip');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(close).toHaveBeenCalled();
  });
  it('菜单更换onClose后保留第二项键盘焦点并使用最新回调', () => {
    let closed = '';
    const items = [{ label: '第一项' }, { label: '第二项' }];
    const view = render(<Menu x={20} y={30} items={items} onClose={() => { closed = 'old'; }} />);
    const second = screen.getByRole('menuitem', { name: '第二项' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(second);
    view.rerender(<Menu x={20} y={30} items={[...items]} onClose={() => { closed = 'new'; }} />);
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closed).toBe('new');
    closed = '';
    fireEvent.pointerDown(document.body);
    expect(closed).toBe('new');
  });
  it('30个歌单的菜单可滚动并键盘选中底部删除项', () => {
    let picked = '';
    render(<><style>{styles}</style><Menu x={20} y={30} onClose={() => {}} items={[
      ...Array.from({ length: 30 }, (_, index) => ({ label: `歌单${index + 1}` })),
      { label: '新建歌单' }, { label: '重命名歌单' },
      { label: '删除歌单', danger: true, onPick: () => { picked = 'delete'; } },
    ]} /></>);
    const menu = screen.getByRole('menu');
    expect(window.getComputedStyle(menu).overflowY).toBe('auto');
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    const last = screen.getByRole('menuitem', { name: '删除歌单' });
    expect(document.activeElement).toBe(last);
    fireEvent.click(last);
    expect(picked).toBe('delete');
  });
  it('长子菜单独立挂body并限位，pointerdown后末项仍可选择', () => {
    let picked = '';
    let closed = false;
    vi.stubGlobal('innerWidth', 320);
    vi.stubGlobal('innerHeight', 240);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('menu-submenu')) return { width: 150, height: 180 } as DOMRect;
      if (this.classList.contains('menu')) return { width: 180, height: 160 } as DOMRect;
      return { left: 140, right: 312, top: 210, bottom: 238, width: 172, height: 28 } as DOMRect;
    });
    render(<><style>{styles}</style><Menu x={300} y={210} onClose={() => { closed = true; }} items={[
      { label: '添加到歌单', children: Array.from({ length: 30 }, (_, index) => ({
        label: `旅行${index + 1}`, onPick: () => { picked = `旅行${index + 1}`; },
      })) },
    ]} /></>);
    fireEvent.click(screen.getByRole('menuitem', { name: /添加到歌单/ }));
    const last = screen.getByRole('menuitem', { name: '旅行30' });
    const submenu = last.closest('[role="menu"]') as HTMLElement;
    expect(submenu.parentElement).toBe(document.body);
    expect(window.getComputedStyle(submenu).position).toBe('fixed');
    expect(window.getComputedStyle(submenu).overflowY).toBe('auto');
    expect(submenu.style.left).toBe('162px');
    expect(submenu.style.top).toBe('52px');
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(last);
    fireEvent.pointerDown(last);
    expect(closed).toBe(false);
    fireEvent.click(last);
    expect(picked).toBe('旅行30');
    expect(closed).toBe(true);
  });
  it('操作弹出菜单时曲库不会在3秒后自动收起', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useIdleFold({ idleMs: 10000, leaveMs: 3000, pinned: false }));
    const menu = render(<Menu x={20} y={30} onClose={() => {}} items={[{ label: '选歌单', onPick: () => {} }]} />);
    act(() => result.current.notifyLeave());
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.folded).toBe(false);
    menu.unmount();
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.folded).toBe(true);
  });
  it.each(['left-rail', 'right-rail'])('%s面板输入编辑3秒仍展开，blur后3秒折叠', (rail) => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useIdleFold({ idleMs: 10000, leaveMs: 3000, pinned: false }));
    render(<aside className={rail}><input aria-label="编辑歌单" defaultValue="旅行" /></aside>);
    const input = screen.getByRole('textbox', { name: '编辑歌单' }) as HTMLInputElement;
    act(() => input.focus());
    fireEvent.change(input, { target: { value: '夜行草稿' } });
    act(() => result.current.notifyLeave());
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.folded).toBe(false);
    expect(input.value).toBe('夜行草稿');
    act(() => input.blur());
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.folded).toBe(true);
  });
  it('面板contenteditable编辑受保护，面板外输入不阻止折叠', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useIdleFold({ idleMs: 10000, leaveMs: 3000, pinned: false }));
    render(<><aside className="right-rail"><div contentEditable tabIndex={0} aria-label="编辑歌词" /></aside>
      <input aria-label="面板外输入" /></>);
    const editor = screen.getByLabelText('编辑歌词');
    act(() => editor.focus());
    act(() => result.current.notifyLeave());
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.folded).toBe(false);
    act(() => screen.getByRole('textbox', { name: '面板外输入' }).focus());
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.folded).toBe(true);
  });
  it('离开3秒折叠，固定时不折叠', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ pinned }) => useIdleFold({ idleMs: 10000, leaveMs: 3000, pinned }), { initialProps: { pinned: false } });
    act(() => result.current.notifyLeave());
    act(() => vi.advanceTimersByTime(2999));
    expect(result.current.folded).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.folded).toBe(true);
    rerender({ pinned: true });
    act(() => result.current.notifyLeave());
    act(() => vi.advanceTimersByTime(20000));
    expect(result.current.folded).toBe(false);
  });
});
