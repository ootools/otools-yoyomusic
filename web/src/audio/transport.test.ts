/**
 * Task 6 Step 2 失败测试：Blob 传输层（计划 Task 6 逐字条目 + Review Focus #1）。
 *  - resolve：宿主 dataBase64 "//uQxg==" → blob: URL，Blob 字节解码正确
 *    （计划原样写的是 "//uQx"，长度 5 非法 base64（mod 4=1）atob 必抛，
 *    等价换成合法样本 "//uQxg=="，偏差已记录）；
 *  - revoke 调 URL.revokeObjectURL（stub）；
 *  - prime('a') 后 resolve('a') 不再触发第二次底层读；换曲即换（容量 1）；
 *  - blob: 前缀条目直接作为 resolve 结果（浏览器降级约定，无宿主读盘）；
 *  - readBytes 透传 readFileBytes；blob: 条目走 fetch。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getFallbackFile, registerFallbackFile, releaseFallbackFile } from '../bridge/otools';
import { createBlobTransport } from './transport';

/* ------------------------------------------------------------------ *
 * jsdom 环境脚手架：注入假宿主 + stub URL.createObjectURL/revokeObjectURL
 * ------------------------------------------------------------------ */

interface SavedGlobal {
  key: string;
  had: boolean;
  value: unknown;
}

const savedGlobals: SavedGlobal[] = [];

function setGlobal(key: string, value: unknown): void {
  const target = window as unknown as Record<string, unknown>;
  if (!savedGlobals.some((s) => s.key === key)) {
    savedGlobals.push({
      key,
      had: Object.prototype.hasOwnProperty.call(target, key),
      value: target[key],
    });
  }
  target[key] = value;
}

afterEach(() => {
  for (const { key, had, value } of savedGlobals.reverse()) {
    if (key === '__URL__createObjectURL') {
      const urlTarget = URL as unknown as Record<string, unknown>;
      if (had) urlTarget.createObjectURL = value as typeof URL.createObjectURL;
      else delete urlTarget.createObjectURL;
      continue;
    }
    if (key === '__URL__revokeObjectURL') {
      const urlTarget = URL as unknown as Record<string, unknown>;
      if (had) urlTarget.revokeObjectURL = value as typeof URL.revokeObjectURL;
      else delete urlTarget.revokeObjectURL;
      continue;
    }
    const target = window as unknown as Record<string, unknown>;
    if (had) target[key] = value;
    else delete target[key];
  }
  savedGlobals.length = 0;
  vi.restoreAllMocks();
});

/** 注入宿主：readHostFile 按路径返回 dataBase64；返回 spy 便于断言读取次数。 */
function installHost(dataBase64For: (path: string) => string): { readHostFile: ReturnType<typeof vi.fn> } {
  const readHostFile = vi.fn(async (path: string) => ({ dataBase64: dataBase64For(path) }));
  setGlobal('otools', { readHostFile });
  return { readHostFile };
}

interface CapturedBlob {
  url: string;
  blob: Blob;
}

/** stub URL.createObjectURL/revokeObjectURL；返回捕获列表与 revoke 记录。 */
function stubObjectURL(): { captured: CapturedBlob[]; revoked: string[] } {
  const captured: CapturedBlob[] = [];
  const revoked: string[] = [];
  const urlTarget = URL as unknown as Record<string, unknown>;
  const hadCreate = Object.prototype.hasOwnProperty.call(urlTarget, 'createObjectURL');
  const hadRevoke = Object.prototype.hasOwnProperty.call(urlTarget, 'revokeObjectURL');
  savedGlobals.push({ key: '__URL__createObjectURL', had: hadCreate, value: urlTarget.createObjectURL });
  savedGlobals.push({ key: '__URL__revokeObjectURL', had: hadRevoke, value: urlTarget.revokeObjectURL });
  urlTarget.createObjectURL = (blob: Blob) => {
    const url = `blob:mock-${captured.length}`;
    captured.push({ url, blob });
    return url;
  };
  urlTarget.revokeObjectURL = (url: string) => {
    revoked.push(url);
  };
  return { captured, revoked };
}

