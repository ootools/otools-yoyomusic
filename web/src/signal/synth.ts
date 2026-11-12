/**
 * 合成信号适配层（spec §6.3 / 计划 Task 8）：makeSynth(seed) 薄包装移植的
 * SignalEngine（engine.ts，源自 tauri 分支 signal.ts）。
 *
 * 按曲目 id 种子生成带 BPM/粉噪倾斜的伪音乐信号——浏览器直开、无实时频谱
 * （如宿主 audio 会话被节流）与暂停态 idle 呼吸的信号源：playing=false 时
 * 频谱松弛成慢速呼吸（beat 恒 0），true 时按 BPM（92–138）周期起拍。
 * 帧对象为引擎就地复用（零分配），消费方按帧读取即可。
 */

import { SignalEngine } from './engine';
import type { SignalFrame } from './engine';

export type { SignalFrame };

export function makeSynth(seed: string): { update(dt: number, playing: boolean): SignalFrame } {
  const engine = new SignalEngine(seed);
  return {
    update: (dt, playing) => engine.update(dt, playing, null),
  };
}
