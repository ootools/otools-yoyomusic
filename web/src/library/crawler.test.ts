/**
 * Task 6 Step 1 失败测试：元数据爬虫（计划 Task 6 逐字条目 + Review Focus #3）。
 * mock transport / parseMetadata，覆盖：
 * ① 10 path 并发峰值 ≤2；② isCancelled 后不再 onTrack；③ priority 置顶完成顺序；
 * ④ 读失败 → 'missing'；⑤ parseMetadata unknown → 'bad'；
 * ⑥ 有 coverBytes → onThumb 收到 jpeg dataURL 前缀（jsdom 无 createImageBitmap 时 stub）；
 * ⑦ 无 createImageBitmap 环境（jsdom 默认）→ 缩略图优雅降级不回调不炸。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AudioTransport } from '../audio/transport';
import { createCrawler, makeThumb, type CrawlMeta } from './crawler';

// parseMetadata 打桩：爬虫按路径/用例注入不同解析结果
const parseMetadataMock = vi.hoisted(() => vi.fn());
vi.mock('../audio/metadata', () => ({ parseMetadata: parseMetadataMock }));

const OK_META = { kind: 'mp3' as const, title: 'T', artist: 'A', album: 'AL', durationMs: 1234 };

/** 造一个记录型 transport：resolve/revoke 空转，readBytes 由用例注入。 */
function makeTransport(readBytes: (path: string) => Promise<Uint8Array>): AudioTransport {
  return {
    resolve: vi.fn(async (path: string) => path),
    readBytes,
    revoke: vi.fn(),
  };
}

/** 造爬虫并记录回调参数。 */
function makeCrawler(
  transport: AudioTransport,
  isCancelled: () => boolean = () => false,
  priority: () => string[] | null = () => null,
) {
  const onTrack = vi.fn<(path: string, meta: CrawlMeta) => void>();
  const onThumb = vi.fn<(path: string, dataUrl: string) => void>();
  const crawler = createCrawler({ transport, concurrency: 2, onTrack, onThumb, isCancelled, priority });
  return { crawler, onTrack, onThumb };
}

/** 记录峰值并发的慢 readBytes（真实定时器 5ms，保证两个 worker 重叠）。 */
function slowCountingRead() {
  let active = 0;
  let peak = 0;
  const readBytes = async (): Promise<Uint8Array> => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active -= 1;
    return new Uint8Array([1]);
  };
  return { readBytes, peakOf: () => peak };
}