/** FileReader 读出 Blob 原始字节（jsdom 完整实现 FileReader）。 */
function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(new Uint8Array(fr.result as ArrayBuffer));
    fr.onerror = () => reject(fr.error ?? new Error('read error'));
    fr.readAsArrayBuffer(blob);
  });
}

/** 排空若干轮微任务（让被顶掉的预读 revoke 落地）。 */
async function flushMicrotasks(times = 6): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

/* ------------------------------------------------------------------ *
 * resolve / revoke / 解码
 * ------------------------------------------------------------------ */

describe('resolve：整读→base64 解码→Blob→objectURL', () => {
  it('base64 "//uQxg==" 解码正确并返回 blob: URL（MIME 按扩展名）', async () => {
    const { readHostFile } = installHost(() => '//uQxg==');
    const { captured } = stubObjectURL();
    const t = createBlobTransport();

    const url = await t.resolve('D:/m/a.mp3');

    expect(url).toBe('blob:mock-0');
    expect(readHostFile).toHaveBeenCalledTimes(1);
    expect(readHostFile).toHaveBeenCalledWith('D:/m/a.mp3');
    expect(captured).toHaveLength(1);
    expect(captured[0]?.blob.size).toBe(4);
    expect(captured[0]?.blob.type).toBe('audio/mpeg');
    expect(Array.from(await blobBytes(captured[0]!.blob))).toEqual([255, 251, 144, 198]); // //uQxg== → FF FB 90 C6
  });

  it('flac 扩展名 → audio/flac；未知扩展名 → 无 MIME（交给浏览器嗅探）', async () => {
    installHost(() => '//uQxg==');
    const { captured } = stubObjectURL();
    const t = createBlobTransport();

    await t.resolve('D:/m/x.flac');
    await t.resolve('D:/m/y.weird');

    expect(captured[0]?.blob.type).toBe('audio/flac');
    expect(captured[1]?.blob.type).toBe('');
  });

  it('宿主读失败 → resolve reject（上层标 TrackBad/TrackMissing）', async () => {
    installHost(() => {
      throw new Error('boom');
    });
    stubObjectURL();
    const t = createBlobTransport();
    await expect(t.resolve('D:/m/a.mp3')).rejects.toThrow('boom');
  });
});

describe('revoke', () => {
  it('revoke(url) 调 URL.revokeObjectURL（stub）', () => {
    const { revoked } = stubObjectURL();
    const t = createBlobTransport();
    t.revoke('blob:mock-0');
    t.revoke('blob:mock-1');
    expect(revoked).toEqual(['blob:mock-0', 'blob:mock-1']);
  });
});

describe('prime 预读（Review Focus #1：大 FLAC 换曲延迟）', () => {
  it("prime('a') 后 resolve('a') 只读一次底层", async () => {
    const { readHostFile } = installHost(() => '//uQxg==');
    const { captured } = stubObjectURL();
    const t = createBlobTransport();

    t.prime('D:/m/a.mp3');
    expect(readHostFile).toHaveBeenCalledTimes(1); // prime 即开始后台读

    const url = await t.resolve('D:/m/a.mp3');
    expect(readHostFile).toHaveBeenCalledTimes(1); // 没有第二次底层读
    expect(url).toBe('blob:mock-0');
    expect(captured).toHaveLength(1);
  });

  it('换曲即换（容量 1）：被顶掉的未消费预读落地后立即 revoke', async () => {
    const { readHostFile } = installHost(() => '//uQxg==');
    const { captured, revoked } = stubObjectURL();
    const t = createBlobTransport();

    t.prime('a');
    t.prime('b'); // 顶掉 a（a 未消费）
    expect(readHostFile).toHaveBeenCalledTimes(2);

    const urlB = await t.resolve('b');
    expect(readHostFile).toHaveBeenCalledTimes(2); // 命中预读
    expect(urlB).toBe('blob:mock-1');

    await flushMicrotasks();
    expect(revoked).toEqual(['blob:mock-0']); // a 的 Blob 被释放，不双份驻留

    const urlA = await t.resolve('a'); // a 已被顶掉 → 重新读
    expect(readHostFile).toHaveBeenCalledTimes(3);
    expect(urlA).toBe('blob:mock-2');
    expect(captured).toHaveLength(3);
  });

  it('页面退出清理未消费预读，不回收已移交引擎的URL', async () => {
    installHost(() => '//uQxg==');
    const { revoked } = stubObjectURL();
    const first = createBlobTransport();
    first.prime('a');
    first.dispose?.();
    await flushMicrotasks();
    expect(revoked).toContain('blob:mock-0');
    const second = createBlobTransport();
    second.prime('b');
    const held = await second.resolve('b');
    second.dispose?.();
    await flushMicrotasks();
    expect(revoked).not.toContain(held);
  });

  it('预读被 resolve 消费后不 revoke（URL 已交给引擎）', async () => {
    installHost(() => '//uQxg==');
    const { revoked } = stubObjectURL();
    const t = createBlobTransport();

    t.prime('a');
    const url = await t.resolve('a');
    t.prime('b'); // 此时 a 槽已被消费，不应 revoke a 的 URL
    await flushMicrotasks();

    expect(url).toBe('blob:mock-0');
    expect(revoked).not.toContain('blob:mock-0');
  });
});

