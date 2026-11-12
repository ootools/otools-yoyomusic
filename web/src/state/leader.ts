/**
 * 主控页选举与消息路由（spec §5.3 协议 6 / 计划 Task 3）。
 *
 * 单写者规则：全应用只有一个页面（主控页）允许调用宿主持久化 API；
 * 其他页面的曲库/设置变更经总线汇入主控页。本模块负责：
 *
 * 选举（epoch=Date.now() 起步，(epoch, from) 字典序定胜负，epoch 小者胜——
 * 先创建的页面 epoch 更小，等价"claim 首者胜"；同 epoch 时按 from 破平，
 * 各页看到的全部消息一致，收敛结果确定）：
 *  - 创建即乐观当选并广播 claim（浏览器直开单页 → 本页即主控页）；
 *  - 收到更优 claim（epoch 更小，或相等且 from 更小）→ 让位跟随；
 *    收到更劣 claim → 重申自己的 claim 把对方压下去（一轮收敛）；
 *  - 主控页每 2s 广播 hello 心跳；跟随者 1s 巡检，超过 3×2s=6s 无心跳
 *    → 接管重选（取新 epoch=Date.now() 并广播 claim；与存活主控的竞争
 *    由"epoch 小者胜 + 重申"一轮收敛）；
 *  - 主控页卸载（beforeunload）广播 owner-gone → 其余页立即重选。
 *
 * 消息路由（handle 是**本地入口**；总线入口由 createLeader 内部订阅）：
 *  - 主控页收到 state-mutate/state-snap → 应用到 onRemoteState 回调，返回 true；
 *    收到 cmd → 转 onCommand 回调，返回 true；
 *  - 非主控页经 handle() 本地注入上述消息 → 原样转发 post（汇给主控页），
 *    返回 false；经总线收到（已是总线上的消息）→ 忽略不转发（防多页回环）；
 *  - claim/hello/owner-gone 参与选举；takeover/playback 归 Task 15 引擎归属层。
 */

import type { Bus, BusMsg } from './bus';

export interface LeaderHandle {
  readonly isLeader: boolean;
  /** 本地入口：本地状态变更/命令注入。返回是否在本页（主控页）应用。 */
  handle(m: BusMsg): boolean;
  onRemoteState(h: (k: string, v: unknown) => void): () => void;
  onCommand(h: (m: BusMsg) => void): () => void;
}

/** 主控页心跳间隔（ms）。 */
const HEARTBEAT_MS = 2000;
/** 跟随者巡检间隔（ms）。 */
const WATCH_MS = 1000;
/** 心跳超时 = 3× 心跳间隔（ms），超过即接管重选。 */
const HEARTBEAT_TIMEOUT_MS = HEARTBEAT_MS * 3;

let pageSeq = 0;