beforeEach(() => {
  parseMetadataMock.mockReset();
  parseMetadataMock.mockImplementation((_bytes: Uint8Array, fileName: string) => ({
    ...OK_META,
    title: fileName,
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('并发（计划 ①）', () => {
  it('10 个 path 并发峰值 ≤2 且全部完成', async () => {
    const { readBytes, peakOf } = slowCountingRead();
    const { crawler, onTrack } = makeCrawler(makeTransport(readBytes));

    crawler.push(['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9']);
    await crawler.done;

    expect(peakOf()).toBe(2); // 恰好吃满 concurrency=2，不超
    expect(onTrack).toHaveBeenCalledTimes(10);
    expect(onTrack.mock.calls.every(([, meta]) => meta.status === 'ok')).toBe(true);
  });

  it('默认并发为 2（不传 concurrency）', async () => {
    const { readBytes, peakOf } = slowCountingRead();
    const onTrack = vi.fn<(path: string, meta: CrawlMeta) => void>();
    const crawler = createCrawler({
      transport: makeTransport(readBytes),
      onTrack,
      onThumb: vi.fn(),
      isCancelled: () => false,
      priority: () => null,
    });
    crawler.push(['a', 'b', 'c']);
    await crawler.done;
    expect(peakOf()).toBe(2);
    expect(onTrack).toHaveBeenCalledTimes(3);
  });
});

describe('取消（计划 ②）', () => {
  it('isCancelled 置 true 后不再产生 onTrack（在途项也静默）', async () => {
    let cancelled = false;
    const gates: Array<() => void> = [];
    const transport = makeTransport(
      () =>
        new Promise<Uint8Array>((resolve) => {
          gates.push(() => resolve(new Uint8Array([1])));
        }),
    );
    const { crawler, onTrack } = makeCrawler(transport, () => cancelled);

    crawler.push(['p0', 'p1', 'p2', 'p3', 'p4']);
    // 两个 worker 已挂起在 readBytes 上
    expect(gates.length).toBe(2);

    cancelled = true;
    crawler.cancel();
    for (const g of gates) g(); // 在途读全部落地
    await crawler.done;

    expect(onTrack).not.toHaveBeenCalled();
  });

  it('取消前已完成的项不受影响，之后不再回调', async () => {
    let cancelled = false;
    const gates: Array<() => void> = [];
    const transport = makeTransport(
      () =>
        new Promise<Uint8Array>((resolve) => {
          gates.push(() => resolve(new Uint8Array([1])));
        }),
    );
    const { crawler, onTrack } = makeCrawler(transport, () => cancelled);

    crawler.push(['first', 'a', 'b']);
    gates[0]?.(); // 第一项完成 → onTrack 一次
    await vi.waitFor(() => expect(onTrack).toHaveBeenCalledTimes(1));
    expect(onTrack.mock.calls[0]?.[0]).toBe('first');

    cancelled = true;
    crawler.cancel();
    for (const g of gates) g(); // 其余在途项落地但必须静默
    await crawler.done;
    expect(onTrack).toHaveBeenCalledTimes(1);
  });

  it('isCancelled 一开始就 true → push 空转、done 立即 resolve', async () => {
    const transport = makeTransport(async () => new Uint8Array([1]));
    const { crawler, onTrack } = makeCrawler(transport, () => true);
    crawler.push(['x', 'y']);
    await crawler.done;
    expect(onTrack).not.toHaveBeenCalled();
  });
});

describe('优先级（计划 ③）', () => {
  it('priority() 返回的可见行先完成（完成顺序前 2 个断言）', async () => {
    const completed: string[] = [];
    const { crawler, onTrack } = makeCrawler(
      makeTransport(async () => new Uint8Array([1])),
      () => false,
      () => ['p5', 'p7'],
    );
    onTrack.mockImplementation((path: string) => completed.push(path));

    crawler.push(['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9']);
    await crawler.done;

    expect(completed.slice(0, 2)).toEqual(['p5', 'p7']);
    expect(completed.slice(2).sort()).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p6', 'p8', 'p9']);
  });

  it('priority() 含不在队列的 path → 忽略，按 FIFO', async () => {
    const completed: string[] = [];
    const { crawler, onTrack } = makeCrawler(
      makeTransport(async () => new Uint8Array([1])),
      () => false,
      () => ['ghost', 'a'],
    );
    onTrack.mockImplementation((path: string) => completed.push(path));

    crawler.push(['a', 'b', 'c']);
    await crawler.done;
    expect(completed).toEqual(['a', 'b', 'c']);
  });

  it('priority() 返回 null → FIFO', async () => {
    const completed: string[] = [];
    const { crawler, onTrack } = makeCrawler(
      makeTransport(async () => new Uint8Array([1])),
      () => false,
      () => null,
    );
    onTrack.mockImplementation((path: string) => completed.push(path));

    crawler.push(['a', 'b', 'c']);
    await crawler.done;
    expect(completed).toEqual(['a', 'b', 'c']);
  });
});

describe('失败标记（计划 ④⑤，Review Focus #3）', () => {
  it('readBytes reject → onTrack 收到 status:"missing"，不抛', async () => {
    const transport = makeTransport(async (path) => {
      if (path === 'D:/gone.mp3') throw new Error('read failed');
      return new Uint8Array([1]);
    });
    const { crawler, onTrack, onThumb } = makeCrawler(transport);

    crawler.push(['D:/gone.mp3', 'D:/ok.mp3']);
    await crawler.done;

    expect(onTrack).toHaveBeenCalledWith('D:/gone.mp3', { status: 'missing' });
    expect(onTrack).toHaveBeenCalledWith(
      'D:/ok.mp3',
      expect.objectContaining({ status: 'ok' }),
    );
    expect(onThumb).not.toHaveBeenCalled();
  });

  it('parseMetadata unknown → onTrack 收到 status:"bad"', async () => {
    parseMetadataMock.mockImplementation((_bytes: Uint8Array, fileName: string) =>
      fileName === 'u1' ? { kind: 'unknown', title: fileName } : { ...OK_META, title: fileName },
    );
    const transport = makeTransport(async () => new Uint8Array([1]));
    const { crawler, onTrack, onThumb } = makeCrawler(transport);

    crawler.push(['u1', 'good1']);
    await crawler.done;

    expect(onTrack).toHaveBeenCalledWith('u1', { status: 'bad' });
    expect(onTrack).toHaveBeenCalledWith(
      'good1',
      expect.objectContaining({ status: 'ok', title: 'good1' }),
    );
    expect(onThumb).not.toHaveBeenCalled();
  });

  it('成功回填携带 title/artist/album/durationMs/hasLyrics', async () => {
    parseMetadataMock.mockImplementation(() => ({
      kind: 'flac' as const,
      title: '晴天',
      artist: '周杰伦',
      album: '叶惠美',
      durationMs: 269000,
      lyricsText: '[00:01]x',
    }));
    const transport = makeTransport(async () => new Uint8Array([1]));
    const { crawler, onTrack } = makeCrawler(transport);

    crawler.push(['D:/m/晴天.flac']);
    await crawler.done;

    expect(onTrack).toHaveBeenCalledWith('D:/m/晴天.flac', {
      status: 'ok',
      title: '晴天',
      artist: '周杰伦',
      album: '叶惠美',
      durationMs: 269000,
      hasLyrics: true,
    });
  });
});

describe('封面缩略图（计划 ⑥，spec §6.4：96×96 JPEG q0.75）', () => {
  /** stub createImageBitmap + canvas（jsdom 无位图实现）。返回探针便于断言。 */
  function stubBitmapAndCanvas(): {
    drawImage: ReturnType<typeof vi.fn>;
    bitmap: { width: number; height: number; close: ReturnType<typeof vi.fn> };
  } {
    const bitmap = { width: 300, height: 200, close: vi.fn() };
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap),
    );
    const drawImage = vi.fn();
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toDataURL: vi.fn(() => 'data:image/jpeg;base64,/9j/4AAQSkY='),
    } as unknown as HTMLCanvasElement;
    const original = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(
      ((tag: string, options?: ElementCreationOptions) => {
        if (tag === 'canvas') return fakeCanvas;
        return original(tag, options);
      }) as typeof document.createElement,
    );
    return { drawImage, bitmap };
  }

  it('有 coverBytes → onThumb 收到 jpeg dataURL 前缀，且 96×96 居中裁切', async () => {
    parseMetadataMock.mockImplementation(() => ({
      ...OK_META,
      coverBytes: new Uint8Array([9, 9, 9]),
    }));
    const { drawImage, bitmap } = stubBitmapAndCanvas();
    const transport = makeTransport(async () => new Uint8Array([1]));
    const { crawler, onTrack, onThumb } = makeCrawler(transport);

    crawler.push(['D:/m/cover.mp3']);
    await crawler.done;

    expect(onThumb).toHaveBeenCalledTimes(1);
    const [path, dataUrl] = onThumb.mock.calls[0] ?? ['', ''];
    expect(path).toBe('D:/m/cover.mp3');
    expect(dataUrl.startsWith('data:image/jpeg')).toBe(true);
    // 居中裁切：300×200 → 取中央 200×200（sx=50, sy=0）缩放到 96×96
    expect(drawImage).toHaveBeenCalledWith(bitmap, 50, 0, 200, 200, 0, 0, 96, 96);
    expect(bitmap.close).toHaveBeenCalled();
    expect(onTrack).toHaveBeenCalledWith(
      'D:/m/cover.mp3',
      expect.objectContaining({ status: 'ok' }),
    );
  });

  it('jsdom 默认（无 createImageBitmap）→ 缩略图优雅降级，onThumb 不回调、曲目照常回填', async () => {
    parseMetadataMock.mockImplementation(() => ({
      ...OK_META,
      coverBytes: new Uint8Array([1, 2, 3]),
    }));
    const transport = makeTransport(async () => new Uint8Array([1]));
    const { crawler, onTrack, onThumb } = makeCrawler(transport);

    crawler.push(['D:/m/nocanvas.mp3']);
    await crawler.done;

    expect(onThumb).not.toHaveBeenCalled();
    expect(onTrack).toHaveBeenCalledWith(
      'D:/m/nocanvas.mp3',
      expect.objectContaining({ status: 'ok' }),
    );
  });

  it('canvas 2d 上下文缺失（getContext→null）→ 不回调 onThumb 不炸', async () => {
    parseMetadataMock.mockImplementation(() => ({
      ...OK_META,
      coverBytes: new Uint8Array([1, 2, 3]),
    }));
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 10, height: 10, close: vi.fn() })));
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => null),
      toDataURL: vi.fn(() => 'data:,'),
    } as unknown as HTMLCanvasElement;
    const original = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'canvas') return fakeCanvas;
      return original(tag);
    }) as typeof document.createElement);

    const transport = makeTransport(async () => new Uint8Array([1]));
    const { crawler, onTrack, onThumb } = makeCrawler(transport);
    crawler.push(['D:/m/noctx.mp3']);
    await crawler.done;

    expect(onThumb).not.toHaveBeenCalled();
    expect(onTrack).toHaveBeenCalledTimes(1);
  });

  it('makeThumb 可直接导出使用：返回 toDataURL 结果', async () => {
    stubBitmapAndCanvas();
    await expect(makeThumb(new Uint8Array([1]))).resolves.toBe(
      'data:image/jpeg;base64,/9j/4AAQSkY=',
    );
  });
});

describe('健壮性', () => {
  it('重复 push 同一 path → 每条都处理（去重由导入层负责）', async () => {
    const transport = makeTransport(async () => new Uint8Array([1]));
    const { crawler, onTrack } = makeCrawler(transport);
    crawler.push(['a']);
    crawler.push(['a']);
    await crawler.done;
    expect(onTrack).toHaveBeenCalledTimes(2);
  });

  it('空 push → done 立即 resolve', async () => {
    const transport = makeTransport(async () => new Uint8Array([1]));
    const { crawler, onTrack } = makeCrawler(transport);
    crawler.push([]);
    await crawler.done;
    expect(onTrack).not.toHaveBeenCalled();
  });

  it('cancel 后 push 被忽略，done 仍 resolve', async () => {
    const transport = makeTransport(async () => new Uint8Array([1]));
    const { crawler, onTrack } = makeCrawler(transport);
    crawler.cancel();
    crawler.push(['a']);
    await crawler.done;
    expect(onTrack).not.toHaveBeenCalled();
  });
});
