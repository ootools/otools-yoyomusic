/**
 * OTools 宿主桥与能力探测（spec §5.2/§5.3/§6.1/§9/§10.2）。
 *
 * 两条通道，按存在性择优：
 *  1. `window.otools`（或 `window.utools`）注入的高层 API —— dialog / listHostDir /
 *     readHostFile / getPluginLocalState / patchPluginLocalState（宿主
 *     embedded-runtime.js 提供，签名见 vendor/otools-plugin-sdk/src/otools-globals.ts）。
 *  2. `window.__TAURI_INTERNALS__.invoke` —— 原始宿主命令（tools_webview_read_file、
 *     show_panel_window、open_custom_plugin_window、list_custom_plugin_windows、
 *     close_custom_plugin_windows）。
 *
 * 字段名核对（宿主源码为准）：
 *  - webview_fs/core.rs `WebviewReadFilePayload` 带 `#[serde(rename_all="camelCase")]`，
 *    Rust 字段 `data_base64` 序列化后是 **dataBase64**（与 SDK TS 类型一致）；兼容
 *    旧 snake_case。
 *  - webview/transport.rs `CustomWindowOptions` 同为 camelCase：width/height/.../
 *    skipTaskbar/alwaysOnTop。
 *  - `CustomWindowInfo { label, windowId }`（camelCase）。
 *  - `WebviewDirEntry.kind` ∈ "directory" | "file"。
 *
 * 所有宿主调用先探测子 API 存在性，try/catch 后落降级分支；无宿主的核心语义：
 * 读文件 reject、选目录 null、窗口操作 no-op、持久化走 localStorage 兜底。
 */

/* ------------------------------------------------------------------ */
/* 宿主类型（对齐 vendor/otools-plugin-sdk/src/otools-globals.ts 子集） */
/* ------------------------------------------------------------------ */

export type OToolsLocale = 'zh-CN' | 'en-US';

export interface OToolsDialogFilter {
  name: string;
  extensions: string[];
}

export interface OToolsDialogOpenOptions {
  directory?: boolean;
  multiple?: boolean;
  title?: string;
  defaultPath?: string;
  filters?: OToolsDialogFilter[];
}

export interface OToolsDialogAPI {
  open(options?: OToolsDialogOpenOptions): Promise<string | string[] | null>;
}

export interface OToolsHostDirEntry {
  name: string;
  path: string;
  kind: string;
  size: number;
  mime: string;
  lastModified?: number | null;
}

/** tools_webview_read_file / readHostFile 的载荷（dataBase64 为主，兼容 data_base64）。 */
export interface OToolsHostReadFilePayload {
  path?: string;
  name?: string;
  size?: number;
  mime?: string;
  lastModified?: number | null;
  dataBase64?: string;
  data_base64?: string;
}

export interface OToolsAPI {
  dialog?: OToolsDialogAPI;
  listHostDir?(path: string): Promise<OToolsHostDirEntry[]>;
  readHostFile?(path: string): Promise<OToolsHostReadFilePayload>;
  getPluginLocalState<T = unknown>(plugin?: string, scheme?: string | null): Promise<T | null>;
  patchPluginLocalState?(
    plugin?: string,
    patch?: Record<string, unknown>,
    scheme?: string | null,
  ): Promise<void>;
}

export interface TauriInternals {
  invoke?: (command: string, payload?: Record<string, unknown>) => Promise<unknown>;
}

export interface OToolsCustomWindowMarker {
  pluginUuid: string;
  pluginSource: string;
  windowId: string;
}

export interface OToolsCaps {
  /** 宿主桥存在（window.otools / window.utools） */
  host: boolean;
  /** 能开自定义窗口（open_custom_plugin_window，走 tauri invoke） */
  customWindow: boolean;
  /** 能调 show_panel_window 恢复面板（走 tauri invoke） */
  panelWindow: boolean;
  /** 宿主持久化状态 API 可用（getPluginLocalState + patchPluginLocalState） */
  hostState: boolean;
  /** 宿主目录列举可用（listHostDir） */
  hostDir: boolean;
}

