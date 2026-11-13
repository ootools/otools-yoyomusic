/** 宿主 SDK window/event shim 的载荷约定，桥内集中处理原生窗口能力。 */
interface WindowMetadata { currentWindow?: { label?: string }; }
interface NativeInternals extends NonNullable<Window['__TAURI_INTERNALS__']> {
  metadata?: WindowMetadata;
  transformCallback?: (callback: (value: unknown) => void, once?: boolean) => number;
  unregisterCallback?: (id: number) => void;
}
const getNative = () => window.__TAURI_INTERNALS__ as NativeInternals | undefined;
export async function nativeWindowCommand(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const internals = getNative();
  if (!internals?.invoke) {
    if (command === 'close') window.close();
    return undefined;
  }
  const label = internals.metadata?.currentWindow?.label ?? '';
  return internals.invoke(`plugin:window|${command}`, { label, ...args });
}
export async function markCustomWindowReady(ready: boolean): Promise<void> {
  if (window.__OTOOLS_CUSTOM_WINDOW__) await window.__TAURI_INTERNALS__?.invoke?.('custom_plugin_window_ready', { ready });
}

/** 跟随原生tauri://move事件，拖动停止后保存最终物理位置，不在start_dragging返回时抢存。 */
export async function observeWindowPosition(onPosition: (position: { x: number; y: number }) => void): Promise<() => Promise<void>> {
  const internals = getNative();
  if (!internals?.invoke || !internals.transformCallback) return async () => {};
  let active = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let point: { x: number; y: number } | null = null;
  const callback = internals.transformCallback((event) => {
    if (!active) return;
    const value = event && typeof event === 'object' && 'payload' in event ? event.payload : event;
    const position = value as { x?: unknown; y?: unknown } | null;
    if (typeof position?.x !== 'number' || typeof position.y !== 'number' || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
    point = { x: position.x, y: position.y };
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; if (active && point) onPosition(point); }, 200);
  }, false);
  let eventId: number;
  try {
    eventId = await internals.invoke('plugin:event|listen', { event: 'tauri://move', target: { kind: 'Window', label: internals.metadata?.currentWindow?.label ?? '' }, handler: callback }) as number;
  } catch (error) {
    internals.unregisterCallback?.(callback);
    throw error;
  }
  return async () => {
    if (!active) return;
    active = false;
    if (timer) clearTimeout(timer);
    internals.unregisterCallback?.(callback);
    await internals.invoke?.('plugin:event|unlisten', { event: 'tauri://move', eventId });
  };
}
