/**
 * OTools SDK host-file-tree 的独立插件适配：宿主目录数据 + 页面内 DOM 选择树。
 * 来源：otools-plugin-sdk/src/host-file-tree.ts，MIT © 2026 Jason Young。
 * 适配点：音乐多选、路径输入、加载/错误态、异步导航序号、焦点恢复。
 * 不调用系统原生 dialog；读取函数由桥注入，构建不依赖宿主工程。
 */
export interface HostTreeEntry {
  name: string;
  path: string;
  kind: string;
  size: number;
  mime: string;
}
export interface HostBrowsePayload {
  currentPath: string;
  parentPath?: string | null;
  roots: { name: string; path: string }[];
  entries: HostTreeEntry[];
}
export interface HostTreeOptions {
  title?: string;
  directory?: boolean;
  multiple?: boolean;
  startPath?: string;
  filters?: { name: string; extensions: string[] }[];
}
export interface HostPickResult {
  kind: 'picked' | 'cancelled';
  source: 'host-tree';
  paths: string[];
  names: string[];
}

let lastDirectory = '';

function matches(entry: HostTreeEntry, filters: HostTreeOptions['filters']): boolean {
  if (entry.kind === 'directory' || !filters?.length) return true;
  const extension = entry.name.split('.').pop()?.toLowerCase() ?? '';
  return filters.some((filter) => filter.extensions.some((value) => value.replace(/^\./, '').toLowerCase() === extension));
}

function injectStyle(): void {
  if (document.getElementById('otools-host-tree-style')) return;
  const style = document.createElement('style');
  style.id = 'otools-host-tree-style';
  style.textContent = `
.otools-host-tree-overlay{position:fixed;inset:0;background:#0009;display:flex;align-items:center;justify-content:center;z-index:2147483000;font:13px "Segoe UI","Microsoft YaHei",sans-serif;color:var(--skin-ink,#f4f1ff);backdrop-filter:blur(6px)}
.otools-host-tree-panel{width:min(620px,94vw);max-height:88vh;display:flex;flex-direction:column;background:var(--skin-surface,#171327);border:1px solid var(--glass-border,#39314a);border-radius:14px;box-shadow:0 24px 80px #0008;overflow:hidden}
.otools-host-tree-header{padding:16px 18px 12px;border-bottom:1px solid #ffffff12;display:grid;gap:10px}
.otools-host-tree-title{font-size:15px;font-weight:600;display:flex;justify-content:space-between;align-items:center}
.otools-host-tree-pathbar{display:flex;gap:8px}.otools-host-tree-path{flex:1;min-width:0;padding:8px 10px;color:inherit;background:#0003;border:1px solid #ffffff20;border-radius:8px;font:inherit}
.otools-host-tree-body{overflow:auto;padding:8px;min-height:220px;max-height:48vh;display:flex;flex-direction:column;gap:3px}
.otools-host-tree-entry{display:flex;gap:10px;align-items:center;min-height:36px;padding:8px 10px;border:0;border-radius:7px;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer;flex-shrink:0}
.otools-host-tree-entry span:last-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.otools-host-tree-entry:hover{background:#ffffff0c}.otools-host-tree-entry[aria-pressed="true"]{background:color-mix(in srgb,var(--skin-primary,#8b5cf6) 22%,transparent)}
.otools-host-tree-footer{display:flex;align-items:center;gap:8px;padding:12px 16px;border-top:1px solid #ffffff12}.otools-host-tree-status{margin-right:auto;opacity:.65;font-size:12px}
.otools-host-tree-btn{padding:7px 12px;border:1px solid #ffffff20;border-radius:8px;background:#ffffff08;color:inherit;font:inherit;cursor:pointer}.otools-host-tree-btn-primary{background:var(--skin-primary,#8b5cf6);border-color:transparent;color:white}.otools-host-tree-btn:disabled{opacity:.4;cursor:default}.otools-host-tree-empty{margin:20px;text-align:center;opacity:.7}.otools-host-tree-error{margin:12px;color:#fda4af;white-space:pre-wrap}
.otools-host-tree-panel :focus-visible{outline:2px solid var(--skin-accent,#22d3ee);outline-offset:2px}
`;
  document.head.append(style);
}

