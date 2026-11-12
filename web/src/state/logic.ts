/**
 * Task 4 纯函数层（无 store 依赖，便于单测）。
 *
 * 语义对照 Go 原版（D:\Repos\xyito\lingyun\YoYoMusic）：
 *  - nextIndex/prevIndex ← state.go AdvanceIndex :856-876
 *  - queueInsertAfter    ← state.go QueueNext :500-577（差异见函数注）
 *  - queueMove           ← state.go MoveTrackUp/MoveTrackDown :533-577
 *  - filterTracks        ← ui/view.go trackFilters :1250 附近
 *  - relativeTime        ← ui/view.go relTime :1255-1276
 * 计划与 Go 不一致处以计划为准（queueInsertAfter 的 null→队首，Go 为队尾）。
 */

export type PlayMode = 'sequence' | 'repeat_all' | 'repeat_one' | 'shuffle';
export type TrackStatus = 'ok' | 'bad' | 'missing';

export interface Track {
  id: string; // = 绝对路径（spec §10.1）
  path: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  status: TrackStatus;
  liked: boolean;
  coverThumb?: string;
  hasLyrics: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  currentIndex: number;
  playMode: PlayMode;
}

/**
 * 下一首索引。返回约定：sequence 到尾返回 -1，调用方停止（计划 Task 4 Step 1）。
 * 移植 Go state.go AdvanceIndex：repeat_one 原地、shuffle (idx+1)%len、
 * repeat_all 越尾回 0、sequence 越尾 -1。
 */
export function nextIndex(mode: PlayMode, idx: number, len: number): number {
  if (len <= 0) return -1;
  switch (mode) {
    case 'repeat_one':
      return idx; // 原地（调用方负责重播）
    case 'shuffle':
      return (((idx + 1) % len) + len) % len;
    default: {
      const ni = idx + 1;
      if (ni >= len) return mode === 'repeat_all' ? 0 : -1;
      return ni;
    }
  }
}

/**
 * 上一首索引。返回约定与 nextIndex 相同（sequence 到首 -1）。
 * 注意：">3s 回 0 而非切曲"的重播语义在 store 层（Go app.go Prev :401-407），
 * 这里只做纯索引计算。
 */
export function prevIndex(mode: PlayMode, idx: number, len: number): number {
  if (len <= 0) return -1;
  switch (mode) {
    case 'repeat_one':
      return idx;
    case 'shuffle':
      return (((idx - 1) % len) + len) % len;
    default: {
      const ni = idx - 1;
      if (ni < 0) return mode === 'repeat_all' ? len - 1 : -1;
      return ni;
    }
  }
}

/**
 * "下一首播放"：先摘除 id（已存在→移动而非重复），再插到 anchor 之后。
 *  - anchorId=null → 队首（计划拍板；Go 原版无播放时插队尾，语义偏差已报告）。
 *  - anchor 在队列中缺失 → 追加到末尾（对齐 Go 无 anchor 的兜底去向）。
 * 纯函数，返回新数组。
 */
export function queueInsertAfter(queue: string[], anchorId: string | null, id: string): string[] {
  const out = queue.filter((x) => x !== id);
  if (!id) return out;
  let insert: number;
  if (anchorId === null) {
    insert = 0; // 计划约定：无 anchor → 队首
  } else {
    const ai = out.indexOf(anchorId);
    insert = ai >= 0 ? ai + 1 : out.length; // anchor 缺失 → 末尾（Go 兜底）
  }
  out.splice(insert, 0, id);
  return out;
}

/**
 * "加到队列末尾"：已存在 → 静默跳过（对齐 Go AddToPlaylist :459-470 对重复的
 * no-op，审查修正：初版误为移到末尾）。纯函数。
 */
export function queueAppend(queue: string[], id: string): string[] {
  if (!id || queue.includes(id)) return queue.slice();
  return [...queue, id];
}

/**
 * 上/下移一格（delta=-1 上移与前任交换、+1 下移与后继交换，Go MoveTrackUp/Down）。
 * 越界（首上移/末下移）或 id 不在队列 → 原样返回。
 * "光标跟随"由调用方完成：store 层在移动后把游标重指向播放中曲目新下标
 * （与 Go 的 CurrentIndex==i / i±1 分支完全等价，见 store.ts queueOps.move）。
 */
export function queueMove(queue: string[], id: string, delta: 1 | -1): string[] {
  const i = queue.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= queue.length) return queue.slice();
  const out = queue.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** 曲库过滤：title/artist/album 大小写不敏感子串（Go view.go）。空串返回全部。 */
export function filterTracks(tracks: Track[], q: string): Track[] {
  const query = q.toLowerCase();
  if (!query) return tracks.slice();
  return tracks.filter(
    (t) =>
      t.title.toLowerCase().includes(query) ||
      t.artist.toLowerCase().includes(query) ||
      t.album.toLowerCase().includes(query),
  );
}

/**
 * 相对时间（Go view.go relTime :1255-1276）：
 * 刚刚 / N分钟前 / N小时前 / N天前 / MM-DD（约 30 天外）。
 * 未来时间按刚刚；ts<=0 返回空串。
 */
export function relativeTime(ts: number, now: number): string {
  if (ts <= 0) return '';
  let d = now - ts;
  if (d < 0) d = 0;
  const m = Math.floor(d / 60_000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}分钟前`;
  if (m < 1440) return `${Math.floor(m / 60)}小时前`;
  if (m < 43_200) return `${Math.floor(m / 1440)}天前`; // ~30 天
  const dt = new Date(ts);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

/** 从路径取文件名去扩展名（导入建行的 title 兜底，Task 6 约定）。 */
export function titleFromPath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}
