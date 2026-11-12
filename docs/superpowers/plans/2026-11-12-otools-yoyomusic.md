# otools-yoyomusic 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把悠悠乐听（Go 桌面版）移植为 OTools 纯前端音乐播放器插件：panel 默认全功能 UI + 可选常驻主窗口 + 桌面歌词自定义悬浮窗，9 种可视化 + 10 段 EQ + 4 皮肤 + 曲库/歌单/队列/喜欢/历史/歌词全功能。

**Architecture:** 仓库源自 `otools-plugin-template` web 模式，`web/` 为 Vite+React19+TS 源码构建到 `dist/`。播放引擎 = `<audio>` + MediaElementSource → 10×BiquadFilter → AnalyserNode；音频文件经 `tools_webview_read_file` 整读转 Blob URL（传输层抽象，二期可换流式）。三窗口（panel/主窗口/桌面歌词）同 origin，靠查询参数分页，BroadcastChannel 总线承载：主控页单写者持久化、播放归属接管、控制命令。可视化移植 tauri 分支纯 Canvas 文件 + 按 Go `viz.go` 重写 3D 钢琴。

**Tech Stack:** React 19 + TypeScript(strict) + Vite 8 + zustand 5；vitest + jsdom + @testing-library/react；无其他运行时依赖（图标手绘 SVG 转录、无 UI 库）。

**Spec:** `docs/superpowers/specs/2026-11-12-otools-yoyomusic-design.md`（本文引用的 §N 均指该文档；执行者两份都要读。源码参考见 spec §15。）

## Global Constraints

- 纯前端 web 模式：不改宿主、无 Rust shell、无 native dylib；`dist/`、`node_modules/` 不入库。
- 不复制用户音乐文件进插件/宿主目录，只存原绝对路径。
- 生产 `.oplg` 不得含 `devUrl`/`quickDev`（verify 脚本强制）。
- 恒暗色玻璃拟态；4 套皮肤色值精确照抄 spec §8.6 表（aurora `#8b5cf6/#22d3ee/#0e0b1a/#171327/#f4f1ff` 为默认）。
- 布局常量精确照抄 spec §8.1–§8.5（`TOP_BAR_H=52`、`TRANSPORT_H=92`、`VIZ_DECK_INSET=17`、`LEFT_RAIL_W=268`、`RIGHT_RAIL_W=300`、`RAIL_TOP=60`、`RAIL_BOTTOM=100`、`MIN_W=820`、`MIN_H=560`）。
- 所有宿主能力运行时探测（spec §5.2），缺失即降级；`minOtoolsVersion:"0.9.0"`。
- 文案以 Go 版中文为准（spec §8 各空态/提示文案照抄）；i18n 仅 `zh-CN`/`en-US`。
- 无曲目 seek 条：惰性 6px 轨道 r3、Border@0.4（spec §8.4）。
- 历史上限 200 条；resume 跳过 ≤5s 或距结尾 <2s；缩略图 96px JPEG q0.75。
- 提交信息中文、按功能分批（subject+body）。
- Node ≥ 20；`vite.config.ts` dev 端口 `6482, strictPort:true`（对齐 plugin.json devUrl）。

## Review Focus

规格暗示但单元测试盖不住、最容易咬到使用者的五类输入（每条已在对应任务里落了钉子测试或冒烟步骤）：

1. **大 FLAC 换曲延迟**：30–60MB 整读 base64 需 1–3s，使用者会连点下一首 —— 必须有加载态 + 队列预读下一首（Task 6 钉子测试 + Task 16 冒烟）。
2. **双窗口并发写歌单**：panel 与主窗口同时操作，直接 patch 会丢更新 —— 主控页单写者（Task 3 选举测试 + Task 15 路由测试）。
3. **损坏/不完整音频文件**：导入时解析器不能抛异常崩 UI，必须落 `TrackBad`（Task 5 模糊字节测试）。
4. **localStorage 配额溢出**（浏览器直开、大曲库）：按 缩略图→历史→resume 顺序裁剪，不能白屏（Task 3 裁剪测试）。
5. **panel 失焦隐藏后宿主 dialog 返回不恢复**：dialog 关闭后必须调 `show_panel_window`（Task 15 冒烟清单步骤）。

---

### Task 1: 仓库脚手架与构建链

**Files:**
- Create: `D:\Repos\xyito\otools\otools-yoyomusic\`（新 git 仓库，从模板拷 `scripts/pack-plugin.mjs`、`scripts/verify-plugin.mjs`、`scripts/publish-market.mjs`、`scripts/publish-market.test.mjs`、`scripts/release-policy.mjs`、`scripts/release-policy.test.mjs`、`scripts/deploy-to-otools.ps1`、`scripts/serve-dist.mjs`、`scripts/fetch-cjk-fonts.mjs`、`.github/workflows/release-plugin.yml`，**不拷** shell/、web/、upstream*）
- Create: `plugin.json`、`logo.svg`、`.gitignore`（dist/ node_modules/ dist-pack/）、`package.json`、`tsconfig.json`、`vite.config.ts`、`vitest.config.ts`、`web/index.html`、`web/src/main.tsx`（先输出三路由占位页证明路由活）、`scripts/build-web.mjs`（改写）
- 设计文档与计划随仓库归档：把 `docs/superpowers/specs/2026-11-12-otools-yoyomusic-design.md` 与本计划拷入本仓库 `docs/`，并从超级工程删除原稿

**Interfaces:**
- Produces: `plugin.json`（spec §5.2 全文：`uuid/packid = "otools-yoyomusic"`、`openMode:"panel"`、`panelWidth:1100`、`panelHeight:720`、`customWindow` 按桌面歌词默认、`minOtoolsVersion:"0.9.0"`、`entry:"dist/index.html"`、`version:"0.1.0"`、`key`/`summary` 照 spec）；`web/index.html` 内含字符串 `otools`（verify 脚本要求 HTML 匹配 `/otools/i`）与三路由检测：`routeFromLocation()` 约定 `?lyrics=1→lyrics`、`?main=1→main`、否则 `panel`。
- Produces: `scripts/build-web.mjs`：执行 `vite build`（root=`web`，outDir=`../dist`，emptyOutDir）→ 校验 `dist/index.html` 存在且含 `/otools/i` → 退出码非 0 即失败。

- [ ] **Step 1: 建仓库与配置文件**

`git init`；`package.json`：`react@^19.2`、`react-dom@^19.2`、`zustand@^5`；devDeps：`vite@^8`、`@vitejs/plugin-react`、`typescript@~6.0`、`vitest`、`jsdom`、`@testing-library/react`、`@testing-library/jest-dom`；scripts：`dev=vite`、`build=node scripts/build-web.mjs`、`test=vitest run`。`tsconfig.json` strict、`jsx: react-jsx`、target es2022。`vite.config.ts` 含 `server:{port:6482,strictPort:true}`。

- [ ] **Step 2: 写 plugin.json + logo.svg**

`plugin.json` 按 spec §5.2 原样；`logo.svg`：135° 渐变圆（`#8b5cf6→#22d3ee`）+ 白色音符路径（呼应 Go 版 logo 回退样式），viewBox 64×64。