export function pickFromHostTree(
  options: HostTreeOptions,
  browse: (path?: string) => Promise<HostBrowsePayload>,
): Promise<HostPickResult> {
  injectStyle();
  const previousFocus = document.activeElement as HTMLElement | null;
  const selected = new Map<string, string>();
  let currentPath = '';
  let currentFiles: HostTreeEntry[] = [];
  let version = 0;
  let loading = true;
  let closed = false;

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'otools-host-tree-overlay';
    overlay.setAttribute('data-host-tree', '');
    const panel = document.createElement('section');
    panel.className = 'otools-host-tree-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', options.title ?? (options.directory ? '选择音乐文件夹' : '导入音乐'));
    overlay.append(panel);
    const header = document.createElement('header');
    header.className = 'otools-host-tree-header';
    const title = document.createElement('div');
    title.className = 'otools-host-tree-title';
    title.textContent = options.title ?? (options.directory ? '选择音乐文件夹' : '导入音乐');
    const tag = document.createElement('small');
    tag.textContent = 'OTools · 宿主文件';
    tag.style.opacity = '.5';
    title.append(tag);
    const pathBar = document.createElement('div');
    pathBar.className = 'otools-host-tree-pathbar';
    const pathInput = document.createElement('input');
    pathInput.className = 'otools-host-tree-path';
    pathInput.setAttribute('aria-label', '目录路径');
    pathInput.placeholder = '输入目录路径';
    const makeButton = (label: string, onClick: () => void, primary = false): HTMLButtonElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `otools-host-tree-btn${primary ? ' otools-host-tree-btn-primary' : ''}`;
      button.textContent = label;
      button.addEventListener('click', onClick);
      return button;
    };
    const go = makeButton('前往', () => { void navigate(pathInput.value.trim()); });
    pathBar.append(pathInput, go);
    header.append(title, pathBar);
    const body = document.createElement('div');
    body.className = 'otools-host-tree-body';
    const footer = document.createElement('footer');
    footer.className = 'otools-host-tree-footer';
    const status = document.createElement('span');
    status.className = 'otools-host-tree-status';
    const selectAll = makeButton('全选', () => {
      const all = currentFiles.length > 0 && currentFiles.every((entry) => selected.has(entry.path));
      for (const entry of currentFiles) {
        if (all) selected.delete(entry.path);
        else selected.set(entry.path, entry.name);
      }
      updateSelection();
    });
    const cancel = makeButton('取消', () => close({ kind: 'cancelled', source: 'host-tree', paths: [], names: [] }));
    cancel.setAttribute('data-host-tree-cancel', '');
    const confirm = makeButton(options.directory ? '选择此目录' : '选择', () => {
      if (loading || confirm.disabled) return;
      const paths = options.directory ? [currentPath] : [...selected.keys()];
      const names = options.directory ? [currentPath.split(/[\\/]/).filter(Boolean).pop() || currentPath] : [...selected.values()];
      close({ kind: 'picked', source: 'host-tree', paths, names });
    }, true);
    confirm.setAttribute('data-host-tree-confirm', '');
    confirm.disabled = true;
    footer.append(status);
    if (options.multiple && !options.directory) footer.append(selectAll);
    footer.append(cancel, confirm);
    panel.append(header, body, footer);

    function close(value: HostPickResult): void {
      if (closed) return;
      closed = true;
      version += 1;
      window.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (previousFocus?.isConnected) previousFocus.focus();
      resolve(value);
    }
    function updateSelection(): void {
      for (const row of body.querySelectorAll<HTMLButtonElement>('[data-host-tree-file]')) {
        row.setAttribute('aria-pressed', String(selected.has(row.dataset.path || '')));
      }
      confirm.disabled = loading || (options.directory ? !currentPath : !selected.size);
      if (!options.directory) confirm.textContent = selected.size ? `选择 (${selected.size})` : '选择';
      status.textContent = options.directory ? '选择宿主上的目录' : `已选择 ${selected.size} 首`;
      const all = currentFiles.length > 0 && currentFiles.every((entry) => selected.has(entry.path));
      selectAll.textContent = all ? '取消全选' : '全选';
      selectAll.disabled = loading || currentFiles.length === 0;
    }
    function addRow(name: string, path: string, directory: boolean): void {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'otools-host-tree-entry';
      row.dataset.path = path;
      row.dataset.kind = directory ? 'directory' : 'file';
      row.setAttribute('aria-label', name);
      const icon = document.createElement('span');
      icon.textContent = directory ? '▸' : '♪';
      icon.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.textContent = name;
      row.append(icon, label);
      if (!directory) {
        row.setAttribute('data-host-tree-file', '');
        row.setAttribute('aria-pressed', String(selected.has(path)));
      }
      row.addEventListener('click', () => {
        if (directory) { void navigate(path); return; }
        if (options.directory) return;
        if (options.multiple && selected.has(path)) selected.delete(path);
        else {
          if (!options.multiple) selected.clear();
          selected.set(path, name);
        }
        updateSelection();
      });
      body.append(row);
    }
    async function navigate(path?: string): Promise<void> {
      const request = ++version;
      loading = true;
      updateSelection();
      body.replaceChildren();
      const pending = document.createElement('p');
      pending.className = 'otools-host-tree-empty';
      pending.textContent = '正在读取宿主目录…';
      body.append(pending);
      try {
        const data = await browse(path);
        if (closed || request !== version) return;
        if (!data || typeof data.currentPath !== 'string' || !Array.isArray(data.entries) || !Array.isArray(data.roots)) {
          throw new Error('宿主目录响应无效');
        }
        currentPath = data.currentPath;
        lastDirectory = currentPath;
        pathInput.value = currentPath;
        currentFiles = data.entries.filter((entry) => entry.kind === 'file' && matches(entry, options.filters));
        body.replaceChildren();
        if (data.parentPath) addRow('↑ 上一级', data.parentPath, true);
        for (const root of data.roots) addRow(`${root.name} (${root.path})`, root.path, true);
        for (const entry of data.entries) {
          if (entry.kind === 'directory' || (!options.directory && matches(entry, options.filters))) {
            addRow(entry.name, entry.path, entry.kind === 'directory');
          }
        }
        if (!body.children.length) {
          const empty = document.createElement('p');
          empty.className = 'otools-host-tree-empty';
          empty.textContent = '此目录没有可选文件';
          body.append(empty);
        }
        loading = false;
        updateSelection();
      } catch (error) {
        if (closed || request !== version) return;
        body.replaceChildren();
        const alert = document.createElement('p');
        alert.className = 'otools-host-tree-error';
        alert.setAttribute('role', 'alert');
        alert.textContent = `无法读取宿主目录\n${error instanceof Error ? error.message : String(error)}`;
        body.append(alert, makeButton('重试', () => { void navigate(path); }));
        currentFiles = [];
        currentPath = '';
        loading = false;
        updateSelection();
        confirm.disabled = true;
      }
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancel.click();
      } else if (event.key === 'Tab') {
        const focusable = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled),input')];
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    window.addEventListener('keydown', onKey, true);
    pathInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); void navigate(pathInput.value.trim()); }
    });
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) cancel.click(); });
    document.body.append(overlay);
    pathInput.focus();
    void navigate((options.startPath ?? lastDirectory) || undefined);
  });
}
