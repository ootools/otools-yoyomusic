/**
 * Task 5 fixtures —— 程序化构造的最小合法样本（Uint8Array 字面量，不用二进制文件）。
 *
 * 数值口径（计划 Task 5 Step 1/2 逐字）：
 * - MPEG1 Layer3 128kbps@44100Hz 单声道：帧长 floor(144×128000/44100)=417，每帧 1152 样本。
 * - Xing frames=120 → durationMs = 120×1152/44100×1000 ≈ 3134.69（断言 3135±1）。
 * - 无标签 CBR：fileSize×8/比特率 估算（5×417=2085B → ≈130.3ms）。
 * - FLAC：STREAMINFO 44100 / totalSamples 44100×30=1323000 → 30000ms。
 * - OGG：末页 granule 1323000 / 44100 → 30000ms。
 * - WAV：data 5292000 / byteRate 176400 → 30000ms。
 * - MP4：mvhd timescale 1000 × duration 30000 → 30000ms。
 */

// ---------- 字节小工具（仅供 fixture 构造） ----------

function u16le(n: number): Uint8Array {
  const b = new Uint8Array(2);
  b[0] = n & 0xff;
  b[1] = (n >>> 8) & 0xff;
  return b;
}
function u24be(n: number): Uint8Array {
  const b = new Uint8Array(3);
  b[0] = (n >>> 16) & 0xff;
  b[1] = (n >>> 8) & 0xff;
  b[2] = n & 0xff;
  return b;
}
function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = n & 0xff;
  b[1] = (n >>> 8) & 0xff;
  b[2] = (n >>> 16) & 0xff;
  b[3] = (n >>> 24) & 0xff;
  return b;
}
function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = (n >>> 24) & 0xff;
  b[1] = (n >>> 16) & 0xff;
  b[2] = (n >>> 8) & 0xff;
  b[3] = n & 0xff;
  return b;
}
function u64le(n: number): Uint8Array {
  const b = new Uint8Array(8);
  let v = BigInt(n);
  for (let i = 0; i < 8; i++) {
    b[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return b;
}
function u64be(n: number): Uint8Array {
  const b = new Uint8Array(8);
  let v = BigInt(n);
  for (let i = 7; i >= 0; i--) {
    b[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return b;
}
/** ID3v2.4 同步安全整数（每字节只用低 7 位）。 */
function syncsafe(n: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = (n >>> 21) & 0x7f;
  b[1] = (n >>> 14) & 0x7f;
  b[2] = (n >>> 7) & 0x7f;
  b[3] = n & 0x7f;
  return b;
}
function ascii(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}
function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
/** UTF-16LE + BOM（无终结符，ID3 编码字节 1 的文本体）。 */
function utf16leBom(s: string): Uint8Array {
  const b = new Uint8Array(2 + s.length * 2);
  b[0] = 0xff;
  b[1] = 0xfe;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    b[2 + i * 2] = c & 0xff;
    b[3 + i * 2] = (c >>> 8) & 0xff;
  }
  return b;
}
function concat(...parts: ArrayLike<number>[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s);
}

// ---------- 公共常量 ----------

/** 最小 PNG 头前缀（魔数 + IHDR 块头），用作封面载荷。 */
export const PNG_PREFIX: Uint8Array = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

/** 130 字节封面（≥128，钉住 ID3v2.4 帧尺寸的 syncsafe 编码）。 */
export function bigPng(): Uint8Array {
  return concat(PNG_PREFIX, new Uint8Array(114));
}

export const ALBUM_23 = 'Album 23 ' + 'x'.repeat(120); // 129 字符：钉住 v2.3 的 u32 帧尺寸

// ---------- MP3 ----------

const MP3_FRAME_LEN = 417; // MPEG1 L3 128kbps@44100

function mp3Frame(): Uint8Array {
  const f = new Uint8Array(MP3_FRAME_LEN);
  f[0] = 0xff;
  f[1] = 0xfb; // sync + MPEG1 + Layer3 + 无 CRC
  f[2] = 0x90; // 128kbps + 44100 + 无填充
  f[3] = 0xc4; // 单声道 + original
  return f;
}

function id3v24Frame(id: string, content: Uint8Array): Uint8Array {
  return concat(ascii(id), syncsafe(content.length), [0x00, 0x00], content);
}
function id3v24Tag(frames: Uint8Array[]): Uint8Array {
  const body = concat(...frames);
  return concat(ascii('ID3'), [0x04, 0x00, 0x00], syncsafe(body.length), body);
}
function id3v23Frame(id: string, content: Uint8Array): Uint8Array {
  return concat(ascii(id), u32be(content.length), [0x00, 0x00], content);
}
function id3v23Tag(frames: Uint8Array[]): Uint8Array {
  const body = concat(...frames);
  return concat(ascii('ID3'), [0x03, 0x00, 0x00], u32be(body.length), body);
}

/** ID3v2.4（TIT2/TPE1/TALB）+ 5 帧 CBR 128kbps。fileSize=2149 → ≈134.3ms。 */
export function taggedMp3(): Uint8Array {
  const tag = id3v24Tag([
    id3v24Frame('TIT2', concat([0x03], utf8('Song A'))),
    id3v24Frame('TPE1', concat([0x03], utf8('Artist X'))),
    id3v24Frame('TALB', concat([0x03], utf8('Album Z'))),
  ]);
  return concat(tag, mp3Frame(), mp3Frame(), mp3Frame(), mp3Frame(), mp3Frame());
}

/** 首帧带 Xing 头（MPEG1 单声道：帧头后 17 字节 side info），frames=120。 */
export function xingMp3(): Uint8Array {
  const f = mp3Frame();
  f.set(ascii('Xing'), 21);
  f.set(u32be(0x01), 25); // flags：frames 标志
  f.set(u32be(120), 29); // 120 帧
  return concat(f, mp3Frame(), mp3Frame());
}

/** 无标签 CBR：fileSize=2085 → ≈130.3ms；title 由文件名兜底。 */
export function untaggedMp3(): Uint8Array {
  return concat(mp3Frame(), mp3Frame(), mp3Frame(), mp3Frame(), mp3Frame());
}

/**
 * ID3v2.4 多编码：TIT2(ISO-8859-1) + USLT(UTF-16 w/BOM) + APIC(130 字节封面)。
 * 封面帧尺寸 143 ≥ 128 → 钉住 v2.4 syncsafe 帧尺寸读法。
 */
export function mp3UsltApic(): Uint8Array {
  const tag = id3v24Tag([
    id3v24Frame('TIT2', concat([0x00], ascii('Legacy Title'))),
    id3v24Frame('USLT', concat([0x01], ascii('eng'), [0x00, 0x00], utf16leBom('[00:01]嵌入歌词'))),
    id3v24Frame('APIC', concat([0x00], ascii('image/png'), [0x00], [0x03], [0x00], bigPng())),
  ]);
  return concat(tag, mp3Frame());
}

/** ID3v2.3：u32 帧尺寸（TALB 内容 130 字节 ≥ 128，钉住非 syncsafe 读法）。 */
export function mp3Id3v23(): Uint8Array {
  const tag = id3v23Tag([
    id3v23Frame('TIT2', concat([0x00], ascii('Song 23'))),
    id3v23Frame('TPE1', concat([0x00], ascii('Artist 23'))),
    id3v23Frame('TALB', concat([0x00], ascii(ALBUM_23))),
  ]);
  return concat(tag, mp3Frame());
}

/** 截断的 ID3 头（6 字节）→ 解析必须不抛 → unknown。 */
export function corruptMp3(): Uint8Array {
  return Uint8Array.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]);
}

// ---------- FLAC ----------

const FLAC_SAMPLE_RATE = 44100;
const FLAC_TOTAL_SAMPLES = 44100 * 30; // 1323000

/** Vorbis 注释区（FLAC 块体 / OGG 包体共用；长度均小端）。 */
function vorbisComments(entries: ReadonlyArray<readonly [string, string]>): Uint8Array {
  const vendor = utf8('yoyomusic-fixture');
  const parts: Uint8Array[] = [u32le(vendor.length), vendor, u32le(entries.length)];
  for (const [k, v] of entries) {
    const e = utf8(`${k}=${v}`);
    parts.push(u32le(e.length), e);
  }
  return concat(...parts);
}

/** FLAC PICTURE 结构（OGG METADATA_BLOCK_PICTURE 解 base64 后同构）。 */
export function flacPictureBlock(): Uint8Array {
  const mime = ascii('image/png');
  return concat(
    u32be(3), // picture type: front cover
    u32be(mime.length), mime,
    u32be(0), // 空描述
    u32be(0), u32be(0), u32be(0), u32be(0), // w/h/depth/colors
    u32be(PNG_PREFIX.length), PNG_PREFIX,
  );
}

function flacStreaminfo(): Uint8Array {
  const p = new Uint8Array(34);
  p[0] = 0x10; p[1] = 0x00; // min blocksize 4096
  p[2] = 0x10; p[3] = 0x00; // max blocksize 4096
  // 4..9：min/max framesize = 0
  p[10] = (FLAC_SAMPLE_RATE >>> 12) & 0xff;
  p[11] = (FLAC_SAMPLE_RATE >>> 4) & 0xff;
  p[12] = ((FLAC_SAMPLE_RATE & 0x0f) << 4) | (1 << 1) | 0; // 双声道、16bit 高位
  p[13] = (15 << 4) | 0; // bps-1=15、totalSamples 高 4 位 0
  p[14] = (FLAC_TOTAL_SAMPLES >>> 24) & 0xff;
  p[15] = (FLAC_TOTAL_SAMPLES >>> 16) & 0xff;
  p[16] = (FLAC_TOTAL_SAMPLES >>> 8) & 0xff;
  p[17] = FLAC_TOTAL_SAMPLES & 0xff;
  // 18..33：md5 全 0
  return p;
}

/** fLaC + STREAMINFO + VORBIS_COMMENT + PICTURE(末块) + LYRICS。 */
export function fullFlac(): Uint8Array {
  const stream = flacStreaminfo();
  const vc = vorbisComments([
    ['TITLE', 'Flac Song'],
    ['ARTIST', 'Flac Artist'],
    ['ALBUM', 'Flac Album'],
    ['LYRICS', '[00:01]flac歌词'],
  ]);
  const pic = flacPictureBlock();
  return concat(
    ascii('fLaC'),
    concat([0x00], u24be(stream.length), stream), // 非末块
    concat([0x04], u24be(vc.length), vc), // 非末块
    concat([0x80 | 0x06], u24be(pic.length), pic), // last-block 标记
  );
}

/** 截断的块头 → 不抛 → unknown。 */
export function corruptFlac(): Uint8Array {
  return concat(ascii('fLaC'), [0x00, 0x00]);
}

// ---------- OGG ----------

function oggPage(headerType: number, granule: number, seq: number, packet: Uint8Array): Uint8Array {
  const segTable: number[] = [];
  let rest = packet.length;
  do {
    const seg = Math.min(255, rest);
    segTable.push(seg);
    rest -= seg;
  } while (rest > 0);
  return concat(
    ascii('OggS'), [0x00], [headerType],
    u64le(granule), u32le(1), u32le(seq), u32le(0), // serial=1、crc=0（解析器不校验）
    [segTable.length], Uint8Array.from(segTable), packet,
  );
}

function oggIdHeader(): Uint8Array {
  // 0x01 'vorbis' + version + channels(2) + sampleRate(44100) + 比特率×3 + blocksizes + framing = 30 字节
  return concat([0x01], ascii('vorbis'), u32le(0), [0x02], u32le(44100), u32le(0), u32le(128000), u32le(0), [0xb8, 0x01]);
}

/** 三页：BOS(id header) + comment(含 METADATA_BLOCK_PICTURE) + EOS 末页 granule=1323000。 */
export function fullOgg(): Uint8Array {
  const b64 = toBase64(flacPictureBlock());
  const comment = concat(
    [0x03], ascii('vorbis'),
    vorbisComments([
      ['TITLE', 'Ogg Song'],
      ['ARTIST', 'Ogg Artist'],
      ['ALBUM', 'Ogg Album'],
      ['METADATA_BLOCK_PICTURE', b64],
    ]),
    [0x01], // framing
  );
  const audio = Uint8Array.from([0x40]); // 伪音频包（首比特 0）
  return concat(
    oggPage(0x02, 0, 0, oggIdHeader()),
    oggPage(0x00, 0, 1, comment),
    oggPage(0x04, 44100 * 30, 2, audio),
  );
}

/** 截断的页头 → 不抛 → unknown。 */
export function corruptOgg(): Uint8Array {
  return concat(ascii('OggS'), [0x00, 0x00]);
}

// ---------- WAV ----------

const WAV_BYTE_RATE = 44100 * 2 * 2; // 176400
const WAV_DATA_SIZE = WAV_BYTE_RATE * 30; // 5292000 → 30s

function wavFmt(): Uint8Array {
  return concat(ascii('fmt '), u32le(16), u16le(1), u16le(2), u32le(44100), u32le(WAV_BYTE_RATE), u16le(4), u16le(16));
}
function wavData(): Uint8Array {
  return concat(ascii('data'), u32le(WAV_DATA_SIZE), new Uint8Array(32));
}
function wavFile(...chunks: Uint8Array[]): Uint8Array {
  const body = concat(...chunks);
  return concat(ascii('RIFF'), u32le(4 + body.length), ascii('WAVE'), body);
}

/** PCM 44100/16bit/双声道：data 5292000 / byteRate 176400 → 30000ms。 */
export function basicWav(): Uint8Array {
  return wavFile(wavFmt(), wavData());
}

/** LIST/INFO：INAM/IART/IPRD 尽力解析。 */
export function listInfoWav(): Uint8Array {
  // RIFF 子块按 2 字节对齐：数据长（含 \0）为奇数时补 1 字节 pad
  const sub = (id: string, text: string) => {
    const data = concat(utf8(text), [0x00]);
    return concat(ascii(id), u32le(data.length), data, data.length & 1 ? [0x00] : []);
  };
  const subs = concat(sub('INAM', 'WAV Song'), sub('IART', 'WAV Artist'), sub('IPRD', 'WAV Album'));
  const list = concat(ascii('LIST'), u32le(4 + subs.length), ascii('INFO'), subs);
  return wavFile(wavFmt(), list, wavData());
}

/** 有 RIFF/WAVE 头但无 fmt 块 → 不抛 → unknown。 */
export function corruptWav(): Uint8Array {
  return concat(ascii('RIFF'), u32le(100), ascii('WAVE'));
}

// ---------- MP4 ----------

function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(...payload);
  return concat(u32be(8 + body.length), ascii(type), body);
}
/** 64bit size 变体：size=1 + u64 真实尺寸。 */
function box64(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(...payload);
  return concat(u32be(1), ascii(type), u64be(16 + body.length), body);
}
function dataBox(flags: number, payload: Uint8Array): Uint8Array {
  return box('data', u32be(flags), u32be(0), payload);
}
function mvhdV0(timescale: number, duration: number): Uint8Array {
  const p = new Uint8Array(100);
  // version/flags(0..3) creation(4..7) modification(8..11) 之后：
  p[12] = (timescale >>> 24) & 0xff; // timescale 在 +12
  p[13] = (timescale >>> 16) & 0xff;
  p[14] = (timescale >>> 8) & 0xff;
  p[15] = timescale & 0xff;
  p[16] = (duration >>> 24) & 0xff; // duration 在 +16
  p[17] = (duration >>> 16) & 0xff;
  p[18] = (duration >>> 8) & 0xff;
  p[19] = duration & 0xff;
  p[20] = 0x00; p[21] = 0x01; p[22] = 0x00; p[23] = 0x00; // rate 1.0
  p[24] = 0x01; p[25] = 0x00; // volume 1.0
  return p;
}

