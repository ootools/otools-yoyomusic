import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { pickFromHostTree, type HostBrowsePayload } from './host-file-tree';

const payload: HostBrowsePayload = {
  currentPath: 'D:/Music',
  parentPath: 'D:/',
  roots: [{ name: 'D:', path: 'D:/' }],
  entries: [
    { name: 'Album', path: 'D:/Music/Album', kind: 'directory', size: 0, mime: '' },
    { name: 'one.mp3', path: 'D:/Music/one.mp3', kind: 'file', size: 30, mime: 'audio/mpeg' },
    { name: 'two.FLAC', path: 'D:/Music/two.FLAC', kind: 'file', size: 50, mime: 'audio/flac' },
    { name: 'cover.png', path: 'D:/Music/cover.png', kind: 'file', size: 10, mime: 'image/png' },
  ],
};
const filters = [{ name: 'Audio', extensions: ['mp3', 'flac'] }];

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('宿主自绘文件树', () => {
  it('多选过滤后的音乐并返回真实路径，不把目录当成文件', async () => {
    const result = pickFromHostTree({ multiple: true, filters }, async () => payload);
    await screen.findByRole('button', { name: 'one.mp3' });
    expect(screen.queryByText('cover.png')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'one.mp3' }));
    fireEvent.click(screen.getByRole('button', { name: 'two.FLAC' }));
    fireEvent.click(screen.getByRole('button', { name: /选择 \(2\)/ }));
    await expect(result).resolves.toEqual({
      kind: 'picked', source: 'host-tree',
      paths: ['D:/Music/one.mp3', 'D:/Music/two.FLAC'], names: ['one.mp3', 'two.FLAC'],
    });
    expect(document.querySelector('[data-host-tree]')).toBeNull();
  });

  it('目录模式可进入子目录再选择当前目录', async () => {
    const browse = async (path?: string) => path === 'D:/Music/Album'
      ? { ...payload, currentPath: path, parentPath: 'D:/Music', entries: [] }
      : payload;
    const result = pickFromHostTree({ directory: true }, browse);
    fireEvent.click(await screen.findByRole('button', { name: 'Album' }));
    await waitFor(() => expect((screen.getByLabelText('目录路径') as HTMLInputElement).value).toBe('D:/Music/Album'));
    fireEvent.click(screen.getByRole('button', { name: '选择此目录' }));
    await expect(result).resolves.toMatchObject({ paths: ['D:/Music/Album'], kind: 'picked' });
  });

  it('Esc 取消并恢复焦点', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const result = pickFromHostTree({}, async () => payload);
    await screen.findByRole('button', { name: 'one.mp3' });
    fireEvent.keyDown(window, { key: 'Escape' });
    await expect(result).resolves.toMatchObject({ kind: 'cancelled', paths: [] });
    expect(document.activeElement).toBe(trigger);
  });

  it('读取失败显示错误且可取消，不确认空路径', async () => {
    const result = pickFromHostTree({ directory: true }, async () => { throw new Error('Access denied'); });
    await screen.findByRole('alert');
    expect((screen.getByRole('button', { name: '选择此目录' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await expect(result).resolves.toMatchObject({ kind: 'cancelled' });
  });

  it('全选只包含当前可见音乐，第二次点击取消全选', async () => {
    const result = pickFromHostTree({ multiple: true, filters }, async () => payload);
    await screen.findByRole('button', { name: 'one.mp3' });
    fireEvent.click(screen.getByRole('button', { name: '全选' }));
    expect(screen.getByRole('button', { name: /选择 \(2\)/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消全选' }));
    expect((screen.getByRole('button', { name: '选择' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await result;
  });

  it('迟到的目录响应不能覆盖新导航结果', async () => {
    let release!: (value: HostBrowsePayload) => void;
    const slow = new Promise<HostBrowsePayload>((resolve) => { release = resolve; });
    const browse = async (path?: string) => path === 'D:/slow' ? slow : { ...payload, currentPath: path || 'D:/Music' };
    const result = pickFromHostTree({}, browse);
    await screen.findByRole('button', { name: 'one.mp3' });
    const input = screen.getByLabelText('目录路径');
    fireEvent.change(input, { target: { value: 'D:/slow' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'D:/fast' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect((input as HTMLInputElement).value).toBe('D:/fast'));
    release({ ...payload, currentPath: 'D:/slow' });
    await Promise.resolve();
    expect((input as HTMLInputElement).value).toBe('D:/fast');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await result;
  });
});
