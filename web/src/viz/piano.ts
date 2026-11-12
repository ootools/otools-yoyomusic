/*
 * 3D 钢琴可视化 —— 按 Go 版 internal/ui/viz.go:652-1033（钢琴段）逐公式转录成
 * Canvas 2D（Task 9 新写，非移植拷贝）。
 *
 * 一个双八度键盘画成一件从后上方一点点俯视的实体乐器，而不是一条平铺的矩形：
 *   - 深度等步在远处聚拢（透视 kbPersp），白键在远半段（黑键两侧所在处）收窄，
 *     于是键盘"向后退"而不是"躺在画布上"；
 *   - 每颗键是一个有体的东西：上表面、前脸、两者交界处的亮边、投在邻键上的阴影；
 *   - 被弹的键绕远端 pivot：近端沉向键滑枕（沉到它后面去），远端不动，表面
 *     随之下倾、退出光路。
 *
 * 每颗键追踪其所在频段的能量（低频在左、高频在右），曲目播放时琴键像被一只
 * 看不见的手依次按下；beat 让全键微沉；静默时一轮慢正弦让键盘继续呼吸（idle 微光）。
 *
 * 键的锥形侧面画成一叠切片（kbSlices，5–20 片）：myui 按落点缓存矢量路径的
 * 掩码，逐帧移动的路径会每键每帧都要新掩码、悄悄耗尽图集；Canvas 2D 无此限制，
 * 但切片画法一并保留，与 Go 版逐像素同构，便于 Task 16 冒烟对照。
 *
 * 可测的几何/状态量全部抽成导出纯函数（计划 Step 2 点名）：
 *   kbWhiteCount / kbBlackCount / kbBlackAfter / projectKey / pianoLayout /
 *   keyY / keyWhiteHalf / keyBlackHalf / keyLiftAt / keyPress / keyRelease /
 *   pressLevel / beatDip / keyBandIndex / blackBandIndex / kbSlices /
 *   whiteShade / blackShade；绘制主体 drawPiano 只吃这些纯函数的输出。
 *
 * 行号对照（viz.go）：常量 659-672、配色 677-683、pianoGeom 方法 685-750、
 * pianoLayout 752-768、whiteShade 770-788、blackShade 790-803、drawPiano 815-1010、
 * pressLevel 1003-1022、bandAt 117-126。
 */

import { BAND_COUNT, type SignalFrame } from '../signal/engine';
import { roundedRect } from './drawModes';

// --- 常量（viz.go:659-672）---------------------------------------------------
// v 是沿键长方向的位置：0 在远端（琴盖板下），1 在近端（面对观众）。

/** 远端比近端远多少（透视前缩）。 */
export const KB_PERSP = 0.16;
/** 琴盖板盖住琴键的位置。 */
export const KB_BACK_V = 0.17;
/** 黑键终止处，远短于白键鼻端。 */
export const KB_BLACK_V = 0.76;
/** 白键在远端（黑键两侧所在处）收窄多少。 */
export const KB_NARROW = 0.18;
/** 黑键宽，以白键宽计。 */
export const KB_BLACK_W = 0.52;
/** 黑键高出白键多少，以键盘高计。 */
export const KB_LIFT = 0.125;
/** 两白键之间的缝，DIP。 */
export const KB_GAP = 1.8;
/** 锥形边缘两切片之间的最大步进。 */
export const KB_SLICE = 0.7;

export function kbWhiteCount(): number {
  return 14; // 两个八度（viz.go:671）
}

export function kbBlackCount(): number {
  return 10; // viz.go:672
}

/** 每颗黑键坐在哪颗白键之后：两八度的 0,1,3,4,5（第 3、7 颗白键后无缝）。 */
export function kbBlackAfter(): readonly number[] {
  return BLACK_AFTER;
}
const BLACK_AFTER: readonly number[] = [0, 1, 3, 4, 5, 7, 8, 10, 11, 12];

// --- 乐器配色（viz.go:677-683）----------------------------------------------
// 键盘就是白塑料和黑塑料做的，任何皮肤都不改变它：只有照到它的光跟皮肤走。

