import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closePluginWindows,
  detectHost,
  isCustomWindow,
  listDirectoryRecursive,
  loadPersisted,
  onLocale,
  openPluginWindow,
  pickAudioFiles,
  pickDirectory,
  readFileBytes,
  savePersisted,
  showPanelWindow,
} from './otools';

/* ------------------------------------------------------------------ *
 * installFakeHost：往全局注入/清除伪造宿主（window.otools / utools、
 * __TAURI_INTERNALS__、__OTOOLS_CUSTOM_WINDOW__、__OTOOLS_LOCALE__）。
 * ------------------------------------------------------------------ */

interface FakeHostOptions {
  /** 注入 window.otools（null = 不注入；undefined = 注入空对象） */
  otools?: Record<string, unknown> | null;
  /** 注入 window.utools（仅当未注入 otools 时生效） */
  utools?: Record<string, unknown> | null;
  /** 注入 __TAURI_INTERNALS__.invoke；返回值即 invoke 的 resolve 值 */
  tauriInvoke?: (command: string, payload?: Record<string, unknown>) => unknown;
  /** 注入 __OTOOLS_CUSTOM_WINDOW__ */
  customWindow?: boolean;
  /** 注入 __OTOOLS_LOCALE__.locale */
  locale?: string;
}

interface SavedGlobal {
  value: unknown;
  had: boolean;
}

const savedGlobals = new Map<string, SavedGlobal>();
const STATE_KEY = 'yoyomusic.state.v1';

function saveGlobal(key: string): void {
  if (savedGlobals.has(key)) return;
  savedGlobals.set(key, {
    value: (window as unknown as Record<string, unknown>)[key],
    had: Object.prototype.hasOwnProperty.call(window, key),
  });
}

function restoreGlobals(): void {
  for (const [key, saved] of savedGlobals) {
    const target = window as unknown as Record<string, unknown>;
    if (saved.had) target[key] = saved.value;
    else delete target[key];
  }
  savedGlobals.clear();
  window.localStorage.removeItem(STATE_KEY);
}

/**
 * 注入伪造宿主并返回 tauri invoke 的 spy（便于断言命令名与参数）。
 * 测试结束后由 afterEach 统一恢复全局。
 */
function installFakeHost(options: FakeHostOptions = {}): {
  invoke: ReturnType<typeof vi.fn>;
} {
  saveGlobal('otools');
  saveGlobal('utools');
  saveGlobal('__TAURI_INTERNALS__');
  saveGlobal('__OTOOLS_CUSTOM_WINDOW__');
  saveGlobal('__OTOOLS_LOCALE__');

  const invoke = vi.fn(async (command: string, payload?: Record<string, unknown>) => {
    const impl = options.tauriInvoke;
    if (!impl) return null;
    return await impl(command, payload);
  });

  const target = window as unknown as Record<string, unknown>;
  if (options.otools !== null) {
    target.otools = options.otools ?? {};
  }
  if (options.utools !== null && options.otools === null && options.utools) {
    target.utools = options.utools;
  }
  // 默认总是注入 tauri（真实宿主 webview 同时具备两者）；模拟"纯浏览器"的
  // 测试在 installFakeHost 之后手动 delete __TAURI_INTERNALS__。
  target.__TAURI_INTERNALS__ = { invoke };
  if (options.customWindow) {
    target.__OTOOLS_CUSTOM_WINDOW__ = {
      pluginUuid: 'otools-yoyomusic',
      pluginSource: 'dev-workspace',
      windowId: 'yoyomusic-lyrics',
    };
  }
  if (options.locale) {
    target.__OTOOLS_LOCALE__ = { locale: options.locale };
  }
  return { invoke };
}

afterEach(() => {
  restoreGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.localStorage.clear();
});

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a', 'opus'];

/* ------------------------------------------------------------------ *
 * detectHost
 * ------------------------------------------------------------------ */

