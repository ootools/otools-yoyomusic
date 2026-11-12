/**
 * 跨窗口消息总线（spec §5.3 / 计划 Task 3）。
 *
 * 三窗口（panel / 主窗口 / 桌面歌词）同 origin，靠 BusMsg 联合类型承载：
 * 主控页选举（claim/hello/owner-gone）、单写者状态汇入（state-mutate/state-snap）、
 * 播放归属与命令（takeover/cmd/playback）。
 *
 * 双通道按存在性择优（spec §13 风险表：BroadcastChannel 在 otools-plugin:// 下
 * 可用性未验证，localStorage storage 事件为 daymark 先例兜底）：
 *  1. `BroadcastChannel('yoyomusic')` 可用 → postMessage / onmessage；
 *  2. 否则 localStorage `storage` 事件兜底：post 写 key `__yoyomusic.bus`
 *     （storage 事件只在**其他**窗口触发，天然不含自身回声）。
 *
 * 注意：总线不向发送者自己回送（两条通道的真实语义都如此）；测试用的内存版
 * bus 会回送，消费方（leader）须过滤 from===自身的总线回声。
 */

export type BusMsg =
  | { t: 'claim'; epoch: number; from: string }
  | { t: 'hello'; from: string }
  /** desktopLyrics 归 settings；window=窗口位置 */
  | { t: 'state-mutate'; key: 'library' | 'settings' | 'window'; patch: unknown; from: string }
  | { t: 'state-snap'; snap: Record<string, unknown>; from: string }
  | { t: 'takeover'; epoch: number; from: string }
  | { t: 'owner-gone'; from: string }
  | {
      t: 'cmd';
      op: 'play' | 'pause' | 'toggle' | 'next' | 'prev' | 'seek' | 'volume' | 'mute' | 'setTrack';
      arg?: unknown;
      from: string;
    }
  | { t: 'playback'; state: unknown; from: string };

export interface Bus {
  post(m: BusMsg): void;
  on(h: (m: BusMsg) => void): () => void;
}

/** localStorage 兜底通道的信箱 key（计划 Task 3 指定）。 */
const BUS_KEY = '__yoyomusic.bus';

/**
 * 创建跨窗口总线。BroadcastChannel 可用（构造不抛）走频道，否则落
 * localStorage storage 事件。on() 返回退订函数。
 */
export function createBus(): Bus {
  const handlers = new Set<(m: BusMsg) => void>();

  const deliver = (m: BusMsg): void => {
    for (const h of [...handlers]) h(m);
  };

  // 通道探测：构造失败（旧 webview 无实现）即落兜底，不重复尝试
  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel === 'function') {
    try {
      channel = new BroadcastChannel('yoyomusic');
    } catch {
      channel = null;
    }
  }

  if (channel) {
    channel.onmessage = (event: MessageEvent) => {
      const data = event.data as BusMsg | null | undefined;
      if (!data || typeof data !== 'object' || typeof (data as BusMsg).t !== 'string') return;
      deliver(data);
    };
    return {
      post(m: BusMsg): void {
        try {
          channel!.postMessage(m);
        } catch {
          // 序列化失败（结构化克隆不支持的数据）不应炸 UI；该条消息放弃
        }
      },
      on(h: (m: BusMsg) => void): () => void {
        handlers.add(h);
        return () => {
          handlers.delete(h);
        };
      },
    };
  }

  // localStorage 兜底：post = 写信箱 key；收 = storage 事件（仅其他窗口触发）
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key !== BUS_KEY || event.newValue === null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.newValue);
    } catch {
      return; // 坏消息丢弃
    }
    if (!parsed || typeof parsed !== 'object' || typeof (parsed as BusMsg).t !== 'string') return;
    deliver(parsed as BusMsg);
  });

  return {
    post(m: BusMsg): void {
      try {
        window.localStorage.setItem(BUS_KEY, JSON.stringify(m));
      } catch {
        // 配额满/序列化失败：总线消息（JSON 数据）极小，失败即丢弃
      }
    },
    on(h: (m: BusMsg) => void): () => void {
      handlers.add(h);
      return () => {
        handlers.delete(h);
      };
    },
  };
}