export const PIANO_WHITE_BACK: RGB = [112, 118, 142]; // 远端，琴体的阴影里
export const PIANO_WHITE_LIT: RGB = [241, 244, 250]; // 光落到的鼻端
export const PIANO_BLACK_DIM: RGB = [13, 14, 20];
export const PIANO_BLACK_LIT: RGB = [58, 61, 74];
export const PIANO_CASE: RGB = [26, 27, 36]; // 键后的琴体

// --- 颜色小工具（viz.go:1012-1031 dim/chan8/smoothstep + myui Mix）-----------

export type RGB = [number, number, number];

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** 线性混色（myui Color.Mix，sRGB、t 钳 0..1）。 */
function mix(a: RGB, b: RGB, t: number): RGB {
  const k = clamp01(t);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** 缩色通道、保 alpha：表面接住多少光（viz.go:1012-1015 dim/chan8）。 */
function dim(c: RGB, k: number): RGB {
  return [chan8(c[0], k), chan8(c[1], k), chan8(c[2], k)];
}

function chan8(v: number, k: number): number {
  const x = v * k;
  if (x < 0) return 0;
  if (x > 255) return 255;
  return Math.round(x);
}

/** 色带离开暗端时放缓，而不是陡然起步（viz.go:1021-1024）。 */
function smoothstep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/** 皮肤给的 CSS 色（#rgb/#rrggbb）→ 通道三元组；解析失败回退白（光不缺色）。 */
export function parseHexColor(s: string): RGB {
  const hex = s.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return [
      parseInt(hex[0] + hex[0], 16),
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16),
    ];
  }
  return [255, 255, 255];
}