describe('detectHost', () => {
  it('全量宿主（otools 各子 API + tauri）→ 五 cap 全 true', () => {
    installFakeHost({
      otools: {
        dialog: { open: async () => null },
        listHostDir: async () => [],
        readHostFile: async () => ({ dataBase64: '' }),
        getPluginLocalState: async () => null,
        patchPluginLocalState: async () => undefined,
      },
    });
    expect(detectHost()).toEqual({
      host: true,
      customWindow: true,
      panelWindow: true,
      hostState: true,
      hostDir: true,
    });
  });

  it('只有 dialog 没有 listHostDir/state → host=true 其余子 cap=false', () => {
    installFakeHost({ otools: { dialog: { open: async () => null } } });
    expect(detectHost()).toEqual({
      host: true,
      customWindow: true,
      panelWindow: true,
      hostState: false,
      hostDir: false,
    });
  });

  it('getPluginLocalState 在但 patchPluginLocalState 缺 → hostState=false', () => {
    installFakeHost({ otools: { getPluginLocalState: async () => null } });
    expect(detectHost().hostState).toBe(false);
  });

  it('window.utools 兜底（无 otools）→ host=true、hostDir 按 utools 子 API 判定', () => {
    installFakeHost({ otools: null, utools: { listHostDir: async () => [] } });
    const caps = detectHost();
    expect(caps.host).toBe(true);
    expect(caps.hostDir).toBe(true);
  });

  it('无 otools 但有 tauri → host=false、窗口 cap=true', () => {
    installFakeHost({ otools: null, utools: null });
    expect(detectHost()).toEqual({
      host: false,
      customWindow: true,
      panelWindow: true,
      hostState: false,
      hostDir: false,
    });
  });

  it('纯浏览器（啥都没有）→ 全 false', () => {
    installFakeHost({ otools: null, utools: null, tauriInvoke: undefined });
    // 上一行默认仍注入 tauri；这里手动清掉模拟纯浏览器
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    expect(detectHost()).toEqual({
      host: false,
      customWindow: false,
      panelWindow: false,
      hostState: false,
      hostDir: false,
    });
  });
});

/* ------------------------------------------------------------------ *
 * readFileBytes
 * ------------------------------------------------------------------ */

describe('readFileBytes', () => {
  it('走 otools.readHostFile：base64 "SGVsbG8=" → [72,101,108,108,111]', async () => {
    const readHostFile = vi.fn(async () => ({ dataBase64: 'SGVsbG8=' }));
    installFakeHost({ otools: { readHostFile } });
    const bytes = await readFileBytes('D:/music/a.mp3');
    expect(Array.from(bytes)).toEqual([72, 101, 108, 108, 111]);
    expect(readHostFile).toHaveBeenCalledWith('D:/music/a.mp3');
  });

  it('无 readHostFile 时走 __TAURI_INTERNALS__.invoke("tools_webview_read_file", {path})', async () => {
    const { invoke } = installFakeHost({
      otools: {},
      tauriInvoke: () => ({ data_base64: 'SGVsbG8=' }), // snake_case 兼容
    });
    const bytes = await readFileBytes('D:/music/a.mp3');
    expect(Array.from(bytes)).toEqual([72, 101, 108, 108, 111]);
    expect(invoke).toHaveBeenCalledWith('tools_webview_read_file', { path: 'D:/music/a.mp3' });
  });

  it('宿主返回 dataBase64 为空字符串（空文件）→ 空 Uint8Array', async () => {
    installFakeHost({ otools: { readHostFile: async () => ({ dataBase64: '' }) } });
    const bytes = await readFileBytes('D:/music/empty.mp3');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(0);
  });

  it('完全无宿主 → reject "no-host"', async () => {
    installFakeHost({ otools: null, utools: null, tauriInvoke: undefined });
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    await expect(readFileBytes('D:/music/a.mp3')).rejects.toThrow('no-host');
  });

  it('有 otools 但既无 readHostFile 也无 tauri → reject "no-host"', async () => {
    installFakeHost({ otools: {}, tauriInvoke: undefined });
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    await expect(readFileBytes('D:/music/a.mp3')).rejects.toThrow('no-host');
  });

  it('宿主响应缺 data 字段 → reject（不把 undefined 当字节）', async () => {
    installFakeHost({ otools: { readHostFile: async () => ({ size: 3 }) } });
    await expect(readFileBytes('D:/music/a.mp3')).rejects.toThrow();
  });
});

/* ------------------------------------------------------------------ *
 * listDirectoryRecursive
 * ------------------------------------------------------------------ */