const mp4Ilst = () =>
  box(
    'ilst',
    box('©nam', dataBox(1, utf8('MP4 Song'))),
    box('©ART', dataBox(1, utf8('MP4 Artist'))),
    box('©alb', dataBox(1, utf8('MP4 Album'))),
    box('covr', dataBox(14, PNG_PREFIX)),
  );
const mp4Udta = () => box('udta', box('meta', new Uint8Array(4), mp4Ilst()));
const mp4Ftyp = () => box('ftyp', ascii('M4A '), u32be(0), ascii('M4A '));

/** ftyp + moov(mvhd timescale 1000 duration 30000 + udta/meta/ilst)。 */
export function basicMp4(): Uint8Array {
  return concat(mp4Ftyp(), box('moov', concat(box('mvhd', mvhdV0(1000, 30000)), mp4Udta())));
}

/** moov 用 64bit size 变体（至少一条盒子）。 */
export function mp4With64bit(): Uint8Array {
  return concat(mp4Ftyp(), box64('moov', concat(box('mvhd', mvhdV0(1000, 30000)), mp4Udta())));
}

/** moov 声明 1000 字节但实际截断 → 不抛 → unknown。 */
export function corruptMp4(): Uint8Array {
  return concat(mp4Ftyp(), concat(u32be(1000), ascii('moov'), new Uint8Array(10)));
}