function css(c: RGB, alpha = 1): string {
  const r = Math.round(c[0]);
  const g = Math.round(c[1]);
  const b = Math.round(c[2]);
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

// --- 布局（viz.go:714-722 pianoGeom / 752-768 pianoLayout）-------------------

export interface PianoRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PianoLayout {
  /** 远端的画布 y，与上表面的绘制高。 */
  top: number;
  h: number;
  /** 白键在近端的宽。 */
  whiteW: number;
  /** 黑键高出白键多少。 */
  lift: number;
  /** 白键前脸的绘制高。 */
  lipH: number;
  /** 白键近端被按到底时下沉多少。 */
  whiteDrop: number;
  /** 黑键的同款，沉得更深。 */
  blackDrop: number;
  persp: number;
  /** 键滑枕（key slip）高：lipH*0.55 + whiteDrop。 */
  slipH: number;
  /** 键盘总高 min(0.30H, 168)。 */
  total: number;
}

/**
 * 把键盘铺进 r：键的上表面铺满画布底部，前脸在其下，键滑枕在最前——被按下的
 * 键消失在它后面。与 drawPiano 分开，测试可以直接问布局落在哪，而不用猜行数
 * （viz.go:754-756）。
 */
export function pianoLayout(r: PianoRect): PianoLayout {
  const total = Math.min(r.h * 0.3, 168);
  const lipH = Math.min(Math.max(total * 0.125, 10), 22);
  const whiteDrop = Math.min(Math.max(total * 0.065, 5), 11);
  const slipH = lipH * 0.55 + whiteDrop;
  return {
    top: r.y + r.h - total,
    h: total - lipH - slipH,
    whiteW: r.w / kbWhiteCount(),
    lift: (total - lipH - slipH) * KB_LIFT,
    lipH,
    whiteDrop,
    blackDrop: whiteDrop * 1.9,
    persp: KB_PERSP,
    slipH,
    total,
  };
}

// --- 投影纯函数（viz.go:724-748 pianoGeom 方法）------------------------------

/** 白键收窄因子：近端(v=1)为 1，远端(v=0)为 1-kbNarrow=0.82。 */
export function kbTaper(v: number): number {
  return 1 - KB_NARROW * (1 - v);
}

/**
 * 把宽度 x 从深度 vBase 投到 vTop：线性收窄，远端 = 近端×0.82
 * （viz.go:729-731 whiteHalf 的收窄因子 1-kbNarrow*(1-v)）。
 */
export function projectKey(x: number, vBase: number, vTop: number): number {
  return (x * kbTaper(vTop)) / kbTaper(vBase);
}

/** scale 是键盘在深度 v 处画多大：近端为 1（viz.go:724-725）。 */
export function projectScale(g: PianoLayout, v: number): number {
  return 1 / (1 + g.persp * (1 - v));
}

/**
 * yAt：键盘的高在深度 v 处下沉到哪。深度的等步向远处聚拢——键盘因此读作
 * "向后退"而不是"平躺在画布上"（viz.go:727-732）。
 */
export function projectDepth(g: PianoLayout, v: number): number {
  const far = 1 / (1 + g.persp);
  return (projectScale(g, v) - far) / (1 - far);
}

/**
 * sink：深度 v 处的点拿到几成沉降。键绕远端 pivot，所以近端下沉、远端不动
 * （viz.go:734-740）。
 */
export function projectSink(v: number): number {
  const s = (v - KB_BACK_V) / (1 - KB_BACK_V);
  return s < 0 ? 0 : s;
}

/** y：深度 v 处、按下 press（0..1）、沉降额 drop 的键的画布 y（viz.go:742-744）。 */
export function keyY(g: PianoLayout, v: number, press: number, drop: number): number {
  return g.top + g.h * projectDepth(g, v) + drop * press * projectSink(v) * projectScale(g, v);
}

/**
 * whiteHalf：白键在深度 v 的半宽，减去与邻键隔开的半条缝
 * （viz.go:746-748；收窄因子经 kbTaper，远端 ×0.82）。
 */
export function keyWhiteHalf(g: PianoLayout, v: number): number {
  return Math.max((g.whiteW / 2) * kbTaper(v) - KB_GAP / 2, 0.5);
}

/**
 * blackHalf：黑键在深度 v 的半宽。黑键断面是楔形，靠键床处宽、沿顶部窄，
 * 所以两侧各露出一条楔（viz.go:750-752）。
 */
export function keyBlackHalf(g: PianoLayout, v: number): number {
  return Math.max(((g.whiteW * KB_BLACK_W) / 2) * (1 - KB_NARROW * 0.9 * (1 - v)), 0.5);
}

/** liftAt：黑键表面在深度 v 处画得比白键高多少；抬高的东西在画布上更高（viz.go:754-756）。 */
export function keyLiftAt(g: PianoLayout, v: number): number {
  return g.lift * projectScale(g, v);
}

// --- 切片数（viz.go:828-831 slices）------------------------------------------

/**
 * 一颗键的上表面画成几片：多到锥形读作直边而不是台阶。Go 原注：myui 缓存路径
 * 掩码，切片是给图集省内存的；Canvas 2D 里保留同构便于逐像素对照。
 */
export function kbSlices(slant: number): number {
  const n = Math.floor(slant / KB_SLICE) + 1;
  return Math.max(5, Math.min(n, 20));
}

// --- 上色（viz.go:770-803 whiteShade/blackShade）-----------------------------

/**
 * 白键上表面在深度 v 的色，音量 lv、皮肤光 glow：琴盖板下暗、鼻端最亮，
 * 沉下去的键变暗且带一点皮肤色（viz.go:770-788）。
 */
export function whiteShade(v: number, lv: number, glow: RGB): RGB {
  const t = (v - KB_BACK_V) / (1 - KB_BACK_V);
  let c = mix(PIANO_WHITE_BACK, PIANO_WHITE_LIT, smoothstep(t * 1.5));
  // 挨着音乐的键只沾一点皮肤色：键盘保持黑白，周围的光才负责颜色。
  c = mix(c, glow, 0.03 + 0.13 * lv);
  // 沉下去的键沿近半段退出光路，远端离开琴盖板、留下一线暗色键床。
  c = dim(c, 1 - 0.26 * lv * t - 0.45 * lv * smoothstep(1 - t * 3.5));
  if (t > 0.9) {
    // 键鼻是圆的，会接住一圈亮边——键向上翘进光里时更多。
    c = mix(c, [255, 255, 255], ((t - 0.9) / 0.1) * (0.45 + 0.35 * lv));
  }
  return c;
}

/** 黑键同款，在它到鼻端的短程上，带光面黑键沿身的镜面高光（viz.go:790-803）。 */
export function blackShade(v: number, lv: number, glow: RGB): RGB {
  const t = (v - KB_BACK_V) / (KB_BLACK_V - KB_BACK_V);
  let c = mix(PIANO_BLACK_DIM, PIANO_BLACK_LIT, smoothstep(t * 0.9));
  c = mix(c, glow, 0.03 + 0.1 * lv);
  if (t > 0.95) {
    // 沿鼻端的镜面，出声时带皮肤色：一条线，不是一片。
    c = mix(c, mix(glow, [255, 255, 255], 0.65), ((t - 0.95) / 0.05) * (0.35 + 0.45 * lv));
  }
  return c;
}

// --- 键状态（viz.go:1003-1022 pressLevel）------------------------------------

/** 单颗键的按压实值（Go 的 viz.pianoW/pianoB 槽位）。 */
export interface PressState {
  value: number;
}

/** 键盘的持久状态：时钟 + 每键按压缓冲（Go viz.go:66-68）。 */
export interface PianoState {
  t: number;
  /** 白键按压 0..1。 */
  w: Float32Array;
  /** 黑键按压 0..1。 */
  b: Float32Array;
}

export function createPianoState(): PianoState {
  return { t: 0, w: new Float32Array(kbWhiteCount()), b: new Float32Array(kbBlackCount()) };
}

/**
 * 快攻：活跃频段一来，lerp 0.5 向能量逼近（viz.go:1013-1015 上升分支）。
 * 与 keyRelease 拆开是计划 Step 2 点名的可测函数。
 */
export function keyPress(s: PressState, e: number): number {
  const energy = Math.min(1, Math.max(0, e));
  s.value += (energy - s.value) * 0.5;
  return s.value;
}

/** 慢放：0.6/s 线性回落，让键肉眼可见地弹回来（viz.go:1016-1018 下降分支），钳 0。 */
export function keyRelease(s: PressState, dt: number): number {
  s.value = Math.max(0, s.value - dt * 0.6);
  return s.value;
}

/**
 * pressLevel：推进一颗键的平滑按压（0..1）。活跃频段驱动它；音乐安静时一轮
 * 慢时间正弦让它继续呼吸；攻击快、释放慢（viz.go:1003-1022）。
 */
export function pressLevel(
  s: PressState,
  e: number,
  t: number,
  phase: number,
  idleW: number,
  dt: number,
): number {
  if (idleW > 0) {
    const shimmer = (0.5 + 0.5 * Math.sin(t * 2.3 + phase)) * 0.13 * idleW;
    if (shimmer > e) e = shimmer;
  }
  const lv = e > s.value ? keyPress(s, e) : keyRelease(s, dt);
  s.value = Math.min(1, Math.max(0, lv));
  return s.value;
}

/** beat 让全键微沉，像一只手压进和弦（viz.go:851-856；白 0.10 / 黑 0.08）。 */
export function beatDip(press: number, beat: number, black: boolean): number {
  return Math.min(1, press + beat * (black ? 0.08 : 0.1));
}

// --- 频段→琴键映射（viz.go:117-126 bandAt / 843-849）-------------------------

function clampIndex(i: number): number {
  return Math.max(0, Math.min(BAND_COUNT - 1, i));
}

/** 频谱在归一化位置 0..1 处的读数（viz.go:117-126 bandAt）。 */
function bandAt(f: SignalFrame, t: number): number {
  return f.bands[clampIndex(Math.floor(t * (BAND_COUNT - 1)))] ?? 0;
}

/** 白键 i 追踪的频段下标：i/whiteKeys 位置，低频在左。 */
export function keyBandIndex(i: number): number {
  return clampIndex(Math.floor(i / kbWhiteCount() * (BAND_COUNT - 1)));
}

/** 黑键 j 追踪的频段下标：宿主白键 (wk+1)/whiteKeys 位置（viz.go:848）。 */
export function blackBandIndex(j: number): number {
  return clampIndex(Math.floor(((BLACK_AFTER[j] + 1) / kbWhiteCount()) * (BAND_COUNT - 1)));
}

// --- 绘制（viz.go:815-1010 drawPiano，Canvas 2D 重写）------------------------

type Ctx = CanvasRenderingContext2D;

/** Angle 180 线性渐变（myui CSS 角：180 = 上→下）填矩形。 */
function vGrad(ctx: Ctx, x: number, y: number, w: number, h: number, from: string, to: string): void {
  if (w <= 0 || h <= 0) return;
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, from);
  grad.addColorStop(1, to);
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
}

