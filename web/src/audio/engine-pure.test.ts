/**
 * Task 7 Step 2 失败测试：引擎纯函数（计划 Task 7 逐字条目 + 四分支）。
 *  - unmuteVolume：静音取消时 v===0 → 0.5（spec §6.2，Go ToggleMute
 *    app.go:495-505 "Unmuting restores the previous volume when it had been
 *    dragged to zero"）；
 *  - shouldRecordResume：>5s 且距尾 >2s 才记（spec §6.2 / Go SetResume）。
 *
 * AudioEngine 类本身（Web Audio 链/媒体元素事件）不在此盖：jsdom 无 WebAudio，
 * 整链行为列入 Task 16 宿主冒烟（计划 Task 7 Step 4）。
 */
import { describe, expect, it } from 'vitest';

import type { BlobTransport } from './transport';
import { AudioEngine, shouldRecordResume, unmuteVolume } from './engine';

/** jsdom 下的最小 transport 桩（闩锁测试只经 getAnalyserFrame 触发 ensureGraph）。 */
function stubTransport(): BlobTransport {
  return {
    resolve: async () => '',
    readBytes: async () => new Uint8Array(),
    revoke: () => {},
    prime: () => {},
  };
}

describe('unmuteVolume（四分支）', () => {
  it('分支①：静音→取消 且 v=0 → 0.5（用户不被滑条困死）', () => {
    expect(unmuteVolume(0, true, false)).toBe(0.5);
  });

  it('分支②：静音→取消 且 v>0 → 保持原音量', () => {
    expect(unmuteVolume(0.3, true, false)).toBe(0.3);
    expect(unmuteVolume(1, true, false)).toBe(1);
  });

  it('分支③：静音→仍静音 / 未静音→静音 → 音量不动', () => {
    expect(unmuteVolume(0, true, true)).toBe(0);
    expect(unmuteVolume(0.6, false, true)).toBe(0.6);
  });

  it('分支④：保持未静音 → 音量不动（v=0 也不触发恢复）', () => {
    expect(unmuteVolume(0, false, false)).toBe(0);
    expect(unmuteVolume(0.3, false, false)).toBe(0.3);
  });

  it('Go 口径 Volume<=0 都恢复 0.5（防御越界输入）', () => {
    expect(unmuteVolume(-0.1, true, false)).toBe(0.5);
  });
});

describe('shouldRecordResume（计划逐字 + 边界）', () => {
  it('计划逐字：3000/200000→false、6000/200000→true、6000/7000→false', () => {
    expect(shouldRecordResume(3000, 200000)).toBe(false);
    expect(shouldRecordResume(6000, 200000)).toBe(true);
    expect(shouldRecordResume(6000, 7000)).toBe(false);
  });

  it('≤5s 边界：5000→false、5001→true（Go SetResume ms<=5000 不记）', () => {
    expect(shouldRecordResume(5000, 200000)).toBe(false);
    expect(shouldRecordResume(5001, 200000)).toBe(true);
  });

  it('距尾边界：2000→false、2001→true（Go SetResume ms>=dur-2000 不记）', () => {
    expect(shouldRecordResume(198000, 200000)).toBe(false); // 距尾恰 2000
    expect(shouldRecordResume(197999, 200000)).toBe(true); // 距尾 2001
  });

  it('未知时长（durMs=0）只按 >5s 判定（Go durationMs>0 守卫，与 store.recordResume 同口径）', () => {
    expect(shouldRecordResume(6000, 0)).toBe(true);
    expect(shouldRecordResume(3000, 0)).toBe(false);
  });
});

describe('AudioEngine 建链失败永久闩锁（Task 7 审查非阻塞 #2）', () => {
  it('ensureGraph 构造抛异常后闩锁：只尝试构造一次，之后 getAnalyserFrame 直控降级', () => {
    // jsdom 本无 AudioContext：注入必抛的假构造器，用调用计数打点降级路径
    const win = window as unknown as Record<string, unknown>;
    const had = Object.prototype.hasOwnProperty.call(win, 'AudioContext');
    const saved = win.AudioContext;
    let attempts = 0;
    win.AudioContext = class {
      constructor() {
        attempts += 1;
        throw new Error('boom');
      }
    };
    try {
      const el = document.createElement('audio');
      const engine = new AudioEngine(el, () => null, { transport: stubTransport() });

      expect(engine.getAnalyserFrame()).toBeNull(); // 第一次：尝试建链 → 抛 → 落闩锁
      expect(engine.getAnalyserFrame()).toBeNull(); // 第二次：闩锁生效，不再尝试
      expect(attempts).toBe(1); // 只尝试一次（修复前：每次拉帧都会重试构造）
    } finally {
      if (had) win.AudioContext = saved;
      else delete win.AudioContext;
    }
  });
});
