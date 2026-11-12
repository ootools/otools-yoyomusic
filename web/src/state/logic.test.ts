/**
 * Task 4 Step 1 失败测试：纯函数逻辑（无 store 依赖）。
 * 断言全部来自计划 Task 4 Step 1 逐字条目 + 边界补钉。
 */
import { describe, expect, it } from 'vitest';

import {
  filterTracks,
  nextIndex,
  prevIndex,
  queueAppend,
  queueInsertAfter,
  queueMove,
  relativeTime,
  type Track,
} from './logic';

// --- nextIndex / prevIndex（移植 Go state.go AdvanceIndex :856-876）---

describe('nextIndex', () => {
  it('sequence 到尾返回 -1 表示停止（调用方停止）', () => {
    expect(nextIndex('sequence', 2, 3)).toBe(-1);
  });

  it('repeat_all 越尾回 0', () => {
    expect(nextIndex('repeat_all', 2, 3)).toBe(0);
  });

  it('repeat_one 原地', () => {
    expect(nextIndex('repeat_one', 1, 3)).toBe(1);
  });

  it('shuffle 前进 (idx+1)%len（到尾回 0）', () => {
    expect(nextIndex('shuffle', 1, 3)).toBe(2);
    expect(nextIndex('shuffle', 2, 3)).toBe(0);
  });

  it('空列表一律 -1', () => {
    expect(nextIndex('sequence', 0, 0)).toBe(-1);
    expect(nextIndex('repeat_all', 0, 0)).toBe(-1);
    expect(nextIndex('repeat_one', 0, 0)).toBe(-1);
    expect(nextIndex('shuffle', 0, 0)).toBe(-1);
  });

  it('sequence 未到尾正常前进', () => {
    expect(nextIndex('sequence', 0, 3)).toBe(1);
  });
});

describe('prevIndex', () => {
  // 计划注：>3s 重播语义在 store 层（Go app.go:401-407），纯函数只管索引。
  it('sequence 在首返回 -1 表示停止', () => {
    expect(prevIndex('sequence', 0, 3)).toBe(-1);
  });

  it('repeat_all 越首回尾', () => {
    expect(prevIndex('repeat_all', 0, 3)).toBe(2);
  });

  it('repeat_one 原地', () => {
    expect(prevIndex('repeat_one', 1, 3)).toBe(1);
  });

  it('shuffle 后退 (idx-1+len)%len', () => {
    expect(prevIndex('shuffle', 0, 3)).toBe(2);
    expect(prevIndex('shuffle', 2, 3)).toBe(1);
  });

  it('空列表一律 -1；sequence 未到首正常后退', () => {
    expect(prevIndex('sequence', 1, 0)).toBe(-1);
    expect(prevIndex('sequence', 1, 3)).toBe(0);
  });
});

// --- 队列（移植 Go state.go QueueNext :500-577 / MoveTrackUp/Down）---

describe('queueInsertAfter', () => {
  it('已存在→移动到 anchor 后（计划逐字断言）', () => {
    expect(queueInsertAfter(['a', 'b', 'c'], 'b', 'c')).toEqual(['a', 'b', 'c']);
  });

  it('anchorId=null→队首（计划约定；Go 原版无播放时插队尾，以计划为准）', () => {
    expect(queueInsertAfter(['a', 'b'], null, 'x')).toEqual(['x', 'a', 'b']);
  });

  it('不存在→插到 anchor 之后', () => {
    expect(queueInsertAfter(['a', 'b', 'c'], 'a', 'x')).toEqual(['a', 'x', 'b', 'c']);
  });

  it('anchor 在队列中缺失→追加到末尾（Go 无 anchor 兜底语义）', () => {
    expect(queueInsertAfter(['a', 'b'], 'zz', 'c')).toEqual(['a', 'b', 'c']);
  });

  it('空队列 + null anchor', () => {
    expect(queueInsertAfter([], null, 'x')).toEqual(['x']);
  });

  it('不改变原数组（纯函数）', () => {
    const q = ['a', 'b'];
    queueInsertAfter(q, 'a', 'x');
    expect(q).toEqual(['a', 'b']);
  });
});

