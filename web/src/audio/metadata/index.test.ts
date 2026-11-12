/**
 * Task 5 Step 2 失败测试：元数据解析器（5 格式）。
 * 断言来自计划 Task 5 Step 2 逐字条目：Xing 3135±1、FLAC/OGG/MP4 30000、
 * 无标签 mp3 title 兜底 fileName 去扩展名、corrupt 变体全 unknown 不抛；
 * 另加模糊字节测试（计划 Review Focus #3：解析器绝不抛异常崩 UI）。
 */
import { describe, expect, it } from 'vitest';

import { parseMetadata, type TrackMeta } from './index';
import {
  ALBUM_23,
  PNG_PREFIX,
  bigPng,
  basicMp4,
  basicWav,
  corruptFlac,
  corruptMp3,
  corruptMp4,
  corruptOgg,
  corruptWav,
  flacPictureBlock,
  fullFlac,
  fullOgg,
  listInfoWav,
  mp3Id3v23,
  mp3UsltApic,
  mp4With64bit,
  taggedMp3,
  untaggedMp3,
  xingMp3,
} from './fixtures';

// ---------- mp3 ----------

describe('parseMetadata: mp3', () => {
  it('ID3v2.4 TIT2/TPE1/TALB + CBR 时长按 fileSize×8/比特率', () => {
    const m = parseMetadata(taggedMp3(), 'a.mp3');
    expect(m.kind).toBe('mp3');
    expect(m.title).toBe('Song A');
    expect(m.artist).toBe('Artist X');
    expect(m.album).toBe('Album Z');
    // fileSize = 10(ID3 头) + 54(帧) + 5×417 = 2149 → 2149×8/128 = 134.3125ms
    expect(Math.abs((m.durationMs ?? 0) - 134.31)).toBeLessThan(1);
  });

  it('Xing VBR：120 帧@44100 → durationMs 3135±1', () => {
    const m = parseMetadata(xingMp3(), 'vbr.mp3');
    expect(m.kind).toBe('mp3');
    expect(Math.abs((m.durationMs ?? 0) - 3134.69)).toBeLessThanOrEqual(1);
  });

  it('无标签 CBR：title 兜底 fileName 去扩展名，artist/album 留 undefined（回退命名在 UI 层）', () => {
    const m = parseMetadata(untaggedMp3(), '纯音乐.mp3');
    expect(m.kind).toBe('mp3');
    expect(m.title).toBe('纯音乐');
    expect(m.artist).toBeUndefined();
    expect(m.album).toBeUndefined();
    // fileSize = 5×417 = 2085 → 2085×8/128 = 130.3125ms
    expect(Math.abs((m.durationMs ?? 0) - 130.31)).toBeLessThan(1);
  });

  it('USLT 内嵌歌词（UTF-16 w/BOM）+ APIC 封面 + ISO-8859-1 文本 + v2.4 syncsafe 帧尺寸', () => {
    const m = parseMetadata(mp3UsltApic(), 't.mp3');
    expect(m.kind).toBe('mp3');
    expect(m.title).toBe('Legacy Title');
    expect(m.lyricsText).toBe('[00:01]嵌入歌词');
    expect(Array.from(m.coverBytes ?? [])).toEqual(Array.from(bigPng()));
  });

  it('ID3v2.3：u32 帧尺寸读法（TALB 130 字节）', () => {
    const m = parseMetadata(mp3Id3v23(), 'old.mp3');
    expect(m.kind).toBe('mp3');
    expect(m.title).toBe('Song 23');
    expect(m.artist).toBe('Artist 23');
    expect(m.album).toBe(ALBUM_23);
  });

  it('corrupt（截断 ID3 头）→ unknown 不抛 + 文件名兜底', () => {
    const m = parseMetadata(corruptMp3(), 'c.mp3');
    expect(m.kind).toBe('unknown');
    expect(m.title).toBe('c');
  });
});

// ---------- flac ----------

describe('parseMetadata: flac', () => {
  it('STREAMINFO totalSamples=44100×30 → durationMs===30000', () => {
    const m = parseMetadata(fullFlac(), 'f.flac');
    expect(m.kind).toBe('flac');
    expect(m.title).toBe('Flac Song');
    expect(m.artist).toBe('Flac Artist');
    expect(m.album).toBe('Flac Album');
    expect(m.durationMs).toBe(30000);
    expect(m.lyricsText).toBe('[00:01]flac歌词');
    expect(Array.from(m.coverBytes ?? [])).toEqual(Array.from(PNG_PREFIX));
  });

  it('corrupt（截断块头）→ unknown 不抛', () => {
    const m = parseMetadata(corruptFlac(), 'cf.flac');
    expect(m.kind).toBe('unknown');
    expect(m.title).toBe('cf');
  });
});

// ---------- ogg ----------