/** Angle 90 线性渐变（左→右）填矩形。 */
function hGrad(ctx: Ctx, x: number, y: number, w: number, h: number, from: string, to: string): void {
  if (w <= 0 || h <= 0) return;
  const grad = ctx.createLinearGradient(x, y, x + w, y);
  grad.addColorStop(0, from);
  grad.addColorStop(1, to);
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
}

/**
 * myui p.Shadow(r, radius=1, ox=2.5, oy=2, blur=4, spread=0, 黑@0.5) 的近似：
 * Canvas 没有矩形原生阴影，用三层扩散矩形叠出高斯式衰减（中心合计 ≈0.5）。
 * 偏差留待 Task 16 冒烟对照时按需换 ctx.filter='blur(4px)' 或离屏印章。
 */
function paintShadow(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  if (w <= 0 || h <= 0) return;
  const ox = 2.5;
  const oy = 2;
  const blur = 4;
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  ctx.fillRect(x + ox - blur / 2, y + oy - blur / 2, w + blur, h + blur);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(x + ox - blur / 4, y + oy - blur / 4, w + blur / 2, h + blur / 2);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(x + ox, y + oy, w, h);
}

/** pressLevel 的槽位适配：Go 直接取 &viz.pianoW[i]，这里包一层读写。 */
function pressLevelAt(store: Float32Array, i: number, e: number, t: number, phase: number, idleW: number, dt: number): number {
  const s: PressState = { value: store[i] ?? 0 };
  const lv = pressLevel(s, e, t, phase, idleW, dt);
  store[i] = s.value;
  return lv;
}