- [ ] **Step 3: web/index.html 三路由占位**

`web/index.html` 含 `<div id="root"></div>`、宿主桥占位注释、字符串 `otools`；`web/src/main.tsx` 按 `routeFromLocation()` 渲染占位文本（panel/main/lyrics）。

- [ ] **Step 4: 写 build-web.mjs 并验证**

Run: `npm install && npm run build`
Expected: `dist/index.html` 生成且含 "otools"；`grep -c otools dist/index.html` ≥ 1。

- [ ] **Step 5: vitest 冒烟**

`web/src/route.test.ts`：`routeFromLocation('index.html?lyrics=1')==='lyrics'`、`('index.html?main=1')==='main'`、`('index.html')==='panel'`。
Run: `npm test` Expected: 3 pass。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: 仓库脚手架（模板脚本 + Vite/React/TS 构建链 + plugin.json）"
```

---

### Task 2: 宿主桥与能力探测

**Files:**
- Create: `web/src/bridge/otools.ts`
- Test: `web/src/bridge/otools.test.ts`

**Interfaces:**
- Produces（后续所有任务依赖）:
```ts
export interface OToolsCaps { host: boolean; customWindow: boolean; panelWindow: boolean; hostState: boolean; hostDir: boolean; }
export function detectHost(): OToolsCaps                    // window.otools||window.utools 存在 → host
export function readFileBytes(path: string): Promise<Uint8Array>   // tools_webview_read_file base64→bytes；无宿主 → reject('no-host')
export function listDirectoryRecursive(dir: string): Promise<{path:string; size:number}[]>  // listHostDir 递归展开
export function pickAudioFiles(): Promise<string[] | null>  // dialog.open multiple+filters[mp3,wav,flac,ogg,aac,m4a,opus]；浏览器降级 input[type=file] → objectURL 数组 + null 语义=取消
export function pickDirectory(): Promise<string | null>
export function showPanelWindow(): Promise<void>            // invoke('show_panel_window')，无宿主 no-op
export function openPluginWindow(id: 'yoyomusic-main'|'yoyomusic-lyrics'): Promise<void>  // open_custom_plugin_window，options 照 spec §5.3/§9
export function closePluginWindows(): Promise<void>
export function isCustomWindow(): boolean                   // !!window.__OTOOLS_CUSTOM_WINDOW__
export function loadPersisted(): Promise<unknown | null>    // getPluginLocalState → null 兜底 localStorage 'yoyomusic.state.v1'
export function savePersisted(patch: Record<string, unknown>): Promise<void>  // patchPluginLocalState → localStorage 兜底
export function onLocale(cb: (l: 'zh-CN'|'en-US') => void): () => void
```
- 浏览器降级约定：`pickAudioFiles` 降级返回 objectURL 列表时，条目形如 `blob:` 前缀（Task 6 据此跳过路径重解析）。

- [ ] **Step 1: 写失败测试** — jsdom + mock `window.otools`：`detectHost` 各 cap 判定（有/无 `dialog`、`getPluginLocalState` 等）；`readFileBytes` 对 mock 返回 base64 `"SGVsbG8="` 解出 `Uint8Array [72,101,108,108,111]`；无宿主时 `readFileBytes` reject；`loadPersisted` 宿主缺失时读 localStorage。测试里用一个 `installFakeHost(caps)` 工具函数注入/清除全局。
- [ ] **Step 2: Run `npm test`** Expected: FAIL（模块不存在）。
- [ ] **Step 3: 实现 `otools.ts`** —— 所有宿主调用走 `window.otools.xxx ?? invoke(...)`,每处 try/catch 后落降级分支;`listDirectoryRecursive` 对目录 entry 递归（深度上限 8 层防环）。
- [ ] **Step 4: Run `npm test`** Expected: PASS。
- [ ] **Step 5: Commit** `feat: 宿主桥与能力探测（文件/目录/对话框/窗口/持久化封装）`

---

### Task 3: 跨窗口总线、主控页选举与持久化

**Files:**
- Create: `web/src/state/bus.ts`、`web/src/state/leader.ts`、`web/src/state/persist.ts`
- Test: `web/src/state/leader.test.ts`、`web/src/state/persist.test.ts`

**Interfaces:**
- Consumes: Task 2 `savePersisted/loadPersisted`。
- Produces:
```ts
export type BusMsg =
  | { t:'claim'; epoch:number; from:string } | { t:'hello'; from:string }
  | { t:'state-mutate'; key:'library'|'settings'|'window'; patch:unknown; from:string }  // desktopLyrics 归 settings;window=窗口位置
  | { t:'state-snap'; snap:Record<string,unknown>; from:string }
  | { t:'takeover'; epoch:number; from:string } | { t:'owner-gone'; from:string }
  | { t:'cmd'; op:'play'|'pause'|'toggle'|'next'|'prev'|'seek'|'volume'|'mute'|'setTrack'; arg?:unknown; from:string }
  | { t:'playback'; state:unknown; from:string };
export function createBus(): { post(m:BusMsg):void; on(h:(m:BusMsg)=>void):()=>void }   // BroadcastChannel('yoyomusic')，不可用→localStorage storage 事件兜底
export function createLeader(bus): { readonly isLeader:boolean; handle(m:BusMsg):boolean; onRemoteState(h:(k:string,v:unknown)=>void):()=>void; onCommand(h:(m:BusMsg)=>void):()=>void }
// 选举: epoch=Date.now() 起步,claim 首者胜,2s 心跳,3× 心跳超时接管重选,unload 广播 owner-gone+重选
export function createPersistence(opts:{ isLeader:()=>boolean; getSnapshot:()=>Record<string,unknown>; }):
  { scheduleSave(key:'settings'|'library'):void; flushPosition():void; flushNow():Promise<void> }