describe('listDirectoryRecursive', () => {
  function makeDirApi(
    tree: Record<string, Array<{ name: string; path: string; kind: string; size: number }>>,
  ) {
    return {
      listHostDir: vi.fn(async (path: string) => tree[path] ?? []),
    };
  }

  it('递归展开子目录，只列文件并带上 size', async () => {
    const api = makeDirApi({
      'D:/music': [
        { name: 'sub', path: 'D:/music/sub', kind: 'directory', size: 0 },
        { name: 'a.mp3', path: 'D:/music/a.mp3', kind: 'file', size: 111 },
        { name: 'b.flac', path: 'D:/music/b.flac', kind: 'file', size: 222 },
      ],
      'D:/music/sub': [
        { name: 'c.wav', path: 'D:/music/sub/c.wav', kind: 'file', size: 333 },
        { name: 'deeper', path: 'D:/music/sub/deeper', kind: 'directory', size: 0 },
      ],
      'D:/music/sub/deeper': [
        { name: 'd.ogg', path: 'D:/music/sub/deeper/d.ogg', kind: 'file', size: 444 },
      ],
    });
    installFakeHost({ otools: api });
    const files = await listDirectoryRecursive('D:/music');
    expect(files.map((f) => f.path).sort()).toEqual([
      'D:/music/a.mp3',
      'D:/music/b.flac',
      'D:/music/sub/c.wav',
      'D:/music/sub/deeper/d.ogg',
    ]);
    const a = files.find((f) => f.path === 'D:/music/a.mp3');
    expect(a?.size).toBe(111);
    expect(api.listHostDir).toHaveBeenCalledTimes(3);
  });

  it('目录自引用成环 → 不死循环（visited 去重）', async () => {
    const api = makeDirApi({
      'D:/music': [
        { name: 'music', path: 'D:/music', kind: 'directory', size: 0 },
        { name: 'a.mp3', path: 'D:/music/a.mp3', kind: 'file', size: 1 },
      ],
    });
    installFakeHost({ otools: api });
    const files = await listDirectoryRecursive('D:/music');
    expect(files.map((f) => f.path)).toEqual(['D:/music/a.mp3']);
    expect(api.listHostDir).toHaveBeenCalledTimes(1);
  });

  it('嵌套深度超过 8 层 → 截断不再展开', async () => {
    const tree: Record<string, Array<{ name: string; path: string; kind: string; size: number }>> = {};
    for (let i = 0; i < 12; i += 1) {
      tree[`D:/L${i}`] = [
        { name: `L${i + 1}`, path: `D:/L${i + 1}`, kind: 'directory', size: 0 },
      ];
    }
    tree['D:/L12'] = [{ name: 'deep.mp3', path: 'D:/L12/deep.mp3', kind: 'file', size: 1 }];
    const api = makeDirApi(tree);
    installFakeHost({ otools: api });
    const files = await listDirectoryRecursive('D:/L0');
    expect(files).toEqual([]); // 8 层深度上限内到不了 L12 的文件
    expect(api.listHostDir.mock.calls.length).toBeLessThanOrEqual(9);
  });

  it('子目录读取失败 → 跳过该子目录继续其余部分', async () => {
    const listHostDir = vi.fn(async (path: string) => {
      if (path === 'D:/music/bad') throw new Error('boom');
      if (path === 'D:/music') {
        return [
          { name: 'bad', path: 'D:/music/bad', kind: 'directory', size: 0 },
          { name: 'a.mp3', path: 'D:/music/a.mp3', kind: 'file', size: 5 },
        ];
      }
      return [];
    });
    installFakeHost({ otools: { listHostDir } });
    const files = await listDirectoryRecursive('D:/music');
    expect(files.map((f) => f.path)).toEqual(['D:/music/a.mp3']);
  });

  it('根目录 listHostDir 失败 → reject（不吞成空数组，Task 6 授权点）', async () => {
    const listHostDir = vi.fn(async () => {
      throw new Error('access denied');
    });
    installFakeHost({ otools: { listHostDir } });
    await expect(listDirectoryRecursive('D:/locked')).rejects.toThrow('access denied');
  });

  it('根目录返回非数组（宿主异常响应）→ reject', async () => {
    installFakeHost({ otools: { listHostDir: async () => undefined } });
    await expect(listDirectoryRecursive('D:/music')).rejects.toThrow();
  });

  it('无宿主 → reject "no-host"', async () => {
    installFakeHost({ otools: null, utools: null, tauriInvoke: undefined });
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    await expect(listDirectoryRecursive('D:/music')).rejects.toThrow('no-host');
  });
});