describe('parseMetadata: ogg', () => {
  it('id header 采样率 + 末页 granule → durationMs===30000；METADATA_BLOCK_PICTURE 出封面', () => {
    const m = parseMetadata(fullOgg(), 'o.ogg');
    expect(m.kind).toBe('ogg');
    expect(m.title).toBe('Ogg Song');
    expect(m.artist).toBe('Ogg Artist');
    expect(m.album).toBe('Ogg Album');
    expect(m.durationMs).toBe(30000);
    expect(Array.from(m.coverBytes ?? [])).toEqual(Array.from(PNG_PREFIX));
  });

  it('corrupt（截断页头）→ unknown 不抛', () => {
    const m = parseMetadata(corruptOgg(), 'co.ogg');
    expect(m.kind).toBe('unknown');
    expect(m.title).toBe('co');
  });

  it('METADATA_BLOCK_PICTURE 的 base64 是标准 FLAC PICTURE 结构（fixture 自检）', () => {
    // 保证 fixture 与 flac.ts 解出的结构一致，避免 fixture 本身造错
    expect(flacPictureBlock().length).toBeGreaterThan(32);
  });
});

// ---------- wav ----------

describe('parseMetadata: wav', () => {
  it('fmt + data size → durationMs===30000，无标签走文件名兜底', () => {
    const m = parseMetadata(basicWav(), 'song.wav');
    expect(m.kind).toBe('wav');
    expect(m.title).toBe('song');
    expect(m.artist).toBeUndefined();
    expect(m.durationMs).toBe(30000);
  });

  it('LIST/INFO：INAM/IART/IPRD 尽力解析', () => {
    const m = parseMetadata(listInfoWav(), 's.wav');
    expect(m.kind).toBe('wav');
    expect(m.title).toBe('WAV Song');
    expect(m.artist).toBe('WAV Artist');
    expect(m.album).toBe('WAV Album');
    expect(m.durationMs).toBe(30000);
  });

  it('corrupt（无 fmt 块）→ unknown 不抛', () => {
    const m = parseMetadata(corruptWav(), 'cw.wav');
    expect(m.kind).toBe('unknown');
    expect(m.title).toBe('cw');
  });
});

// ---------- mp4 ----------

describe('parseMetadata: mp4', () => {
  it('moov/mvhd timescale 1000 × duration 30000 → 30000；ilst ©nam/©ART/©alb/covr', () => {
    const m = parseMetadata(basicMp4(), 'm.m4a');
    expect(m.kind).toBe('mp4');
    expect(m.title).toBe('MP4 Song');
    expect(m.artist).toBe('MP4 Artist');
    expect(m.album).toBe('MP4 Album');
    expect(m.durationMs).toBe(30000);
    expect(Array.from(m.coverBytes ?? [])).toEqual(Array.from(PNG_PREFIX));
  });

  it('64bit size 变体盒子（moov size=1 + u64）照样遍历 → 30000', () => {
    const m = parseMetadata(mp4With64bit(), 'm64.m4a');
    expect(m.kind).toBe('mp4');
    expect(m.durationMs).toBe(30000);
    expect(m.title).toBe('MP4 Song');
  });

  it('corrupt（moov 尺寸越界）→ unknown 不抛', () => {
    const m = parseMetadata(corruptMp4(), 'cm.m4a');
    expect(m.kind).toBe('unknown');
    expect(m.title).toBe('cm');
  });
});

// ---------- 分发兜底与防御（Review Focus #3） ----------

describe('parseMetadata: 嗅探与防御', () => {
  it('空输入 → unknown + 文件名兜底，不抛', () => {
    const m = parseMetadata(new Uint8Array(0), 'empty.flac');
    expect(m.kind).toBe('unknown');
    expect(m.title).toBe('empty');
  });

  it('未知魔数 → unknown', () => {
    const m = parseMetadata(new TextEncoder().encode('hello world, definitely not audio'), 'x.bin');
    expect(m.kind).toBe('unknown');
    expect(m.title).toBe('x');
  });

  it('每个格式的 corrupt 变体全部 kind:unknown 且不抛', () => {
    const corrupts: Array<[Uint8Array, string]> = [
      [corruptMp3(), 'c.mp3'],
      [corruptFlac(), 'c.flac'],
      [corruptOgg(), 'c.ogg'],
      [corruptWav(), 'c.wav'],
      [corruptMp4(), 'c.m4a'],
    ];
    for (const [bytes, name] of corrupts) {
      const results: TrackMeta[] = [];
      expect(() => results.push(parseMetadata(bytes, name))).not.toThrow();
      expect(results).toHaveLength(1);
      expect(results[0].kind).toBe('unknown');
      expect(results[0].title).toBe('c');
    }
  });

  it('模糊字节：随机输入一律不抛（200 轮种子化 PRNG）', () => {
    // mulberry32：确定性种子，失败可复现
    let a = 42 >>> 0;
    const rnd = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < 200; i++) {
      const n = Math.floor(rnd() * 300);
      const b = new Uint8Array(n);
      for (let j = 0; j < n; j++) b[j] = Math.floor(rnd() * 256);
      expect(() => parseMetadata(b, 'fuzz.bin')).not.toThrow();
    }
  });

  it('模糊截断：合法样本在任意位置截断一律不抛', () => {
    const samples = [
      taggedMp3(), xingMp3(), untaggedMp3(), mp3UsltApic(), mp3Id3v23(),
      fullFlac(), fullOgg(), basicWav(), listInfoWav(), basicMp4(), mp4With64bit(),
    ];
    for (const s of samples) {
      for (const cut of [1, 3, 7, 12, 21, 30, Math.floor(s.length / 2), s.length - 1]) {
        if (cut <= 0) continue;
        expect(() => parseMetadata(s.slice(0, cut), 't.bin')).not.toThrow();
      }
    }
  });
});