// 节流: settings 400ms / library 1500ms / flushPosition 每 5s;仅 isLeader 时真正落盘
// localStorage 兜底配额裁剪顺序: coverThumb → history(截到 50) → resume(清空) → 再失败抛出
```

- [ ] **Step 1: 写失败测试（leader.test.ts，fake timers + 内存版 bus）** — ① 两页同时 claim：epoch 小者胜、后到者 `isLeader===false`；② 非主控页 `handle({t:'state-mutate'})` 返回 false 且转发 post；③ 主控页收到 `state-mutate` 应用到 onRemoteState 回调；④ 心跳超时触发重选（advance 7s）。
- [ ] **Step 2: 写失败测试（persist.test.ts）** — ① 非主控页 `scheduleSave('library')` 不调用 `savePersisted`；② 主控页 1500ms 后调用一次（debounce 合并多次调用）；③ localStorage 写入抛 QuotaExceeded 时按序删 `coverThumb`→`history`→`resume` 后重试成功；④ `flushPosition` 每 5s 至多一次。
- [ ] **Step 3: Run `npm test`** Expected: FAIL。
- [ ] **Step 4: 实现三个模块**（bus 兜底用 `localStorage.setItem('__yoyomusic.bus', JSON.stringify(msg))` + `storage` 事件；leader 状态机见上）。
- [ ] **Step 5: Run `npm test`** Expected: PASS。
- [ ] **Step 6: Commit** `feat: 跨窗口总线/主控页选举/节流持久化（单写者规则）`

---

### Task 4: Store 与曲库数据模型

**Files:**
- Create: `web/src/state/store.ts`、`web/src/state/logic.ts`（纯函数，便于测试）
- Test: `web/src/state/logic.test.ts`、`web/src/state/store.test.ts`

**Interfaces:**
- Produces:
```ts
export type PlayMode = 'sequence'|'repeat_all'|'repeat_one'|'shuffle'
export type TrackStatus = 'ok'|'bad'|'missing'
export interface Track { id:string; path:string; title:string; artist:string; album:string; durationMs:number; status:TrackStatus; liked:boolean; coverThumb?:string; hasLyrics:boolean }
export interface Playlist { id:string; name:string; trackIds:string[]; currentIndex:number; playMode:PlayMode }
export function nextIndex(mode:PlayMode, idx:number, len:number): number   // 移植 Go state.go:856-876：sequence 末尾停(repeat_all 回 0)、repeat_one 原地、shuffle (idx+1)%len
export function prevIndex(mode:PlayMode, idx:number, len:number): number
export function queueInsertAfter(queue:string[], anchorId:string|null, id:string): string[]  // anchorId=null→队首；已存在→移动
export function queueAppend(queue:string[], id:string): string[]
export function queueMove(queue:string[], id:string, delta:1|-1): string[]   // 光标跟随，移植 Go state.go:500-577
export function filterTracks(tracks:Track[], q:string): Track[]              // title/artist/album 不区分大小写子串
export function relativeTime(ts:number, now:number): string                  // 刚刚/N分钟前/N小时前/N天前/MM-DD
export function useStore(): zustand store —— slices:
//   library:{tracks:Record<string,Track>, playlists:Record<string,Playlist>, currentPlaylist:'default', history:{trackId,playedAt}[]}
//   playback:{trackId?:string, positionMs, durationMs, volume, muted, playMode, eqEnabled, eqBands:number[10]}
//   settings:{skin:'aurora', vizMode:VizMode, vizRandom:false, restoreSession:true, desktopLyrics:{colorIdx:0,fontScale:1,locked:false}, lang}
//   ui:{libraryOpen, libraryPinned, libraryTab:0..4, query, browse:{kind:'album'|'artist', name?}, sidePanel:'eq'|'lyrics'|'skins'|'about'|null, panelsPinned, renamingId?}
// actions: importTracks, setTrackMeta(id,meta), like(id), addPlaylist/renamePlaylist/deletePlaylist(default 保护)/switchPlaylist,
//   addToPlaylist/removeFromPlaylist, queueOps(调用 logic), playTrack(id), advance(1|-1), setEQ, setVolume, setMuted,
//   pushHistory(trackId)(连续重复只更新时间戳,cap 200), recordResume(trackId,ms)(≤5000 或 距尾<2000 不记)
```

- [ ] **Step 1: 写失败测试（logic.test.ts）** — `nextIndex('sequence',2,3)===-1 表示停止`（返回约定：sequence 到尾返回 -1，调用方停止）、`nextIndex('repeat_all',2,3)===0`、`nextIndex('repeat_one',1,3)===1`、`nextIndex('shuffle',1,3)===2`；`prevIndex` >3s 语义在 store 层；`queueInsertAfter(['a','b','c'],'b','c')===['a','b','c']`（已存在→移动到 anchor 后）；`queueMove` 首元素 delta=1 与末元素 delta=-1 光标跟随；`relativeTime(now-30_000)=== '刚刚'`、`-(40*60_000)==='40分钟前'`、`-(25*3600_000)==='1天前'`；`filterTracks` 大小写不敏感。
- [ ] **Step 2: 写失败测试（store.test.ts）** — `pushHistory` 连续同曲两次后 length===1 且时间戳更新；push 3 条不同后 cap 测试（循环 205 次 length===200）；`recordResume(5000)` 不记、`recordResume(5001)` 记；`deletePlaylist('default')` 无效；删除当前歌单回落 `default`；`advance('repeat_all')` 越尾回 0。
- [ ] **Step 3: Run `npm test`** Expected: FAIL。
- [ ] **Step 4: 实现 logic.ts + store.ts**（default 歌单 = 全库视图，name `当前播放列表`；新建歌单默认名 `我的歌单`）。
- [ ] **Step 5: Run `npm test`** Expected: PASS。
- [ ] **Step 6: Commit** `feat: 全局 store 与曲库/队列/历史/恢复点纯逻辑`

---

### Task 5: 元数据解析器（5 格式）

**Files:**
- Create: `web/src/audio/metadata/index.ts`（嗅探分发）、`id3v2.ts`、`flac.ts`、`ogg.ts`、`wav.ts`、`mp4.ts`
- Test: `web/src/audio/metadata/fixtures.ts`、`index.test.ts`

**Interfaces:**
- Produces:
```ts
export interface TrackMeta { kind:'mp3'|'flac'|'ogg'|'wav'|'mp4'|'unknown'; title?:string; artist?:string; album?:string; durationMs?:number; coverBytes?:Uint8Array; lyricsText?:string; }
export function parseMetadata(bytes:Uint8Array, fileName:string): TrackMeta
// 不抛异常:任何非法结构→kind:'unknown' + fileName 兜底 title
```
- 解析要点（spec §6.4 表）：ID3v2.3/2.4 TIT2/TPE1/TALB/APIC/USLT，Xing/VBRI 或 CBR=文件大小×8/比特率；FLAC STREAMINFO totalSamples、VORBIS_COMMENT、PICTURE、`LYRICS`/`UNSYNCEDLYRICS`；ogg 末页 granule/采样率、METADATA_BLOCK_PICTURE；wav fmt+data 块；mp4 moov/mvhd timescale+duration、ilst ©nam/©ART/©alb/©lyr/covr。

- [ ] **Step 1: 写 fixtures.ts** — 用 `Uint8Array` 字面量构造最小合法样本：①ID3v2.4（TIT2="Song A"/TPE2="Artist X" + 1 帧 CBR 128kbps 头）②带 Xing 头的 mp3（VBR 帧数 120×26.12ms）③FLAC("fLaC"+STREAMINFO totalSamples=44100×30, sampleRate 44100)④OGG 两页（末页 granule=44100×30）⑤MP4(mvhd timescale 1000,duration 30000)⑥WAV(fmt 44100 + data size)。每个 fixture 同时给一个 **corrupt** 变体（截断/坏魔数）。
- [ ] **Step 2: 写失败测试** — 各 fixture 断言 title/artist/durationMs 精确值（例：Xing 120 帧@44100 → durationMs===3135±1；FLAC 30s===30000）；corrupt 变体全部 `kind:'unknown'` 且不抛；无标签 mp3 → title 兜底 fileName 去扩展名。
- [ ] **Step 3: Run `npm test`** Expected: FAIL。
- [ ] **Step 4: 实现五个解析器**（每个 ≤200 行，互不 import 对方；共用 `bytes.ts` 的 u32/u64/utf8 读法）。
- [ ] **Step 5: Run `npm test`** Expected: PASS。
- [ ] **Step 6: Commit** `feat: mp3/flac/ogg/wav/mp4 元数据解析器（含损坏文件防御）`

---

### Task 6: BlobTransport、导入与元数据爬虫

**Files:**
- Create: `web/src/audio/transport.ts`、`web/src/library/import.ts`、`web/src/library/crawler.ts`
- Test: `web/src/library/crawler.test.ts`、`web/src/audio/transport.test.ts`

**Interfaces:**
- Consumes: Task 2 `readFileBytes/pickAudioFiles/pickDirectory/listDirectoryRecursive`、Task 4 store `importTracks/setTrackMeta`、Task 5 `parseMetadata`。
- Produces:
```ts
export interface AudioTransport { resolve(path:string):Promise<string>; readBytes(path:string):Promise<Uint8Array>; revoke(url:string):void }
export function createBlobTransport(): AudioTransport
// resolve = readFileBytes→base64 解码→new Blob→URL.createObjectURL；revoke 统一释放
export function createCrawler(opts:{ transport; concurrency?:2; onTrack:(path,meta)=>void; onThumb:(path,dataUrl:string)=>void; isCancelled:()=>boolean; priority:()=>string[]|null }): { push(paths:string[]); cancel():void; done:Promise<void> }
// 队列: priority() 返回当前可见行 path(置顶);并发 2;单个失败→onTrack 标 status:'missing'(读失败)或 'bad'(解析 unknown)
// 封面: 有 coverBytes 时 createImageBitmap→canvas 96×96 居中裁切→toDataURL('image/jpeg',0.75)→onThumb(spec §6.4)
export async function makeThumb(coverBytes:Uint8Array): Promise<string>
export async function importFromDialog(): Promise<void>   // pickAudioFiles→建行(title=文件名,durationMs=0)→crawler.push
export async function importFromDirectory(): Promise<void> // pickDirectory→listDirectoryRecursive 过滤扩展名→同上
```
- 预读：transport 维护 `prime(path)`（下一首后台 resolve 缓存，容量 1，换曲即换）——spec Review Focus #1。

- [ ] **Step 1: 写失败测试（crawler.test.ts，mock transport）** — ① 10 个 path 并发≤2（用计数器峰值断言）；② `isCancelled` 置 true 后不再产生 onTrack；③ priority 队列让可见行先完成（完成顺序断言前 2 个）；④ readFileBytes reject → onTrack 收到 `status:'missing'`；⑤ parseMetadata unknown → `status:'bad'`。
- [ ] **Step 2: 写失败测试（transport.test.ts）** — mock readFileBytes 返回 `"//uQx"`,resolve 返回 `blob:` URL 且 `revoke` 调用 `URL.revokeObjectURL`（stub）；`prime('a')` 后 `resolve('a')` 不再触发第二次底层读取。
- [ ] **Step 3: Run `npm test`** Expected: FAIL。
- [ ] **Step 4: 实现**（base64→bytes 用 `atob`+循环，勿引依赖）。
- [ ] **Step 5: Run `npm test`** Expected: PASS。
- [ ] **Step 6: Commit** `feat: Blob 传输层 + 曲库导入与后台元数据爬虫（可取消/优先级/预读）`

---

### Task 7: 音频引擎

**Files:**
- Create: `web/src/audio/engine.ts`、`web/src/audio/eq.ts`（纯数据）
- Test: `web/src/audio/eq.test.ts`、`web/src/audio/engine-pure.test.ts`

**Interfaces:**
- Consumes: Task 6 transport、Task 4 store、Task 3 bus（命令/接管）。
- Produces:
```ts
export const EQ_FREQS = [31,62,125,250,500,1000,2000,4000,8000,16000]
export const EQ_PRESETS = { flat:[0,0,0,0,0,0,0,0,0,0], rock:[5,4,2.5,0,-1.5,-1,1,2.5,3.5,4], pop:[-1,1,3,4,3,1,-0.5,-1,0,1.5], classical:[3,2.5,1.5,0.5,-0.5,-1,-1.5,0,2.5,3], bass:[8,7,5.5,3,0.5,-1,-2,-2.5,-2,-1.5], vocal:[-2.5,-1.5,0.5,3,4.5,4.5,3,1.5,0,-1], treble:[-2,-1.5,0,0.5,1,2,3.5,4.5,5,5.5] }  // 平直/摇滚/流行/古典/重低音/人声/高音,±12dB
export class AudioEngine {
  constructor(el: HTMLAudioElement, getAnalyserFrame: ()=>{bins:Uint8Array; wave:Uint8Array; sampleRate:number}|null)
  takeOver(epoch:number): void                 // 广播 takeover;其他引擎实例静音挂起
  load(url:string, trackId:string): void; play(); pause(); seek(ms:number); setVolume(v); setMuted(b)
  setEQ(enabled:boolean, gains:number[]): void // BiquadFilterNode peaking Q=1.414 ×10 串联
  attachStoreHooks(h:{ onEnded():void; onError():void; onTime(ms:number):void }): void
}
export function unmuteVolume(v:number, muted:boolean, newMuted:boolean): number  // 取消静音且 v===0 → 0.5 (spec §6.2)
export function shouldRecordResume(posMs:number, durMs:number): boolean          // >5000 && dur-pos>2000
```
- 事件驱动：`ended→advance(nextIndex)`、`error→TrackBad + PushError 提示`、`timeupdate→onTime`（spec §6.2，隐藏窗口不依赖定时器 —— Review Focus #5）。

- [ ] **Step 1: 写失败测试（eq.test.ts）** — 7 预设各 10 项、全在 [-12,12]、flat 全 0；`buildFilterParams(freq,gain)` 返回 `{type:'peaking', frequency:freq, Q:1.414, gain}`。
- [ ] **Step 2: 写失败测试（engine-pure.test.ts）** — `unmuteVolume(0,false,false)===0.5`、`(0.3,false,false)===0.3`；`shouldRecordResume(3000,200000)===false`、`(6000,200000)===true`、`(6000,7000)===false`。
- [ ] **Step 3: Run `npm test`** Expected: FAIL。
- [ ] **Step 4: 实现 eq.ts + engine.ts**（jsdom 无 WebAudio：engine 的节点连接部分用惰性 `getAudioContext()`，单测只覆盖纯函数；整链行为列入 Task 16 宿主冒烟）。
- [ ] **Step 5: Run `npm test`** Expected: PASS。
- [ ] **Step 6: Commit** `feat: 播放引擎（EQ 链/播放语义/事件驱动推进/归属接管）`

---

### Task 8: 频谱信号（折带/节拍/合成）

**Files:**
- Create: `web/src/signal/analyse.ts`（AnalyserNode→frame）、`web/src/signal/synth.ts`
- 移植（`git -C D:\Repos\xyito\lingyun\YoYoMusic show tauri:src/features/visualization/signal.ts > web/src/signal/engine.ts`，剥离 React 依赖）：attack 22/s、release 6.5/s、IDLE_FLOOR 0.045、呼吸 `1+sin(t*0.9)*0.35`、粉噪 tilt `pow(1-r,1.35)*0.88+0.12`、kick `pow(1-r,2.2)`、BPM 92–138、wave 4 镜像部分波(2,5,11,19)。
- Test: `web/src/signal/analyse.test.ts`、`web/src/signal/synth.test.ts`

**Interfaces:**
- Produces:
```ts
export const BAND_COUNT = 56
export function bandEdges(sampleRate:number, binCount:number): number[]   // 40Hz..min(16000,nyquist) 按频率对数分边
export function foldBands(bins:Uint8Array, edges:number[]): Float32Array  // 带内均值
export function normalizeBands(bands:Float32Array, peakRef:{v:number}): Float32Array  // 峰值×0.94/帧衰减 + log1p(r*9)/log(10)
export function computeLevel(wave:Uint8Array): number   // RMS×3.2 clamp 0..1
export function computeBeat(bands:Float32Array, st:{ema:number; pulse:number}, dt:number): number // <150Hz 能量>1.35×EMA(0.92/0.08) → snap, exp(-dt*6.5) 衰减
export interface SignalFrame { bands:Float32Array; wave:Float32Array; level:number; beat:number }
export function makeSynth(seed:string): { update(dt:number, playing:boolean): SignalFrame }  // FNV-1a→mulberry32
```

- [ ] **Step 1: 写失败测试（analyse.test.ts）** — 48000Hz/4096bins → `bandEdges` 长 57、首边≥40Hz 对应 bin、末边≤16000Hz；`foldBands` 单 bin 突起落对应带；`normalizeBands` 峰值衰减：输入恒定 0.5 两帧后 peakRef≈0.47；`computeBeat` bass 尖峰后 beat>0.5、300ms 无峰后衰减 <0.2。
- [ ] **Step 2: 写失败测试（synth.test.ts）** — 同 seed 两次 `makeSynth` 第 60 帧输出 deep-equal（确定性）；paused 300 帧后 level∈(0.02,0.2)（呼吸非零）；playing 时 beat 周期性 >0.4（BPM 节拍）。
- [ ] **Step 3: Run `npm test`** Expected: FAIL。
- [ ] **Step 4: 实现 analyse.ts + 移植 synth**（engine.ts 移植后 export `makeSynth` 适配层包住 SignalEngine）。
- [ ] **Step 5: Run `npm test`** Expected: PASS。
- [ ] **Step 6: Commit** `feat: 56 带频谱折带/节拍检测/合成信号引擎（口径对齐 Go 版）`

---

### Task 9: 可视化（移植 8 种 + 3D 钢琴重写）

**Files:**
- 移植: `git show tauri:src/features/visualization/{drawModes.ts,generative.ts,modes.ts}` → `web/src/viz/`；`spectrum.ts` 不整拷（Task 8 已覆盖其纯函数）
- Create: `web/src/viz/piano.ts`、`web/src/viz/Visualizer.tsx`、`web/src/viz/registry.ts`
- Test: `web/src/viz/registry.test.ts`、`web/src/viz/piano.test.ts`

**Interfaces:**
- Consumes: Task 8 `SignalFrame`、Task 10 palette（接口先行：`palette:{a,b,ink}` 由调用方注入）。
- Produces:
```ts
export const VIZ_MODES = ['spectrum','waveform','radial','aurora','particles','waterfall','generative','kaleidoscope','piano'] as const
export const VIZ_LABELS: Record<VizMode,string>   // 频谱柱/示波波形/环形律动/音浪绸带/粒子星尘/镜像瀑布/生成动画/万花筒/钢琴
export type VizMode = (typeof VIZ_MODES)[number]
export function drawFrame(ctx:CanvasRenderingContext2D, w:number, h:number, mode:VizMode, frame:SignalFrame, palette:{a:string;b:string;ink:string}, state:RenderState, dt:number): void
// piano 常量(spec §7): 14 白键+10 黑键、kbPersp .16、kbBackV .17、黑键止 0.76、白键远端收窄 18%、黑键宽 0.52、lift .125、
// 键盘高 min(.30H,168)、前沿 clamp(.125*total,10,22)、白键降 clamp(.065*total,5,11)、
// 白键 RGB(112,118,142)→(241,244,250)、黑键 (13,14,20)→(58,61,74)、琴体 (26,27,36)、按下 lerp .5 / 释放 .6/s、beat 沉 .10/.08
```
- Visualizer.tsx：rAF 循环、DPR≤2、ResizeObserver、dt clamp 0–0.05、`prefers-reduced-motion` 单帧、palette 从当前 skin 直读、随机轮换 5–20s（spec §7）。

- [ ] **Step 1: 执行移植拷贝 + 编译适配** — `drawModes/generative/modes` 拷入后仅改：调色板参数化（去 CSS 变量读取）、去 `import ... from 'react'`；`generative` 保持单模式（5 场景内部轮换，spec §7 拍板）。
- [ ] **Step 2: 写失败测试（piano.test.ts）** — `kbWhiteCount()===14`、`kbBlackCount()===10`；`projectKey(x,vBase,vTop)` 远端 x 收窄 = 近端×0.82；`keyPress(1,dt=1/60)` 上升后 `keyRelease` 按 0.6/s 衰减；beat=1 时白键高度沉 0.10。registry.test：`VIZ_MODES.length===9`、drawFrame 对 9 模式各跑 1 帧（offscreen canvas stub）不抛。
- [ ] **Step 3: Run `npm test`** Expected: FAIL。
- [ ] **Step 4: 实现 piano.ts（从 Go viz.go:652-1033 逐段转录公式）+ registry + Visualizer.tsx**。
- [ ] **Step 5: Run `npm test`** Expected: PASS。
- [ ] **Step 6: Commit** `feat: 9 种可视化（tauri 8 种移植 + 3D 钢琴 Canvas 重写）`

---

### Task 10: 皮肤与 i18n

**Files:**
- Create: `web/src/theme/skins.ts`、`web/src/theme/tokens.ts`、`web/src/i18n/index.ts`、`web/src/i18n/zh-CN.ts`、`web/src/i18n/en-US.ts`
- Test: `web/src/theme/skins.test.ts`、`web/src/i18n/i18n.test.ts`

**Interfaces:**
- Produces:
```ts
export interface Skin { id:'aurora'|'midnight'|'sunset'|'mint'; name:string; primary:string; accent:string; bg:string; surface:string; ink:string; vizA:string; vizB:string; vizInk:string; author?:string }
export const SKINS: Skin[]   // 4 套色值精确照抄 spec §8.6/Go state.go:168-191 (aurora/midnight/sunset/mint 全表)
export function applySkin(s:Skin): void          // 写 CSS 变量 --skin-* / --viz-a 等
export function t(key:string, vars?): string     // zh-CN 源文案表(含 spec §8 全部中文文案),en-US 翻译;缺失键回退 zh-CN
export function currentLocale(): 'zh-CN'|'en-US' // __OTOOLS_LOCALE__ → navigator.language → zh-CN
```

- [ ] **Step 1: 写失败测试** — `SKINS.length===4`、`SKINS[0]` 深等 aurora 全表值、`SKINS.find(s=>s.id==='mint').primary==='#34d399'`；`applySkin` 后 `document.documentElement.style.getPropertyValue('--skin-primary')==='#8b5cf6'`；`t('library.empty')` 返回 Go 原文案 `"还没有音乐。点右上角的 + 导入音乐或文件夹。"`；en 缺键回退中文；locale mock `__OTOOLS_LOCALE__={locale:'en-US'}` 时 `currentLocale()==='en-US'`。
- [ ] **Step 2: Run `npm test`** Expected: FAIL。
- [ ] **Step 3: 实现**（文案表先收录本计划后续任务会用到的全部 key，zh 为准 en 补译）。
- [ ] **Step 4: Run `npm test`** Expected: PASS。
- [ ] **Step 5: Commit** `feat: 4 套内置皮肤 + zh/en i18n`

---

### Task 11: 布局壳、顶栏与通用 UI 件

**Files:**
- Create: `web/src/ui/constants.ts`（spec §8.1 全表）、`web/src/ui/AppLayout.tsx`、`web/src/ui/TopBar.tsx`、`web/src/ui/IconButton.tsx`、`web/src/ui/Tooltip.tsx`、`web/src/ui/Menu.tsx`（portal 菜单+子菜单）、`web/src/ui/SegmentedControl.tsx`、`web/src/ui/icons.tsx`（Go icons.go 全套 24×24 SVG 转录）、`web/src/ui/useIdleFold.ts`、`web/src/ui/dragRegion.ts`
- Test: `web/src/ui/useIdleFold.test.ts`、`web/src/ui/Menu.test.tsx`、`web/src/ui/constants.test.ts`

**Interfaces:**
- Consumes: Task 4 store（ui slice）、Task 9 `VIZ_MODES/VIZ_LABELS`、Task 10 `t()`。
- Produces:
```ts
export const LAYOUT = { TOP_BAR_H:52, TRANSPORT_H:92, VIZ_DECK_INSET:17, LEFT_RAIL_W:268, RIGHT_RAIL_W:300, RAIL_TOP:60, RAIL_BOTTOM:100, MIN_W:820, MIN_H:560 } as const
export function useIdleFold(opts:{ idleMs:10000; leaveMs:3000; pinned:boolean; sticky?:boolean }): { folded:boolean; notifyActivity():void; notifyLeave():void; notifyEnter():void }
// 右栏 10s 静止/左栏离开 3s;pinned 或 sticky 永不折叠;收起时不渲染内容(spec §1.3)
export function IconButton({ size, radius, active, label, onClick })  // 32×32 r8 默认,active=accent@0.22
export function Menu({ items }) // items:{label,checked?,disabled?,children?|onPick?},portal+点击外部/Esc 关闭
export function SegmentedControl({ tabs:string[], value, onChange }) // 5×2字标签,高 28,药丸滑动 r6 accent
```

- [ ] **Step 1: 写失败测试（constants.test.ts）** — 逐项深等 LAYOUT 全部值（防手滑）。
- [ ] **Step 2: 写失败测试（useIdleFold.test.ts，fake timers）** — pinned=true 任意 advance 不折叠；idleMs=10000 静止后 folded=true；notifyActivity 重置；leave 后 3000ms 折叠、enter 立即展开。
- [ ] **Step 3: 写失败测试（Menu.test.tsx，testing-library）** — 打开菜单出现 portal 节点；点击子菜单项展开二级；Esc 关闭；disabled 项点击无回调。
- [ ] **Step 4: Run `npm test`** Expected: FAIL。
- [ ] **Step 5: 实现** — AppLayout 三层绝对定位（背景层 `top:52,bottom:75` / chrome 列 / 浮层两栏）；TopBar 组合 logo+曲库开关+可视化菜单+4 面板按钮（主窗口页另有自绘 min/max/close，panel 页无）；图标按 Go `icons.go` 全套转录成 React 组件（逐一对照：list/album/artist/history/like/heart-fill/search/plus/pin/eq/lyrics/lyrics-screen/skins/about/play/pause/prev/next/sequence/repeat/repeat-one/shuffle/volume-high/mid/low/mute/chevron-down/right/back/close/check/music...）；Space 键 toggle 播放挂在 AppLayout。
- [ ] **Step 6: Run `npm test`** Expected: PASS。
- [ ] **Step 7: Commit** `feat: 三层布局壳/顶栏/通用件（菜单/分段器/Tooltip/图标库/idle 折叠）`

---

### Task 12: 左栏曲库/歌单

**Files:**
- Create: `web/src/ui/left-rail/PlaylistSelector.tsx`、`LibraryTabs.tsx`、`TrackRow.tsx`、`BrowseView.tsx`、`HistoryView.tsx`、`LikesView.tsx`、`SearchField.tsx`、`ImportMenu.tsx`
- Modify: `web/src/ui/AppLayout.tsx`（挂左栏）
- Test: `web/src/ui/left-rail/views.test.tsx`

**Interfaces:**
- Consumes: Task 4 store 全 actions、Task 6 `importFromDialog/importFromDirectory`、Task 11 通用件、Task 10 文案。
- Produces: 行为约定 —— 曲目行右键菜单项（依序）：`下一首播放 / 添加到歌单 ▸ / 加到队列末尾 / 上移 / 下移 / 从当前歌单移除`（default 视图无移除项，spec §8.3）；播放中行 accent@0.16；专辑/歌手斑马纹 + 下钻返回钮 56×28 r7；空态文案照抄 Go。

- [ ] **Step 1: 写失败测试（views.test.tsx，mock store）** — ① trackRow 渲染 index chip/标题/歌手/时长/♥；点击行调用 `playTrack`；② 右键出菜单且 default 视图无"从当前歌单移除"、非 default 有；点"下一首播放"调用 `queueInsertAfter(current)`；③ `BrowseView` 分组计数文案 `artist · N 首`；④ 历史行用 `relativeTime`；⑤ 搜索框输入过滤行数；⑥ 空态渲染 Go 原文案。
- [ ] **Step 2: Run `npm test`** Expected: FAIL。
- [ ] **Step 3: 实现七个组件**（歌单下拉/重命名内联 Enter 提交 Esc 取消；"+" 菜单两项；图钉切换 pinned）。
- [ ] **Step 4: Run `npm test`** Expected: PASS。
- [ ] **Step 5: Commit** `feat: 左栏曲库/歌单（5 页签/上下文菜单/浏览/历史/喜欢/搜索/导入）`

---

### Task 13: 播放条与右栏四面板

**Files:**
- Create: `web/src/ui/transport/Transport.tsx`、`SeekSlider.tsx`、`VolumeControl.tsx`、`web/src/ui/right-rail/EQPanel.tsx`、`LyricsPanel.tsx`（含桌面歌词开关钮）、`SkinsPanel.tsx`、`AboutPanel.tsx`、`RightRail.tsx`
- Modify: `web/src/ui/AppLayout.tsx`
- Test: `web/src/ui/transport/transport-pure.test.ts`、`web/src/ui/right-rail/panels.test.tsx`

**Interfaces:**
- Consumes: Task 4/7/9/10/14 全部、Task 11 件。
- Produces:
```ts
export function muteIconKind(v:number, muted:boolean): 'high'|'mid'|'low'|'mute'   // muted→mute;else v>0.67→high,>0.34→mid,else low(spec §8.4)
export function useScrubHold(durMs:number, posMs:number, holdMs=250): { value:number; onScrub(v):void }  // 拖动期屏蔽回填,250ms 静默后恢复
export const PLAY_MODE_CYCLE: PlayMode[] = ['sequence','repeat_all','repeat_one','shuffle']  // 单钮循环切换
```

- [ ] **Step 1: 写失败测试（transport-pure）** — `muteIconKind` 四分支精确值；`useScrubHold`（fake timers）：scrub 中外部 pos 变化不反映、停手 250ms 后反映。
- [ ] **Step 2: 写失败测试（panels.test.tsx）** — EQ 面板渲染 7 预设按钮 + 10 行滑条（标签 `31/62/125/250/500/1k/2k/4k/8k/16k`）；歌词面板含桌面歌词开关钮；皮肤面板 4 卡片、激活卡有 ✓ 且 accent@0.16；关于面板含"悠悠乐听" 18px Bold 标题与版本行、**无**更新按钮。
- [ ] **Step 3: Run `npm test`** Expected: FAIL。
- [ ] **Step 4: 实现** — Transport 精确照 spec §8.4（封面 48×48 r10 渐变兜底、按钮尺寸、时间文本、播放模式 tooltip=`PlayModeLabel+（点击切换）`）；EQ 滑条 ±12dB 联动 `setEQ`；SkinsPanel 点卡即 `applySkin` + 存 settings。
- [ ] **Step 5: Run `npm test`** Expected: PASS。
- [ ] **Step 6: Commit** `feat: 播放条与右栏（EQ/歌词/外观/关于四面板）`

---

### Task 14: 歌词（解析 + 面板高亮）

**Files:**
- Create: `web/src/lyrics/lrc.ts`、`web/src/lyrics/resolve.ts`、Modify: `web/src/ui/right-rail/LyricsPanel.tsx`（接真数据）
- Test: `web/src/lyrics/lrc.test.ts`

**Interfaces:**
- Consumes: Task 2 `readFileBytes`、Task 5 `TrackMeta.lyricsText`、Task 4 store。
- Produces:
```ts
export interface LyricLine { timeMs:number; text:string }
export function parseLrc(text:string): LyricLine[]   // 多时间戳行/[offset:+ms|-ms]/元数据标签跳过/无时间戳行→t=0/空行保留为占位
export function lineAt(lines:LyricLine[], posMs:number, offsetMs=0): number  // 最大 timeMs<=pos+offset 的下标;-1 无
export async function resolveLyrics(track:Track, read:(p:string)=>Promise<Uint8Array>): Promise<{ lines:LyricLine[]; source:'sidecar'|'embedded'|'none' }>
// 顺序: 同名 .lrc(含大小写两种探测)→track.hasLyrics 时从缓存 meta.lyricsText
```

- [ ] **Step 1: 写失败测试** — `[00:10.5][00:20]双时间戳行` 产出两行；`[offset:500]` 整体平移；`[ti:xx]` 跳过；无时间戳行 t=0；`lineAt` 边界（恰等于/略小于/无匹配→-1）；sidecar 优先于 embedded（mock read 返回假 .lrc）。
- [ ] **Step 2: Run `npm test`** Expected: FAIL。
- [ ] **Step 3: 实现** — LyricsPanel：当前行 15px Bold 高亮其余 13px muted，空行渲染 10px spacer（spec §8.5）。
- [ ] **Step 4: Run `npm test`** Expected: PASS。
- [ ] **Step 5: Commit** `feat: LRC 解析与歌词面板（同名 .lrc → 内嵌兜底）`

---

### Task 15: 窗口编排、桌面歌词页与跨窗口集成

**Files:**
- Create: `web/src/windows/routes.tsx`（panel/main/lyrics 三入口装配）、`web/src/windows/desktop-lyrics/LyricsWindow.tsx`、`web/src/windows/main-window/ChromeControls.tsx`、`web/src/windows/ownership.ts`（引擎归属 + cmd 路由 + 状态镜像接线）、Modify: `web/src/main.tsx`
- Test: `web/src/windows/desktop-lyrics/lyrics-pure.test.ts`、`web/src/windows/ownership.test.ts`

**Interfaces:**
- Consumes: Task 2/3/6/7 全部。
- Produces:
```ts
export const LYRICS_COLORS = ['#ffffff','#ffd666','#78e6ff','#ffa0c8','#a0ffaa'] as const   // 白/金/青/粉/绿(spec §9)
export function nextColorIdx(i:number): number          // 循环
export function clampFontScale(v:number): number        // clamp 0.6..3,步进 0.15
export function mountOwnership(deps:{ engine:AudioEngine; bus; leader; store }): { handle(m:BusMsg):void }
// 规则(spec §5.3):本页播放→takeover;他页 owner 时本页变控制端只发 cmd;owner-gone→全端停;
// 主控页收 state-mutate 应用+scheduleSave;lyrics 页永不 takeover
```
- 桌面歌词页：pill `padding:12px 26px,r18,surface@0.42`；当前行 34×scale Bold、下行 20×scale@0.55；hover 工具栏高 34、5 钮 26×26 r6（调色板/锁/字号−/＋/关）；拖动 `startDragging`（锁定禁用）；位置持久化经 `state-mutate{key:'window'}`；`custom_plugin_window_ready` 上报。
- 主窗口页：自绘最小化/最大化/关闭（`plugin:window|*` shim），顶栏空白 `data-tauri-drag-region`。

- [ ] **Step 1: 写失败测试（lyrics-pure.test.ts）** — `nextColorIdx(4)===0`、`(2)===3`；`clampFontScale(0.5)===0.6`、`(3.5)===3`、`(1+0.15)===1.15`；hover 工具栏 5 按钮顺序断言（渲染测试）。
- [ ] **Step 1b: routes.tsx 启动装配含会话恢复** — `restoreSession===true` 且存在 resume → 定位上次曲目并暂停在记录位置（spec §6.2），不自动播放。
- [ ] **Step 2: 写失败测试（ownership.test.ts，内存 bus + stub engine）** — ① A 页 playTrack → 广播 takeover、B 页收到后 `engine.paused===true`（stub）；② B 页发 cmd seek → A stub 收到；③ A 发 owner-gone → B/歌词页停止镜像并清 owner；④ lyrics 页 setTrack 请求被拒绝（不 takeover）。
- [ ] **Step 3: Run `npm test`** Expected: FAIL。
- [ ] **Step 4: 实现三个窗口页 + ownership 接线**（主控页/引擎归属与 Task 3/7 对接；导入对话框路径：`pickAudioFiles` 前后包 `showPanelWindow()` —— Review Focus #5 的代码钉子）。
- [ ] **Step 5: Run `npm test`** Expected: PASS。
- [ ] **Step 6: Commit** `feat: 三窗口编排/桌面歌词悬浮窗/引擎归属与命令路由`

---

### Task 16: 打包校验、部署与宿主冒烟

**Files:**
- Modify: `package.json`（`pack=node scripts/pack-plugin.mjs && node scripts/verify-plugin.mjs`）、`.github/workflows/release-plugin.yml`（模板已拷，确认 tag 规则）
- Create: `docs/smoke-checklist.md`

**Interfaces:**
- Consumes: 全部前置任务；模板脚本 pack/verify/deploy。

- [ ] **Step 1: 构建并打包** — Run: `npm run build && npm run pack`
  Expected: `dist-pack/otools-yoyomusic-0.1.0.oplg` 生成，verify 输出全绿（无 devUrl/quickDev、含 logo.svg、HTML 含 otools）。
- [ ] **Step 2: 部署到宿主** — Run: `pwsh -File scripts/deploy-to-otools.ps1 -OtoolsRoot D:\Repos\xyito\otools\otools`
  Expected: `otools\otools\plugins\otools-yoyomusic\{plugin.json,logo.svg,dist}` 就位。
- [ ] **Step 3: 宿主冒烟（docs/smoke-checklist.md 逐项勾选）** — ① panel 打开、1100×720 生效（宿主钳制允许缩小）；② 导入音乐/文件夹 → 曲库行即时出现、元数据后台补齐；③ 播放/暂停/上下首/seek/音量/EQ 出声；④ 9 种可视化各切一遍 + 随机轮换开关；⑤ 皮肤 4 套切换全局变色；⑥ .lrc 歌词面板逐行高亮；⑦ 桌面歌词开窗：置顶悬浮、5 色循环、字号 ±、锁定禁拖、关闭；⑧ 主窗口开窗：失焦不消失、顶栏拖动、min/max/close；⑨ 双窗口同时改歌单无丢失（主控页协议生效）；⑩ 重启宿主后会话恢复（位置/音量/皮肤/歌单）；⑪ 大 FLAC（>30MB）换曲有加载态且 ≤3s。任何一项失败 → 修复后重跑该项。
- [ ] **Step 4: Commit** `chore: 打包校验通过 + 宿主冒烟清单全绿`（附 checklist 完成态）
- [ ] **Step 5:（可选，需用户确认）远程发布** — GitHub 建仓 `ootools/otools-yoyomusic`、push、超级工程 `git submodule add ... otools/otools-yoyomusic`（`branch = main`）、提交 `chore(submodule): 挂载 otools-yoyomusic（悠悠乐听音乐播放器插件）为子模块`、打 tag `v0.1.0` 触发 Release。