export function createLeader(bus: Bus): LeaderHandle {
  const selfId = `yy-page-${++pageSeq}-${Math.random().toString(36).slice(2, 8)}`;
  let myEpoch = Date.now();
  let amLeader = true; // 创建即乐观当选；见到更优 claim 让位
  let leaderFrom: string | null = null; // 跟随中的主控页 id
  let leaderEpoch = Number.POSITIVE_INFINITY; // 跟随中的主控页 epoch
  let lastBeat = Date.now();

  const stateHandlers = new Set<(k: string, v: unknown) => void>();
  const cmdHandlers = new Set<(m: BusMsg) => void>();

  const postClaim = (): void => {
    bus.post({ t: 'claim', epoch: myEpoch, from: selfId });
  };

  /** 让位：跟随 claim 发起者并记录心跳起点。 */
  const yieldTo = (m: Extract<BusMsg, { t: 'claim' }>): void => {
    amLeader = false;
    leaderFrom = m.from;
    leaderEpoch = m.epoch;
    lastBeat = Date.now();
  };

  /** claim 优先级：(epoch, from) 字典序，小者胜。 */
  const outranks = (
    epochA: number,
    fromA: string,
    epochB: number,
    fromB: string,
  ): boolean => epochA < epochB || (epochA === epochB && fromA < fromB);

  /**
   * 消息统一入口。viaBus=true 表示来自总线（真实总线不会回送自身消息，
   * 但测试内存版 bus 会——过滤 from===self 的回声）；false 表示本地注入。
   */
  const ingest = (m: BusMsg, viaBus: boolean): boolean => {
    if (viaBus && m.from === selfId) return false; // 自身回声

    switch (m.t) {
      case 'claim': {
        if (amLeader) {
          if (outranks(m.epoch, m.from, myEpoch, selfId)) {
            yieldTo(m); // 对方 epoch 更小（先创建）→ 让位
          } else {
            postClaim(); // 重申：对方见到更小 epoch 后让位（一轮收敛）
          }
        } else if (
          leaderFrom === null ||
          m.from === leaderFrom ||
          outranks(m.epoch, m.from, leaderEpoch, leaderFrom)
        ) {
          // 无主 / 同一主控重申 / 有更优者出现 → 跟随之
          leaderFrom = m.from;
          leaderEpoch = m.epoch;
          lastBeat = Date.now();
        }
        return false;
      }

      case 'hello': {
        if (amLeader) {
          // 另一个"主控页"在心跳（分脑）：重申 claim 压回，一轮收敛
          postClaim();
        } else if (m.from === leaderFrom) {
          lastBeat = Date.now();
        } else if (leaderFrom === null) {
          // 只见过对方 hello、没见过 claim：先跟随（epoch 未知=∞，后续 claim 可抢）
          leaderFrom = m.from;
          lastBeat = Date.now();
        }
        return false;
      }

      case 'owner-gone': {
        if (!amLeader && m.from === leaderFrom) {
          // 主控页卸载 → 立即重选：乐观自封 + 广播 claim（更优者最终胜出）
          amLeader = true;
          leaderFrom = null;
          leaderEpoch = Number.POSITIVE_INFINITY;
          postClaim();
        }
        return false;
      }

      case 'state-mutate': {
        if (amLeader) {
          for (const h of [...stateHandlers]) h(m.key, m.patch);
          return true;
        }
        if (!viaBus) bus.post(m); // 本地变更 → 汇给主控页
        return false;
      }

      case 'state-snap': {
        if (amLeader) {
          for (const [key, value] of Object.entries(m.snap)) {
            for (const h of [...stateHandlers]) h(key, value);
          }
          return true;
        }
        if (!viaBus) bus.post(m);
        return false;
      }

      case 'cmd': {
        if (amLeader) {
          for (const h of [...cmdHandlers]) h(m);
          return true;
        }
        if (!viaBus) bus.post(m); // 本地命令 → 汇给主控页
        return false;
      }

      // takeover/playback：引擎归属与播放镜像，归 Task 15 ownership 层
      case 'takeover':
      case 'playback':
      default:
        return false;
    }
  };

  // 总线入口：远端消息（含选举）。与页面同生命周期，无需退订。
  bus.on((m) => {
    ingest(m, true);
  });

  // 创建即乐观当选并广播 claim（spec §5.3 协议 6：claim 首者胜）
  postClaim();

  // 主控页心跳：每 2s 广播 hello（仅主控页实际发送）
  setInterval(() => {
    if (amLeader) bus.post({ t: 'hello', from: selfId });
  }, HEARTBEAT_MS);

  // 跟随者巡检：超过 3× 心跳无音讯 → 接管重选（新 epoch=Date.now()）
  setInterval(() => {
    if (!amLeader && leaderFrom !== null && Date.now() - lastBeat >= HEARTBEAT_TIMEOUT_MS) {
      amLeader = true;
      leaderFrom = null;
      leaderEpoch = Number.POSITIVE_INFINITY;
      myEpoch = Date.now();
      postClaim();
    }
  }, WATCH_MS);

  // 卸载广播：主控页关闭 → 其余页立即重选（spec §5.3 协议 6）
  const onUnload = (): void => {
    if (amLeader) bus.post({ t: 'owner-gone', from: selfId });
  };
  window.addEventListener('beforeunload', onUnload);

  return {
    get isLeader(): boolean {
      return amLeader;
    },
    handle(m: BusMsg): boolean {
      return ingest(m, false);
    },
    onRemoteState(h: (k: string, v: unknown) => void): () => void {
      stateHandlers.add(h);
      return () => {
        stateHandlers.delete(h);
      };
    },
    onCommand(h: (m: BusMsg) => void): () => void {
      cmdHandlers.add(h);
      return () => {
        cmdHandlers.delete(h);
      };
    },
  };
}