describe('prime 健壮性（Task 6 审查建议 #5/#6，Task 7 授权微修）', () => {
  it('prime 同路径未消费短路：不双重底层读、不重建槽位', async () => {
    const { readHostFile } = installHost(() => '//uQxg==');
    const { captured } = stubObjectURL();
    const t = createBlobTransport();

    t.prime('a');
    t.prime('a'); // 同路径且未消费 → 短路（换曲重复触发预读防双重整读）
    expect(readHostFile).toHaveBeenCalledTimes(1);

    const url = await t.resolve('a'); // 仍命中原槽位
    expect(url).toBe('blob:mock-0');
    expect(captured).toHaveLength(1);
    expect(readHostFile).toHaveBeenCalledTimes(1);
  });

  it('prime 同路径已消费（槽位已移交引擎）→ 重新读（短路仅限未消费）', async () => {
    const { readHostFile } = installHost(() => '//uQxg==');
    stubObjectURL();
    const t = createBlobTransport();

    t.prime('a');
    await t.resolve('a'); // 消费（槽位清空）
    t.prime('a'); // 需要新一次读：旧 URL 已归引擎，缓存必须重建
    expect(readHostFile).toHaveBeenCalledTimes(2);
  });

  it('prime 读失败不产生 unhandled rejection；resolve 消费槽位仍拿到真实错误', async () => {
    // vitest 跑在 Node，但 tsconfig 无 @types/node：按结构窄化引用 process
    type NodeProcess = {
      on(evt: string, cb: (reason: unknown) => void): void;
      off(evt: string, cb: (reason: unknown) => void): void;
    };
    const proc = (globalThis as unknown as { process: NodeProcess }).process;
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    proc.on('unhandledRejection', onUnhandled);
    try {
      installHost(() => {
        throw new Error('boom');
      });
      stubObjectURL();
      const t = createBlobTransport();

      t.prime('a'); // 后台读失败：槽位 promise 被内部 catch 消费，不冒全局 unhandled
      await flushMicrotasks();
      await new Promise((r) => setTimeout(r, 0)); // Node 在宏任务轮检查 unhandled rejection

      expect(unhandled).toEqual([]);

      await expect(t.resolve('a')).rejects.toThrow('boom'); // 消费方仍收到原始错误
      await flushMicrotasks();
      await new Promise((r) => setTimeout(r, 0));
      expect(unhandled).toEqual([]); // resolve 路径的 reject 已被 expect 断言消费
    } finally {
      proc.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('blob: 前缀条目（浏览器降级约定）', () => {
  it('无File注册表也为同源blob重建新的瞬态播放URL', async () => {
    const { readHostFile } = installHost(() => '//uQxg==');
    const { captured } = stubObjectURL();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['audio']) })));
    const t = createBlobTransport();
    await expect(t.resolve('blob:mock-7')).resolves.toBe('blob:mock-0');
    expect(readHostFile).not.toHaveBeenCalled();
    expect(captured).toHaveLength(1);
  });

  it('readBytes 对 blob: 条目走 fetch 读字节', async () => {
    installHost(() => '//uQxg==');
    const fetchMock = vi.fn(async () => ({
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }));
    vi.stubGlobal('fetch', fetchMock);
    const t = createBlobTransport();

    const bytes = await t.readBytes('blob:mock-0');
    expect(fetchMock).toHaveBeenCalledWith('blob:mock-0');
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });
});