declare global {
  interface Window {
    otools?: OToolsAPI;
    utools?: OToolsAPI;
    __TAURI_INTERNALS__?: TauriInternals;
    __OTOOLS_CUSTOM_WINDOW__?: OToolsCustomWindowMarker;
    __OTOOLS_LOCALE__?: { locale?: string };
  }
}

/* ------------------------------------------------------------------ */
/* 全局访问与能力探测                                                   */
/* ------------------------------------------------------------------ */

const getOtools = (): OToolsAPI | undefined => window.otools ?? window.utools;

const getInvoke = (): TauriInternals['invoke'] | undefined => {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  return typeof invoke === 'function' ? invoke : undefined;
};

/** 能力探测（spec §5.2：所有宿主能力运行时探测，缺失即降级）。 */
export function detectHost(): OToolsCaps {
  const api = getOtools();
  const invoke = getInvoke();
  return {
    host: !!api,
    customWindow: !!invoke,
    panelWindow: !!invoke,
    hostState:
      typeof api?.getPluginLocalState === 'function' &&
      typeof api?.patchPluginLocalState === 'function',
    hostDir: typeof api?.listHostDir === 'function',
  };
}

/* ------------------------------------------------------------------ */
/* 文件与目录                                                          */
/* ------------------------------------------------------------------ */

const base64ToBytes = (data: string): Uint8Array => {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const readDataBase64 = (payload: unknown): string | null => {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const value = record.dataBase64 ?? record.data_base64;
  return typeof value === 'string' ? value : null;
};

/**
 * 整读宿主文件字节（元数据解析 / Blob URL 用，spec §6.1 BlobTransport 底座）。
 * 优先 `otools.readHostFile`（内部即 tools_webview_read_file），否则直接
 * invoke 该命令；无宿主 reject('no-host')。
 */
export async function readFileBytes(path: string): Promise<Uint8Array> {
  const api = getOtools();
  if (api && typeof api.readHostFile === 'function') {
    const payload = await api.readHostFile(path);
    const data = readDataBase64(payload);
    if (data === null) throw new Error('read-file-no-data');
    return base64ToBytes(data);
  }

  const invoke = getInvoke();
  if (invoke) {
    const payload = await invoke('tools_webview_read_file', { path });
    const data = readDataBase64(payload);
    if (data === null) throw new Error('read-file-no-data');
    return base64ToBytes(data);
  }

  throw new Error('no-host');
}

/** listDirectoryRecursive 深度上限（防目录环 + 失控深树）。 */
const MAX_LIST_DEPTH = 8;

const dirKeyOf = (path: string): string => path.replace(/[\\/]+$/, '').toLowerCase();

/**
 * listHostDir 递归展开（spec §10.2 曲库扫描）：只列文件（{path,size}[]）。
 * 深度上限 8 层 + 已访集合防环；单个**子目录**读取失败跳过不炸整体；
 * **根目录**读取失败 reject（Task 6 授权点：调用方要区分"扫描失败"与
 * "空目录"，吞成 [] 会让导入静默丢库）。
 */
export async function listDirectoryRecursive(
  dir: string,
): Promise<{ path: string; size: number }[]> {
  const api = getOtools();
  if (!api || typeof api.listHostDir !== 'function') {
    throw new Error('no-host');
  }

  const listHostDir = api.listHostDir.bind(api);
  const files: { path: string; size: number }[] = [];
  const visited = new Set<string>();

  const walk = async (path: string, depth: number, isRoot: boolean): Promise<void> => {
    if (depth > MAX_LIST_DEPTH) return;
    const key = dirKeyOf(path);
    if (!key || visited.has(key)) return;
    visited.add(key);

    let entries: OToolsHostDirEntry[];
    try {
      entries = await listHostDir(path);
    } catch (err) {
      if (isRoot) throw err; // 根目录失败：整体 reject（调用方按失败处理）
      return; // 子目录失败：跳过，不让整个扫描失败
    }
    if (!Array.isArray(entries)) {
      if (isRoot) throw new Error('list-host-dir-bad-response');
      return;
    }

    for (const entry of entries) {
      if (!entry || typeof entry.path !== 'string' || !entry.path) continue;
      if (entry.kind === 'directory') {
        await walk(entry.path, depth + 1, false);
        continue;
      }
      files.push({ path: entry.path, size: Number(entry.size) || 0 });
    }
  };

  await walk(dir, 1, true);
  return files;
}

/* ------------------------------------------------------------------ */
/* 文件/目录对话框                                                      */
/* ------------------------------------------------------------------ */

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a', 'opus'] as const;

/** dialog.open 结果规范化：null/空 → null，单字符串 → [字符串]。 */
const normalizeDialogPaths = (result: unknown): string[] | null => {
  if (Array.isArray(result)) {
    const paths = result.filter(
      (item): item is string => typeof item === 'string' && item.trim() !== '',
    );
    return paths.length ? paths : null;
  }
  if (typeof result === 'string' && result.trim() !== '') return [result];
  return null;
};

/**
 * 浏览器降级：input[type=file multiple] 选文件 → objectURL（blob: 前缀条目，
 * Task 6 据此跳过路径重解析）。cancel 或未选 → null。
 */
const pickViaFileInput = (): Promise<string[] | null> => {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = AUDIO_EXTENSIONS.map((ext) => `.${ext}`).join(',');
    input.style.display = 'none';

    let settled = false;
    const finish = (value: string[] | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };

    input.addEventListener('change', () => {
      const files = Array.from((input.files ?? []) as ArrayLike<File>);
      if (!files.length) {
        finish(null);
        return;
      }
      finish(files.map((file) => URL.createObjectURL(file)));
    });
    input.addEventListener('cancel', () => finish(null));

    document.body.appendChild(input);
    input.click();
  });
};