/**
 * drawPiano：渲染双八度键盘（viz.go:815-1010 的 Canvas 2D 转录）。
 * 绘制顺序与 Go 一致：琴体 → 白键（光束/上表面切片/侧楔/前脸）→ 黑键（阴影/
 * 裁剪体内的侧楔/前脸/上表面）→ 琴盖板及其投影 → 键滑枕 → 按下键的暗键槽。
 */
export function drawPiano(
  context: Ctx,
  w: number,
  h: number,
  frame: SignalFrame,
  palette: { a: string; b: string; ink: string },
  state: PianoState,
  dt: number,
): void {
  const r: PianoRect = { x: 0, y: 0, w, h };
  const blackAfter = kbBlackAfter();
  const whiteKeys = kbWhiteCount();
  const blackKeys = kbBlackCount();

  const g = pianoLayout(r);
  const yFall = keyY(g, KB_BACK_V, 0, 0);
  const yRail = keyY(g, 1, 0, 0) + g.lipH;
  const bottom = r.y + r.h;

  // 一颗键的上表面画几片：多到锥形读作直边（viz.go:828-831）。
  const whiteSlices = kbSlices((g.whiteW * KB_NARROW) / 2);
  const blackSlices = kbSlices(((g.whiteW * KB_BLACK_W) * KB_NARROW * 0.9) / 2);

  const colA = parseHexColor(palette.a);
  const colB = parseHexColor(palette.b);

  // 琴体：键间与键后露出的那部分（viz.go:833-836）。
  vGrad(context, r.x, g.top, r.w, bottom - g.top, css(PIANO_CASE), css([11, 12, 17]));

  state.t += dt;
  // 静默呼吸的权重：level 低于 0.15 起步，满员归零（viz.go:838-839）。
  const idleW = 1 - Math.min(1, frame.level / 0.15);

  const wPress = new Float32Array(whiteKeys);
  const bPress = new Float32Array(blackKeys);
  for (let i = 0; i < whiteKeys; i += 1) {
    wPress[i] = pressLevelAt(state.w, i, bandAt(frame, i / whiteKeys), state.t, i * 0.9, idleW, dt);
  }
  for (let j = 0; j < blackKeys; j += 1) {
    const wk = blackAfter[j];
    bPress[j] = pressLevelAt(
      state.b,
      j,
      bandAt(frame, (wk + 1) / whiteKeys),
      state.t,
      wk * 1.1,
      idleW,
      dt,
    );
  }
  // beat 全键微沉，像一只手压进和弦（viz.go:851-856）。
  for (let i = 0; i < whiteKeys; i += 1) wPress[i] = beatDip(wPress[i], frame.beat, false);
  for (let j = 0; j < blackKeys; j += 1) bPress[j] = beatDip(bPress[j], frame.beat, true);

  // 出声键上抛的光：每颗被弹的键上方一片柔光柱（viz.go:858-859）。
  const beamTop = Math.max(r.y, yFall - g.h * 0.62);

  for (let i = 0; i < whiteKeys; i += 1) {
    const lv = wPress[i];
    const glow = mix(colA, colB, i / (whiteKeys - 1));
    const xc = r.x + (i + 0.5) * g.whiteW;

    if (lv > 0.04 && beamTop < yFall) {
      // 击键光束：glow 自上而下 0 → 0.30·lv，圆角矩形（viz.go:863-868）。
      const hw = keyWhiteHalf(g, KB_BACK_V);
      const grad = context.createLinearGradient(xc, beamTop, xc, yFall);
      grad.addColorStop(0, css(glow, 0));
      grad.addColorStop(1, css(glow, 0.3 * lv));
      context.fillStyle = grad;
      roundedRect(context, xc - hw, beamTop, hw * 2, yFall - beamTop, Math.min(hw / 2, 8));
      context.fill();
    }

    // 上表面：从后往前切片（viz.go:870-890）。
    for (let k = 0; k < whiteSlices; k += 1) {
      const v0 = KB_BACK_V + ((1 - KB_BACK_V) * k) / whiteSlices;
      const v1 = KB_BACK_V + ((1 - KB_BACK_V) * (k + 1)) / whiteSlices;
      const y0 = keyY(g, v0, lv, g.whiteDrop);
      const y1 = keyY(g, v1, lv, g.whiteDrop);
      const hw = keyWhiteHalf(g, (v0 + v1) / 2);
      // 切片向下多跑 0.75：整像素吸附不会在两片之间开出缝。
      vGrad(
        context,
        xc - hw,
        y0,
        hw * 2,
        y1 - y0 + 0.75,
        css(whiteShade(v0, lv, glow)),
        css(whiteShade(v1, lv, glow)),
      );
      // 键的侧面：左肩在缝的阴影里，右肩转向光——键因此是圆的，不是一张平卡。
      const sl = Math.min(hw * 0.4, 4.5);
      hGrad(context, xc - hw, y0, sl, y1 - y0 + 0.75, 'rgba(0,0,0,0.30)', 'rgba(0,0,0,0)');
      hGrad(context, xc + hw - 2.5, y0, 2.5, y1 - y0 + 0.75, 'rgba(0,0,0,0)', 'rgba(255,255,255,0.17)');
    }

    // 前脸：站在鼻端之下、与鼻端同进退；背光，所以比上表面暗（viz.go:892-897）。
    const yf = keyY(g, 1, lv, g.whiteDrop);
    const hwNose = keyWhiteHalf(g, 1);
    const lipTop = dim(mix(PIANO_WHITE_LIT, glow, 0.05 + 0.26 * lv), 0.88 - 0.2 * lv);
    const lipBot = dim(mix(PIANO_WHITE_BACK, glow, 0.05 + 0.22 * lv), 0.58 - 0.2 * lv);
    vGrad(context, xc - hwNose, yf - 0.5, hwNose * 2, g.lipH + 0.5, css(lipTop), css(lipBot));
  }

  for (let j = 0; j < blackKeys; j += 1) {
    const lv = bPress[j];
    const wk = blackAfter[j];
    const glow = mix(colB, colA, j / (blackKeys - 1));
    const xc = r.x + (wk + 1) * g.whiteW;

    // 黑块投在两侧与前下方白键上的影子：光从左上来，影子向右下偏
    // （viz.go:899-906；Canvas 无原生矩形阴影，paintShadow 三层近似）。
    const hb = keyBlackHalf(g, KB_BLACK_V);
    const yNose = keyY(g, KB_BLACK_V, lv, g.blackDrop) - keyLiftAt(g, KB_BLACK_V);
    const yBase = keyY(g, KB_BLACK_V, 0, 0);
    const yShadowTop = Math.max(yFall, yNose);
    paintShadow(context, xc - hb, yShadowTop, hb * 2, yBase - yShadowTop);

    // 键身：上表面与所跨白键之间的全部。侧楔先下——键的断面在两侧张开的楔；
    // 上表面最后压上去，边缘之下露出的部分才立得住（viz.go:908-911 Clip）。
    context.save();
    context.beginPath();
    context.rect(r.x, yFall, r.w, bottom - yFall);
    context.clip();

    const flank = dim(mix(PIANO_BLACK_LIT, glow, 0.06 + 0.16 * lv), 0.42);
    for (let k = 0; k < blackSlices; k += 1) {
      const v0 = KB_BACK_V + ((KB_BLACK_V - KB_BACK_V) * k) / blackSlices;
      const v1 = KB_BACK_V + ((KB_BLACK_V - KB_BACK_V) * (k + 1)) / blackSlices;
      const vm = (v0 + v1) / 2;
      const yt = keyY(g, vm, lv, g.blackDrop) - keyLiftAt(g, vm);
      const yb = keyY(g, vm, 0, 0);
      const hl0 = keyBlackHalf(g, v0);
      const hl1 = keyBlackHalf(g, v1);
      context.fillStyle = css(flank);
      context.fillRect(xc - hl1, yt, hl1 - hl0, yb - yt + 0.5);
      context.fillRect(xc + hl0, yt, hl1 - hl0, yb - yt + 0.5);
    }
    // 前脸：站在白键之上、光够得到的部位，也是键下沉时变短的部位（viz.go:924-929）。
    const nf = keyBlackHalf(g, KB_BLACK_V);
    const fh = keyY(g, KB_BLACK_V, 0, 0) - yNose;
    if (fh > 0.5) {
      vGrad(
        context,
        xc - nf,
        yNose,
        nf * 2,
        fh,
        css(dim(mix(PIANO_BLACK_LIT, glow, 0.08 + 0.22 * lv), 0.6)),
        css([2, 2, 5]),
      );
    }
    // 上表面压住全部（viz.go:931-941）。
    for (let k = 0; k < blackSlices; k += 1) {
      const v0 = KB_BACK_V + ((KB_BLACK_V - KB_BACK_V) * k) / blackSlices;
      const v1 = KB_BACK_V + ((KB_BLACK_V - KB_BACK_V) * (k + 1)) / blackSlices;
      const hw = keyBlackHalf(g, (v0 + v1) / 2);
      const y0 = keyY(g, v0, lv, g.blackDrop) - keyLiftAt(g, v0);
      const y1 = keyY(g, v1, lv, g.blackDrop) - keyLiftAt(g, v1);
      vGrad(
        context,
        xc - hw,
        y0,
        hw * 2,
        y1 - y0 + 0.75,
        css(blackShade(v0, lv, glow)),
        css(blackShade(v1, lv, glow)),
      );
    }

    context.restore();
  }

  // 琴盖板，和它压在键上的投影：键因此读作"嵌进琴体"而不是"贴在琴体上"
  // （viz.go:944-949）。
  vGrad(context, r.x, g.top - 2, r.w, yFall - g.top + 3, css(PIANO_CASE), css([8, 9, 13]));
  vGrad(context, r.x, yFall, r.w, 24, 'rgba(0,0,0,0.52)', 'rgba(0,0,0,0)');

  // 前面的键滑枕，被按下的键沉到它后面去（viz.go:951-954）。
  vGrad(context, r.x, yRail, r.w, bottom - yRail, css([62, 65, 79]), css([11, 12, 17]));
  context.fillStyle = 'rgba(132,136,152,0.45)';
  context.fillRect(r.x, yRail, r.w, 1);

  // 沉进滑枕的键在鼻端与滑枕之间开出一条暗键槽：按压因此读作"键在下沉"，
  // 而不是"键的前端变矮了"（viz.go:956-968）。
  for (let i = 0; i < whiteKeys; i += 1) {
    const lv = wPress[i];
    if (lv <= 0.05) continue;
    const hw = keyWhiteHalf(g, 1);
    const xc = r.x + (i + 0.5) * g.whiteW;
    vGrad(context, xc - hw, yRail, hw * 2, 7, `rgba(0,0,0,${0.55 * lv})`, 'rgba(0,0,0,0)');
  }
}