/* ------------------------------------------------------------------ *
 * pickAudioFiles / pickDirectory
 * ------------------------------------------------------------------ */

describe('pickAudioFiles', () => {
  it('宿主 dialog.open：multiple + Audio filters，多选结果原样返回', async () => {
    const open = vi.fn(async () => ['D:/a.mp3', 'D:/b.flac']);
    installFakeHost({ otools: { dialog: { open } } });
    const picked = await pickAudioFiles();
    expect(picked).toEqual(['D:/a.mp3', 'D:/b.flac']);
    expect(open).toHaveBeenCalledWith({
      multiple: true,
      filters: [{ name: 'Audio', extensions: AUDIO_EXTENSIONS }],
    });
  });

  it('宿主返回单字符串 → 规范成数组', async () => {
    const open = vi.fn(async () => 'D:/only.mp3');
    installFakeHost({ otools: { dialog: { open } } });
    await expect(pickAudioFiles()).resolves.toEqual(['D:/only.mp3']);
  });

  it('取消（null）→ null', async () => {
    const open = vi.fn(async () => null);
    installFakeHost({ otools: { dialog: { open } } });
    await expect(pickAudioFiles()).resolves.toBeNull();
  });

  it('空数组（dialog 语义：multiple 取消）→ null', async () => {
    const open = vi.fn(async () => []);
    installFakeHost({ otools: { dialog: { open } } });
    await expect(pickAudioFiles()).resolves.toBeNull();
  });

  it('浏览器降级：注入 input[type=file]，change 后返回 blob: 前缀 objectURL', async () => {
    installFakeHost({ otools: null, utools: null });
    const created: string[] = [];
    const fakeUrl = (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = (blob: unknown) => {
      void blob;
      const url = `blob:mock-${created.length}`;
      created.push(url);
      return url;
    };
    try {
      const promise = pickAudioFiles();
      const input = document.body.querySelector('input[type="file"]') as HTMLInputElement | null;
      expect(input).not.toBeNull();
      expect(input!.multiple).toBe(true);
      expect(input!.accept).toBe(AUDIO_EXTENSIONS.map((e) => `.${e}`).join(','));
      Object.defineProperty(input, 'files', {
        value: [new File(['x'], 'a.mp3'), new File(['y'], 'b.wav')],
        configurable: true,
      });
      input!.dispatchEvent(new Event('change', { bubbles: true }));
      const picked = await promise;
      expect(picked).toEqual(['blob:mock-0', 'blob:mock-1']);
      expect(picked?.every((p) => p.startsWith('blob:'))).toBe(true);
    } finally {
      (URL as unknown as { createObjectURL?: unknown }).createObjectURL = fakeUrl;
    }
  });

  it('浏览器降级：cancel 事件 → null', async () => {
    installFakeHost({ otools: null, utools: null });
    const promise = pickAudioFiles();
    const input = document.body.querySelector('input[type="file"]') as HTMLInputElement;
    input.dispatchEvent(new Event('cancel'));
    await expect(promise).resolves.toBeNull();
  });
});

describe('pickDirectory', () => {
  it('宿主 dialog.open({directory:true}) → 返回目录路径', async () => {
    const open = vi.fn(async () => 'D:/music');
    installFakeHost({ otools: { dialog: { open } } });
    await expect(pickDirectory()).resolves.toBe('D:/music');
    expect(open).toHaveBeenCalledWith({ directory: true });
  });

  it('取消 → null', async () => {
    const open = vi.fn(async () => null);
    installFakeHost({ otools: { dialog: { open } } });
    await expect(pickDirectory()).resolves.toBeNull();
  });

  it('浏览器降级不支持选目录 → null', async () => {
    installFakeHost({ otools: null, utools: null });
    await expect(pickDirectory()).resolves.toBeNull();
    expect(document.body.querySelector('input[type="file"]')).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * showPanelWindow / openPluginWindow / closePluginWindows / isCustomWindow
 * ------------------------------------------------------------------ */

describe('showPanelWindow', () => {
  it('有 tauri → invoke("show_panel_window")', async () => {
    const { invoke } = installFakeHost({ otools: {} });
    await expect(showPanelWindow()).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith('show_panel_window');
  });

  it('无宿主 → no-op（不抛异常）', async () => {
    installFakeHost({ otools: null, utools: null, tauriInvoke: undefined });
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    await expect(showPanelWindow()).resolves.toBeUndefined();
  });

  it('宿主命令失败 → 仍然 resolve（恢复面板不能打断导入流程）', async () => {
    installFakeHost({
      otools: {},
      tauriInvoke: () => {
        throw new Error('boom');
      },
    });
    await expect(showPanelWindow()).resolves.toBeUndefined();
  });
});

describe('openPluginWindow', () => {
  it('main：先 list 查重，再 open（1100×720 主窗口规格）', async () => {
    const { invoke } = installFakeHost({ otools: {}, tauriInvoke: () => [] });
    await openPluginWindow('yoyomusic-main');
    expect(invoke).toHaveBeenNthCalledWith(1, 'list_custom_plugin_windows');
    expect(invoke).toHaveBeenNthCalledWith(2, 'open_custom_plugin_window', {
      windowId: 'yoyomusic-main',
      title: '悠悠乐听',
      url: 'index.html?main=1',
      options: {
        width: 1100,
        height: 720,
        decorations: false,
        resizable: true,
        skipTaskbar: false,
        alwaysOnTop: false,
      },
    });
  });

  it('lyrics：880×110 桌面歌词规格（transparent/alwaysOnTop/skipTaskbar/shadow:false）', async () => {
    const { invoke } = installFakeHost({ otools: {}, tauriInvoke: () => [] });
    await openPluginWindow('yoyomusic-lyrics');
    expect(invoke).toHaveBeenNthCalledWith(2, 'open_custom_plugin_window', {
      windowId: 'yoyomusic-lyrics',
      title: '悠悠乐听 · 桌面歌词',
      url: 'index.html?lyrics=1',
      options: {
        width: 880,
        height: 110,
        transparent: true,
        decorations: false,
        shadow: false,
        resizable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
      },
    });
  });

  it('已开过同 windowId → 不重复 open', async () => {
    const { invoke } = installFakeHost({
      otools: {},
      tauriInvoke: () => [{ label: 'tools-tab-custom-x', windowId: 'yoyomusic-main' }],
    });
    await openPluginWindow('yoyomusic-main');
    expect(invoke).toHaveBeenCalledTimes(1); // 只 list，没 open
  });

  it('无宿主 → no-op', async () => {
    installFakeHost({ otools: null, utools: null, tauriInvoke: undefined });
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    await expect(openPluginWindow('yoyomusic-main')).resolves.toBeUndefined();
  });
});

describe('closePluginWindows', () => {
  it('有 tauri → invoke("close_custom_plugin_windows")', async () => {
    const { invoke } = installFakeHost({ otools: {} });
    await closePluginWindows();
    expect(invoke).toHaveBeenCalledWith('close_custom_plugin_windows');
  });

  it('无宿主 → no-op', async () => {
    installFakeHost({ otools: null, utools: null, tauriInvoke: undefined });
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    await expect(closePluginWindows()).resolves.toBeUndefined();
  });
});

describe('isCustomWindow', () => {
  it('注入 __OTOOLS_CUSTOM_WINDOW__ → true', () => {
    installFakeHost({ customWindow: true });
    expect(isCustomWindow()).toBe(true);
  });

  it('无标记 → false', () => {
    installFakeHost({});
    expect(isCustomWindow()).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * loadPersisted / savePersisted
 * ------------------------------------------------------------------ */

describe('loadPersisted', () => {
  it('宿主 getPluginLocalState → 直接返回宿主状态', async () => {
    const getPluginLocalState = vi.fn(async () => ({ skin: 'aurora' }));
    installFakeHost({
      otools: { getPluginLocalState, patchPluginLocalState: async () => undefined },
    });
    await expect(loadPersisted()).resolves.toEqual({ skin: 'aurora' });
    expect(getPluginLocalState).toHaveBeenCalledTimes(1);
  });

  it('宿主读取抛异常 → localStorage 兜底', async () => {
    installFakeHost({
      otools: {
        getPluginLocalState: async () => {
          throw new Error('host down');
        },
      },
    });
    window.localStorage.setItem(STATE_KEY, '{"a":1}');
    await expect(loadPersisted()).resolves.toEqual({ a: 1 });
  });

  it('无宿主 → 读 localStorage "yoyomusic.state.v1"', async () => {
    installFakeHost({ otools: null, utools: null });
    window.localStorage.setItem(STATE_KEY, '{"b":2}');
    await expect(loadPersisted()).resolves.toEqual({ b: 2 });
  });

  it('无宿主且 localStorage 为空 → null', async () => {
    installFakeHost({ otools: null, utools: null });
    await expect(loadPersisted()).resolves.toBeNull();
  });

  it('localStorage 内容损坏 → null（不抛）', async () => {
    installFakeHost({ otools: null, utools: null });
    window.localStorage.setItem(STATE_KEY, '{broken');
    await expect(loadPersisted()).resolves.toBeNull();
  });
});

describe('savePersisted', () => {
  it('宿主 patchPluginLocalState：整 patch 一次写入（不读改写）', async () => {
    const patchPluginLocalState = vi.fn(async () => undefined);
    const getPluginLocalState = vi.fn(async () => null);
    installFakeHost({ otools: { getPluginLocalState, patchPluginLocalState } });
    await savePersisted({ settings: { skin: 'mint' } });
    expect(patchPluginLocalState).toHaveBeenCalledWith(undefined, { settings: { skin: 'mint' } });
    expect(getPluginLocalState).not.toHaveBeenCalled();
  });

  it('无宿主 → localStorage 浅合并既有 JSON', async () => {
    installFakeHost({ otools: null, utools: null });
    window.localStorage.setItem(STATE_KEY, '{"a":1,"history":[1]}');
    await savePersisted({ a: 9, b: 2 });
    expect(JSON.parse(window.localStorage.getItem(STATE_KEY) ?? '')).toEqual({
      a: 9,
      b: 2,
      history: [1],
    });
  });

  it('无宿主且已存 JSON 损坏 → 视作空底再写', async () => {
    installFakeHost({ otools: null, utools: null });
    window.localStorage.setItem(STATE_KEY, '{broken');
    await savePersisted({ a: 1 });
    expect(JSON.parse(window.localStorage.getItem(STATE_KEY) ?? '')).toEqual({ a: 1 });
  });

  it('配额溢出 → 向上抛（裁剪顺序由上层持久化模块处理）', async () => {
    installFakeHost({ otools: null, utools: null });
    // jsdom 的 localStorage 是 Proxy：在实例上定义属性会被当成存储项写入，
    // stub 必须打在 Storage.prototype 上才会真正替换方法。
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });
    try {
      await expect(savePersisted({ a: 1 })).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});

/* ------------------------------------------------------------------ *
 * onLocale
 * ------------------------------------------------------------------ */

describe('onLocale', () => {
  it('注入 __OTOOLS_LOCALE__ → 立即回调当前 locale', () => {
    installFakeHost({ locale: 'en-US' });
    const seen: string[] = [];
    const off = onLocale((l) => seen.push(l));
    expect(seen).toEqual(['en-US']);
    off();
  });

  it('无 __OTOOLS_LOCALE__ → 初始 zh-CN', () => {
    installFakeHost({});
    const seen: string[] = [];
    const off = onLocale((l) => seen.push(l));
    expect(seen).toEqual(['zh-CN']);
    off();
  });

  it('监听 otools-locale-changed 事件（detail.locale）', () => {
    installFakeHost({ locale: 'zh-CN' });
    const seen: string[] = [];
    const off = onLocale((l) => seen.push(l));
    window.dispatchEvent(
      new CustomEvent('otools-locale-changed', { detail: { locale: 'en-US' } }),
    );
    expect(seen).toEqual(['zh-CN', 'en-US']);
    off();
  });

  it('退订后不再回调', () => {
    installFakeHost({ locale: 'zh-CN' });
    const seen: string[] = [];
    const off = onLocale((l) => seen.push(l));
    off();
    window.dispatchEvent(
      new CustomEvent('otools-locale-changed', { detail: { locale: 'en-US' } }),
    );
    expect(seen).toEqual(['zh-CN']);
  });

  it('相同 locale 重复广播不重复回调', () => {
    installFakeHost({ locale: 'zh-CN' });
    const seen: string[] = [];
    const off = onLocale((l) => seen.push(l));
    window.dispatchEvent(
      new CustomEvent('otools-locale-changed', { detail: { locale: 'zh-CN' } }),
    );
    expect(seen).toEqual(['zh-CN']);
    off();
  });
});