/** 选音频文件：宿主 dialog.open（multiple + Audio filters）；浏览器降级 input。 */
export async function pickAudioFiles(): Promise<string[] | null> {
  const dialog = getOtools()?.dialog;
  if (dialog && typeof dialog.open === 'function') {
    try {
      const result = await dialog.open({
        multiple: true,
        filters: [{ name: 'Audio', extensions: [...AUDIO_EXTENSIONS] }],
      });
      return normalizeDialogPaths(result);
    } catch {
      return null; // 宿主对话框失败按取消处理
    }
  }
  return pickViaFileInput();
}

/**
 * 选目录：宿主 dialog.open({directory:true})。
 * 浏览器降级**不支持**：input[type=file] 拿不到原绝对路径（webkitdirectory
 * 只给相对路径），与"只存原绝对路径"的曲库模型（Global Constraints）冲突，
 * 故直接返回 null（上层按 cap 隐藏入口）。
 */
export async function pickDirectory(): Promise<string | null> {
  const dialog = getOtools()?.dialog;
  if (dialog && typeof dialog.open === 'function') {
    try {
      const result = await dialog.open({ directory: true });
      if (typeof result === 'string' && result.trim() !== '') return result;
      if (Array.isArray(result)) {
        const first = result.find(
          (item): item is string => typeof item === 'string' && item.trim() !== '',
        );
        return first ?? null;
      }
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 窗口编排                                                             */
/* ------------------------------------------------------------------ */

/**
 * show_panel_window：dialog 关闭后恢复被失焦隐藏的 panel（spec §5.3、
 * Review Focus #5）。无宿主 no-op；宿主报错也吞掉——恢复失败不该打断导入流程。
 */
export async function showPanelWindow(): Promise<void> {
  const invoke = getInvoke();
  if (!invoke) return;
  try {
    await invoke('show_panel_window');
  } catch {
    // 面板恢复失败只能留待用户手动唤起，不影响后续流程
  }
}

/** 三窗口规格（spec §5.3 表 / §9），options 为宿主 CustomWindowOptions（camelCase）。 */
const WINDOW_SPECS = {
  'yoyomusic-main': {
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
  },
  'yoyomusic-lyrics': {
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
  },
} as const;

export type PluginWindowId = keyof typeof WINDOW_SPECS;

/**
 * 打开常驻主窗口 / 桌面歌词悬浮窗（open_custom_plugin_window，spec §5.3/§9）。
 * 重复打开先 list_custom_plugin_windows 查重；无宿主 no-op。
 */
export async function openPluginWindow(id: PluginWindowId): Promise<void> {
  const invoke = getInvoke();
  if (!invoke) return; // 浏览器模式没有宿主自定义窗口

  const spec = WINDOW_SPECS[id];
  try {
    const existing = await invoke('list_custom_plugin_windows');
    if (
      Array.isArray(existing) &&
      existing.some((item) => {
        const windowId = (item as { windowId?: unknown } | null)?.windowId;
        return windowId === spec.windowId;
      })
    ) {
      return; // 已开过：不重复开（spec §9）
    }
  } catch {
    // 旧宿主没有 list 命令：照样尝试打开
  }

  await invoke('open_custom_plugin_window', {
    windowId: spec.windowId,
    title: spec.title,
    url: spec.url,
    options: spec.options,
  });
}

/** 关闭本插件全部自定义窗口（close_custom_plugin_windows）；无宿主 no-op。 */
export async function closePluginWindows(): Promise<void> {
  const invoke = getInvoke();
  if (!invoke) return;
  await invoke('close_custom_plugin_windows');
}

/** 当前页面是否为宿主托管的自定义窗口（主窗口 / 桌面歌词页自识别）。 */
export function isCustomWindow(): boolean {
  return !!window.__OTOOLS_CUSTOM_WINDOW__;
}

/* ------------------------------------------------------------------ */
/* 持久化（spec §10.2：宿主单写者 patch 语义，localStorage 兜底）          */
/* ------------------------------------------------------------------ */

const STATE_KEY = 'yoyomusic.state.v1';

/**
 * 读持久化状态：宿主 getPluginLocalState 优先（宿主失败/缺失落 localStorage
 * 兜底）；纯浏览器读 localStorage。宿主明确返回 null 时返回 null（宿主为准，
 * 不复活浏览器旧数据）。
 */
export async function loadPersisted(): Promise<unknown | null> {
  const api = getOtools();
  if (api && typeof api.getPluginLocalState === 'function') {
    try {
      const state = await api.getPluginLocalState();
      if (state !== undefined) return state;
    } catch {
      // 宿主读取失败 → localStorage 兜底
    }
  }
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null; // 损坏数据视作空状态
  }
}

/**
 * 写持久化 patch：宿主 patchPluginLocalState（顶层键浅合并，整 patch 一次交给
 * 宿主，不本地读改写）；纯浏览器落 localStorage（读旧 JSON 浅合并后写回）。
 * 写入失败向上抛（localStorage 配额裁剪顺序由上层持久化模块处理，spec §10.2）。
 */
export async function savePersisted(patch: Record<string, unknown>): Promise<void> {
  const api = getOtools();
  if (api && typeof api.patchPluginLocalState === 'function') {
    await api.patchPluginLocalState(undefined, patch);
    return;
  }

  let current: Record<string, unknown> = {};
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        current = parsed as Record<string, unknown>;
      }
    }
  } catch {
    // 已存数据损坏：视作空底重写
  }
  const next = { ...current, ...patch };
  window.localStorage.setItem(STATE_KEY, JSON.stringify(next));
}

/* ------------------------------------------------------------------ */
/* 语言                                                                */
/* ------------------------------------------------------------------ */

const normalizeLocale = (value: unknown): OToolsLocale =>
  typeof value === 'string' && /^en/i.test(value) ? 'en-US' : 'zh-CN';

const readLocale = (): OToolsLocale => normalizeLocale(window.__OTOOLS_LOCALE__?.locale);

/**
 * 订阅宿主语言：立即用当前 locale（__OTOOLS_LOCALE__，缺省 zh-CN，与宿主
 * webview/core.rs 注入行为一致）回调一次，之后监听 `otools-locale-changed`
 * （宿主在 window 上派发，detail={locale}）。返回退订函数。
 */
export function onLocale(cb: (locale: OToolsLocale) => void): () => void {
  let last: OToolsLocale = readLocale();
  cb(last);

  const handler = (event: Event): void => {
    const detail = (event as CustomEvent<{ locale?: unknown }>).detail;
    const next = normalizeLocale(detail?.locale ?? undefined);
    if (next === last) return;
    last = next;
    cb(next);
  };
  window.addEventListener('otools-locale-changed', handler);
  return () => {
    window.removeEventListener('otools-locale-changed', handler);
  };
}