describe('queueAppend', () => {
  it('追加到末尾', () => {
    expect(queueAppend(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
  });

  it('已存在→原样返回（Go AddToPlaylist 对重复静默跳过，审查修正）', () => {
    expect(queueAppend(['a', 'b', 'c'], 'a')).toEqual(['a', 'b', 'c']);
    expect(queueAppend(['a', 'b'], 'b')).toEqual(['a', 'b']);
  });

  it('空队列', () => {
    expect(queueAppend([], 'x')).toEqual(['x']);
  });
});

describe('queueMove', () => {
  it('中间元素 delta=1 与后一位交换', () => {
    expect(queueMove(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
    expect(queueMove(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
  });

  it('中间元素 delta=-1 与前一位交换', () => {
    expect(queueMove(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(queueMove(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
  });

  it('首元素 delta=-1 不动、末元素 delta=1 不动（边界）', () => {
    expect(queueMove(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(queueMove(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
  });

  it('id 不在队列→原样返回', () => {
    expect(queueMove(['a', 'b'], 'zz', 1)).toEqual(['a', 'b']);
  });

  it('不改变原数组（纯函数）', () => {
    const q = ['a', 'b', 'c'];
    queueMove(q, 'a', 1);
    expect(q).toEqual(['a', 'b', 'c']);
  });
});

// --- filterTracks（title/artist/album 大小写不敏感子串，Go view.go:1250 附近）---

function track(partial: Partial<Track> & { id: string }): Track {
  return {
    path: partial.id,
    title: '',
    artist: '',
    album: '',
    durationMs: 0,
    status: 'ok',
    liked: false,
    hasLyrics: false,
    ...partial,
  };
}

describe('filterTracks', () => {
  const tracks: Track[] = [
    track({ id: '1', title: 'Love Story', artist: 'Taylor Swift', album: 'Fearless' }),
    track({ id: '2', title: '夜曲', artist: '周杰伦', album: '十一月的萧邦' }),
    track({ id: '3', title: 'Blank Space', artist: 'TAYLOR SWIFT', album: '1989' }),
  ];

  it('空串返回全部', () => {
    expect(filterTracks(tracks, '')).toHaveLength(3);
  });

  it('title 大小写不敏感子串', () => {
    expect(filterTracks(tracks, 'LOVE').map((t) => t.id)).toEqual(['1']);
    expect(filterTracks(tracks, 'space').map((t) => t.id)).toEqual(['3']);
  });

  it('artist 大小写不敏感子串', () => {
    expect(filterTracks(tracks, 'swift').map((t) => t.id)).toEqual(['1', '3']);
  });

  it('album 子串', () => {
    expect(filterTracks(tracks, '萧邦').map((t) => t.id)).toEqual(['2']);
    expect(filterTracks(tracks, '1989').map((t) => t.id)).toEqual(['3']);
  });

  it('无命中→空数组', () => {
    expect(filterTracks(tracks, 'zzz')).toEqual([]);
  });

  it('保持输入顺序', () => {
    expect(filterTracks(tracks, 'aylor').map((t) => t.id)).toEqual(['1', '3']);
  });
});

// --- relativeTime（Go view.go relTime :1255-1276）---

describe('relativeTime', () => {
  const now = Date.parse('2026-11-13T12:00:00Z');

  it('计划逐字断言：30 秒前→刚刚', () => {
    expect(relativeTime(now - 30_000, now)).toBe('刚刚');
  });

  it('计划逐字断言：40 分钟前→40分钟前', () => {
    expect(relativeTime(now - 40 * 60_000, now)).toBe('40分钟前');
  });

  it('计划逐字断言：25 小时前→1天前', () => {
    expect(relativeTime(now - 25 * 3600_000, now)).toBe('1天前');
  });

  it('1 小时前→1小时前', () => {
    expect(relativeTime(now - 90 * 60_000, now)).toBe('1小时前');
  });

  it('3 天前→3天前', () => {
    expect(relativeTime(now - 3 * 24 * 3600_000, now)).toBe('3天前');
  });

  it('超过约 30 天→MM-DD（零填充）', () => {
    const ts = Date.parse('2026-03-05T00:00:00Z');
    expect(relativeTime(ts, now)).toBe('03-05');
  });

  it('未来时间按刚刚（Go: d<0 → 0）', () => {
    expect(relativeTime(now + 60_000, now)).toBe('刚刚');
  });

  it('ms<=0 → 空串（Go: 返回 ""）', () => {
    expect(relativeTime(0, now)).toBe('');
    expect(relativeTime(-1, now)).toBe('');
  });
});
