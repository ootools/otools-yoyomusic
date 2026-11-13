import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IconButton } from './IconButton';

afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('图标按钮提示', () => {
  it('悬停延迟后显示自绘提示，离开即消失且不遮挡按钮', () => {
    vi.useFakeTimers();
    render(<IconButton icon="play" label="播放音乐" />);
    const button = screen.getByRole('button', { name: '播放音乐' });
    fireEvent.mouseEnter(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => vi.advanceTimersByTime(300));
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toBe('播放音乐');
    expect(tip.closest('button')).toBeNull();
    fireEvent.mouseLeave(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
