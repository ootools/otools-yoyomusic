/**
 * 主控页单写者持久化（spec §10.2 / 计划 Task 3）。
 *
 * 宿主 `patchPluginLocalState` 是整 JSON 读-改-写 + 顶层键浅合并——同键并发写
 * 丢更新，故**只有主控页**真正落盘（单写者规则，spec §5.3 协议 6）：
 *  - scheduleSave(key)：settings 400ms / library 1500ms 尾沿 debounce，
 *    多次调用合并为一次；非主控页调度了也不写（数据经总线汇入主控页）；
 *  - flushPosition()：播放恢复点每 5s 至多冲刷一次（leading 节流），
 *    快照缺 resume 时跳过（不冲掉既有恢复点）；
 *  - flushNow()：取消挂起的 debounce 并立即整快照落盘；返回 Promise，
 *    **写入失败向上抛**（调用方可 await 到失败，如 beforeunload 收尾）。
 *
 * 写经 Task 2 `savePersisted`（默认从 bridge 导入；可经 opts 注入以便测试）。
 * Task 2 审查点：其宿主分支会向上抛 rejection——定时器/flushPosition 路径
 * 必须消费（吞掉），仅 flushNow 路径保留传播。
 *
 * localStorage 兜底配额裁剪（spec §10.2，浏览器直开大曲库场景）：
 * 写入抛配额错误时按 **coverThumb（剥缩略图）→ history（截到 50）→
 * resume（清空）** 顺序裁剪重试，每步包含此前裁剪；裁剪到底仍失败 → 抛出。
 * 裁剪作用于深拷贝，不污染调用方快照。
 */

import { savePersisted as bridgeSavePersisted } from '../bridge/otools';

export interface PersistenceOptions {
  isLeader: () => boolean;
  getSnapshot: () => Record<string, unknown>;
  /** 注入以便测试；缺省用 Task 2 bridge 的 savePersisted。 */
  savePersisted?: (patch: Record<string, unknown>) => Promise<void>;
}

export interface PersistenceHandle {
  scheduleSave(key: 'settings' | 'library'): void;
  flushPosition(): void;
  flushNow(): Promise<void>;
  /** 停止尚未触发的 debounce，并等待全部逻辑写入（含配额重试）结束。 */
  drain?(): Promise<void>;
}

/** 各键写节流（尾沿 debounce，spec §10.2：settings 400ms / library 1500ms）。 */
const SAVE_DEBOUNCE_MS: Record<'settings' | 'library', number> = {
  settings: 400,
  library: 1500,
};
/** 播放位置冲刷间隔：每 5s 至多一次。 */
const POSITION_FLUSH_INTERVAL_MS = 5000;
/** 配额裁剪时历史保留条数。 */
const HISTORY_PRUNE_LIMIT = 50;

/** 深度遍历 patch，对每个名为 key 的属性施加 transform（coverThumb 删除等）。 */
function transformKeyDeep(node: unknown, key: string, transform: (v: unknown) => unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) transformKeyDeep(item, key, transform);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const rec = node as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(rec, key)) {
    const next = transform(rec[key]);
    if (next === undefined) delete rec[key];
    else rec[key] = next;
  }
  for (const value of Object.values(rec)) transformKeyDeep(value, key, transform);
}

export function createPersistence(opts: PersistenceOptions): PersistenceHandle {
  const save = opts.savePersisted ?? bridgeSavePersisted;

  const pendingTimers: Record<'settings' | 'library', ReturnType<typeof setTimeout> | null> = {
    settings: null,
    library: null,
  };
  let lastPositionFlushAt = Number.NEGATIVE_INFINITY;
  const inFlight = new Set<Promise<void>>();

  /** 配额类错误识别：裁剪重试只针对配额，其余错误原样抛出。 */
  const isQuotaError = (e: unknown): boolean => {
    if (e instanceof DOMException) {
      return e.name === 'QuotaExceededError' || /quota/i.test(e.message);
    }
    const name = (e as { name?: unknown } | null)?.name;
    if (typeof name === 'string') return /quota|exceed/i.test(name);
    return /quota|exceed/i.test(String(e));
  };

  /** 深拷贝（JSON 域）：裁剪不得污染调用方快照。 */
  const clonePatch = (patch: Record<string, unknown>): Record<string, unknown> =>
    JSON.parse(JSON.stringify(patch)) as Record<string, unknown>;

  /**
   * 写入 + 配额裁剪梯子：原样 → 剥 coverThumb → history 截 50 → resume 清空，
   * 每步重试；非配额错误立即上抛；裁剪到底仍失败 → 抛最后一次错误。
   */
  const writeWithPrune = async (patch: Record<string, unknown>): Promise<void> => {
    try {
      await save(patch);
      return;
    } catch (e) {
      if (!isQuotaError(e)) throw e;
    }
    const pruned = clonePatch(patch);
    const pruneSteps: Array<(p: Record<string, unknown>) => void> = [
      // 1) 封面缩略图（96px JPEG base64，快照里体积大头）
      (p) => transformKeyDeep(p, 'coverThumb', () => undefined),
      // 2) 历史截到 50
      (p) =>
        transformKeyDeep(p, 'history', (v) =>
          Array.isArray(v) ? v.slice(0, HISTORY_PRUNE_LIMIT) : v,
        ),
      // 3) resume 清空
      (p) => transformKeyDeep(p, 'resume', () => null),
    ];
    for (const step of pruneSteps) {
      step(pruned);
      try {
        await save(pruned);
        return;
      } catch (e) {
        if (!isQuotaError(e)) throw e;
      }
    }
    throw new Error('persist-quota-exhausted');
  };

  const write = (patch: Record<string, unknown>): Promise<void> => {
    const task = writeWithPrune(patch);
    inFlight.add(task);
    void task.then(() => { inFlight.delete(task); }, () => { inFlight.delete(task); });
    return task;
  };
  const cancelPending = (): void => {
    for (const key of ['settings', 'library'] as const) {
      const timer = pendingTimers[key];
      if (timer !== null) {
        clearTimeout(timer);
        pendingTimers[key] = null;
      }
    }
  };

  return {
    scheduleSave(key: 'settings' | 'library'): void {
      const existing = pendingTimers[key];
      if (existing !== null) clearTimeout(existing);
      pendingTimers[key] = setTimeout(
        () => {
          pendingTimers[key] = null;
          if (!opts.isLeader()) return; // 单写者：仅主控页落盘
          const part = opts.getSnapshot()[key];
          write({ [key]: part }).catch(() => {
            // Task 2 审查点：定时写路径必须消费 rejection（裁剪到底仍失败即放弃本次）
          });
        },
        SAVE_DEBOUNCE_MS[key],
      );
    },

    flushPosition(): void {
      if (!opts.isLeader()) return; // 单写者
      const resume = opts.getSnapshot().resume;
      if (resume === undefined) return; // 快照无恢复点：不冲刷（不冲掉既有值）
      const now = Date.now();
      if (now - lastPositionFlushAt < POSITION_FLUSH_INTERVAL_MS) return; // 每 5s 至多一次
      lastPositionFlushAt = now;
      write({ resume }).catch(() => {
        // 同上：fire-and-forget 路径必须消费 rejection
      });
    },

    flushNow(): Promise<void> {
      cancelPending(); // 挂起的 debounce 一并落地，避免重复写
      if (!opts.isLeader()) return Promise.resolve();
      return write(opts.getSnapshot()); // 失败向上抛（调用方可 await）
    },
    async drain(): Promise<void> {
      cancelPending();
      while (inFlight.size) await Promise.allSettled([...inFlight]);
    },
  };
}