describe('降级条目重播（Task 7 审查非阻塞 #2：引擎 revoke 原 URL 后的重播缺口）', () => {
  it('注册表命中：resolve 两次得到两个不同 blob: URL，都能 revoke，原注册表 URL 不动', async () => {
    const { captured, revoked } = stubObjectURL();
    const file = new File([new Uint8Array([1, 2, 3])], 'a.mp3', { type: 'audio/mpeg' });
    registerFallbackFile('blob:picked-0', file);
    const t = createBlobTransport();
    try {
      const u1 = await t.resolve('blob:picked-0');
      const u2 = await t.resolve('blob:picked-0'); // 引擎已 revoke u1 后重播 → 每次重建新号
      expect(u1).not.toBe(u2);
      expect(u1.startsWith('blob:')).toBe(true);
      expect(u2.startsWith('blob:')).toBe(true);
      expect(captured).toHaveLength(2);

      t.revoke(u1);
      t.revoke(u2);
      expect(revoked).toEqual([u1, u2]); // 引擎换曲 revoke 的正是每次新建的 URL
      expect(revoked).not.toContain('blob:picked-0'); // 原始注册表 URL 永不归引擎经手
      expect(getFallbackFile('blob:picked-0')).toBe(file); // 注册表仍命中：可无限重播
    } finally {
      releaseFallbackFile('blob:picked-0');
    }
  });

  it('同源其它窗口的blob文件通过fetch重建，避免播放引擎回收原始URL', async () => {
    const { readHostFile } = installHost(() => '//uQxg==');
    const { captured } = stubObjectURL();
    const fixture = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => fixture })));
    const t = createBlobTransport();
    const url = await t.resolve('blob:other-window-file');
    expect(url).not.toBe('blob:other-window-file');
    expect(captured[0].blob.size).toBe(3);
    expect(readHostFile).not.toHaveBeenCalled();
  });

  it('失效的blob读取明确失败而不作为可播路径返回', async () => {
    installHost(() => '//uQxg==');
    stubObjectURL();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('expired blob'); }));
    await expect(createBlobTransport().resolve('blob:stale-0')).rejects.toThrow('expired blob');
  });

  it('宿主模式不受影响：普通路径仍走 readFileBytes 整读（注册表非空也不干扰）', async () => {
    const { readHostFile } = installHost(() => '//uQxg==');
    const { captured } = stubObjectURL();
    registerFallbackFile('blob:picked-0', new File(['x'], 'a.mp3', { type: 'audio/mpeg' }));
    const t = createBlobTransport();
    try {
      const url = await t.resolve('D:/m/a.mp3');
      expect(url).toBe('blob:mock-0');
      expect(readHostFile).toHaveBeenCalledWith('D:/m/a.mp3');
      expect(captured[0]?.blob.size).toBe(4);
      expect(captured[0]?.blob.type).toBe('audio/mpeg');
    } finally {
      releaseFallbackFile('blob:picked-0');
    }
  });
});

describe('readBytes 透传', () => {
  it('普通路径 → readFileBytes（"SGVsbG8=" → Hello）', async () => {
    const { readHostFile } = installHost(() => 'SGVsbG8=');
    const t = createBlobTransport();

    const bytes = await t.readBytes('D:/m/a.mp3');
    expect(Array.from(bytes)).toEqual([72, 101, 108, 108, 111]);
    expect(readHostFile).toHaveBeenCalledWith('D:/m/a.mp3');
  });

  it('readBytes reject 原样透传', async () => {
    installHost(() => {
      throw new Error('no such file');
    });
    const t = createBlobTransport();
    await expect(t.readBytes('D:/m/gone.mp3')).rejects.toThrow('no such file');
  });
});
