# otools-yoyomusic 设计文档（2026-11-12）

把桌面应用「悠悠乐听」（YoYoMusic，纯 Go 版 v0.2.8，源码 `D:\Repos\xyito\lingyun\YoYoMusic`）移植为 OTools 独立插件 **`otools-yoyomusic`**。

- **布局**照抄 Go 版最新布局（v0.2.8，`internal/ui/view.go`）。
- **动效/可视化**照抄 tauri 老分支（同仓库 `tauri` 分支，React+Canvas 实现），3D 钢琴为 Go 版独有、按 `internal/ui/viz.go` 用 Canvas 2D 重写。
- 生态现状：OTools 还没有音乐播放器插件，这是第一个。

> 本文档先落盘于本仓库（otools 超级工程），插件仓库 `ootools/otools-yoyomusic` 建立后随仓库迁移归档。

---

## 1. 意图与动机

悠悠乐听是一个本地音乐播放器（曲库扫描 / 多歌单 / 队列管理 / 喜欢 / 历史 / 专辑歌手浏览 / LRC 歌词 / 桌面歌词 / 9 种音频可视化 / 10 段 EQ / 4 套玻璃拟态皮肤）。把它带进 OTools 的价值：

- OTools 面板/独立窗口体系下随时唤起、后台播放；
- 桌面歌词成为插件生态首个"跨应用悬浮层"能力示范（复用宿主自定义窗口）；
- 播放器逻辑全前端化后，浏览器直开也能降级使用。

## 2. 目标 / 非目标 / 反目标

**目标（全功能）**

1. 布局 1:1 移植 Go 版（尺寸、间距、字号、交互均以 `view.go` 常量为准）。
2. 9 种可视化全部实现（tauri 8 种 + Go 版 3D 钢琴），随机轮换 5–20s。
3. 10 段 EQ（±12dB、7 预设）、4 套内置皮肤（色值照抄 Go `state.go:168-191`）。
4. 曲库导入（文件/文件夹）、多歌单管理、下一首播放/队尾/上移/下移、喜欢、历史（200 条上限）、专辑/歌手浏览、全局搜索。
5. LRC 歌词（同名 .lrc 优先，其次内嵌标签）、桌面歌词独立悬浮窗。
6. 会话恢复（记忆曲目位置）、音量/静音/播放模式（顺序/列表循环/单曲循环/随机）。
7. 宿主内一键运行（deploy 脚本 + `.oplg` 打包 + 市场发布管线）。
8. 浏览器直开可降级运行（无宿主时用 file input + localStorage + 合成信号可视化）。

**非目标**

- 系统托盘、全局快捷键、文件关联、自动更新（插件走市场发布体系；关于面板只展示版本/信息）。
- 标签写入（tag editing）、在线元数据 enrichment（Go 版有 HTTP enrichment，不移植）。
- Tauri 旧数据迁移与 **Go 版数据导入**（`%APPDATA%/YoYoMusic` 的 library.json/settings.json —— 用户拍板：不考虑导入，v1 手动重建曲库）。
- 修改 OTools 宿主（二期如需流式播放再提宿主命令，见 §4 方案 B）。

**反目标（做了就算失败）**

- 把用户音乐文件复制进插件目录或 `~/.otools`（只引用原路径）。
- 生产 `.oplg` 里残留 `devUrl`/`quickDev`（verify 脚本会拒绝）。
- UI 布局自由发挥、偏离 Go 版观感。

## 3. 约束

| 约束 | 内容 | 来源 |
|---|---|---|
| 纯前端插件 | template web 模式：`web/` 源码 → `dist/`，无 Rust shell、无 native dylib | 模板 README |
| asset 协议 scope 限制 | `convertFileSrc` 仅允许 `~/.otools` 下目录；用户曲库路径会 403 | 宿主 `tauri.conf.json:35-49` |
| 任意路径读文件 | `tools_webview_read_file(path)` 整读返回 base64，无大小限制、无 scope 检查 | 宿主 `webview_fs/core.rs:425-447` |
| panel 失焦即隐藏 | panel 是常置顶悬浮窗，失焦 180ms 自动隐藏（`panel/core.rs`）；播放不被打断（webview 只是隐藏） | 宿主 |
| panel 尺寸钳制 | `panelWidth/panelHeight` 声明后按内容尺寸调整，上限 92% 屏宽 / 70% 屏高 | 宿主 `panel/core.rs:633-668` |
| 自定义窗口能力 | transparent / decorations:false / alwaysOnTop / skipTaskbar / 任意宽高 / 每次调用可覆写；URL 必须在插件根内；`ignoreCursorEvents` 只能运行时设置；`skipTaskbar` 只能创建时设置 | 宿主 `custom_window.rs`、`custom.rs` |
| openMode 前置条件 | 只有 `openMode:"panel"`（或 `"custom"`）的插件能开自定义窗口 | 宿主 `webview/custom.rs:336-340` |
| 自定义窗口页面来源 | 与主入口同一个 dist，靠查询参数区分页面（daymark 先例 `index.html?float=1`） | 宿主 `custom_url.rs` |
| 解码能力 | WebView2(Chromium) 原生解码 mp3/wav/flac/ogg/aac/m4a/opus → **比 Go 版多支持 AAC/M4A/Opus**（Go 版明确不支持，UI 标"暂不支持"） | 浏览器 |
| 中文优先 | 界面文案以 Go 版中文文案为准，i18n 仅 zh-CN + en-US | 产品定位 |

## 4. 方案对比与选择

**窗口架构**

- A. 纯 panel：全部 UI 在 panel，失焦自动收起。—— 简单，但浏览曲库/管理歌单被"点一下就收起"打断。
- **B. panel + 独立主窗口（选定）**：panel 默认全功能 UI；提供"独立窗口打开"按钮，用自定义窗口开 1100×720 常驻主窗（同一份 UI，`?main=1` 区分）。成本极低（UI 是同一份），daymark 同款模式。桌面歌词是第二个自定义窗口。

**音频管线**

- **A. 纯插件、零宿主改动（选定）**：播放 = `tools_webview_read_file` 整读 → 内存 Blob URL → `<audio>`；扫描 = `listHostDir` 先出列表，元数据/时长/封面后台逐个解析（整读后即弃）。现在就能跑，插件真正独立。传输层做成抽象接口，二期可无缝切 B。
- B. 宿主小补丁（二期）：宿主加"允许 asset 协议读该文件"命令（宿主 `recording/mod.rs:95-96` 有 `allow_file` 先例），实现真流式播放 + 秒级扫描 + Range 读。需要动宿主 Rust 且声明 `minOtoolsVersion`。

**技术栈**

- **Vite + TypeScript + React 19（选定）**：状态复杂度（曲库/歌单/队列/面板/可视化）值得组件化；otools-aigv 先例。构建脚本把模板 `build-web.mjs` 的"拷贝 web/ → dist/"换成 `vite build`；pack/verify/publish 脚本原样沿用（只认 dist/）。
- 落选：无打包单文件（规模不允许）；Rust+WASM shell 模式（用于移植 egui 软件，不适用）；Go→WASM（mygo 是桌面绘制 UI，无意义）。

**落选的其他路**：依赖宿主音频插件（otools-audio 是编辑器不是播放器）；复用宿主录制 API（不相关）。

## 5. 总体架构

### 5.1 仓库结构（源自 otools-plugin-template）

```
otools-yoyomusic/
├── plugin.json            # openMode:"panel"，panelWidth:1100，panelHeight:720，customWindow 模板
├── logo.svg               # 用 YoYoMusic logo/图标重绘
├── web/                   # Vite + React + TS 源码
│   ├── index.html         # 宿主桥 + 页面路由（?main=1 / ?lyrics=1 / 默认 panel 页）
│   └── src/
│       ├── audio/         # 引擎、传输抽象、EQ、元数据解析、歌词解析
│       ├── signal/        # 频谱带折叠、节拍/响度、合成信号引擎（移植）
│       ├── viz/           # 8 种移植模式 + piano 重写 + Canvas 组件
│       ├── state/         # 全局 store、持久化适配器
│       ├── i18n/          # zh-CN / en-US
│       └── ui/            # TopBar / Transport / LeftRail / RightRail / 通用件
├── scripts/               # 模板脚本（build-web.mjs 改为 vite 构建入口）
├── dist/                  # 构建产物（gitignore）
└── .github/workflows/release-plugin.yml   # tag v* → Release（+可选市场发布）
```

### 5.2 plugin.json 要点

```jsonc
{
  "uuid": "otools-yoyomusic", "packid": "otools-yoyomusic",
  "displayName": "YoYoMusic", "displayNameCN": "悠悠乐听",
  "openMode": "panel",
  "panelWidth": 1100, "panelHeight": 720,
  "customWindow": {          // 自定义窗口默认模板（按桌面歌词需求设默认，主窗口每次调用覆写尺寸）
    "width": 880, "height": 110, "transparent": true, "decorations": false,
    "shadow": false, "resizable": false, "skipTaskbar": true, "alwaysOnTop": true
  },
  "entry": "dist/index.html",
  "key": ["yoyomusic","悠悠乐听","音乐","播放器","music","player","mp3","flac","歌词","桌面歌词"],
  "summary": "本地音乐播放器：曲库/歌单/歌词/桌面歌词/9 种音频可视化/均衡器",
  "version": "0.1.0", "minOtoolsVersion": "0.9.0", "permissions": []
}
```

`minOtoolsVersion` 取写作时的宿主版本 0.9.0（本次拍板）；同时所有宿主能力（自定义窗口 / `show_panel_window` / 状态 API / `listHostDir`）一律运行时探测，缺失时隐藏对应入口并提示升级，核心播放/导入不受影响。

### 5.3 三窗口拓扑与播放归属协议

| 窗口 | 打开方式 | 尺寸/特性 | 角色 |
|---|---|---|---|
| Panel（默认） | 宿主 panel（`openMode:"panel"`） | 1100×720（宿主钳制），常置顶、失焦自动隐藏 | 全功能 UI，快速唤起 |
| 主窗口（可选） | `open_custom_plugin_window`，`url:"index.html?main=1"`，`windowId:"yoyomusic-main"` | 1100×720，decorations:false（顶栏拖动区），resizable:true，skipTaskbar:false，alwaysOnTop:false | 常驻全功能 UI，不被失焦打断 |
| 桌面歌词 | `open_custom_plugin_window`，`url:"index.html?lyrics=1"`，`windowId:"yoyomusic-lyrics"` | 880×110，transparent:true，alwaysOnTop:true，skipTaskbar:true，resizable:false | 全屏悬浮歌词，见 §9 |

- 每个页面共享同一 dist、同一 origin（`otools-plugin://localhost/<uuid>/`），跨窗口通信用 **BroadcastChannel**（`yoyomusic` 频道；浏览器降级 localStorage `storage` 事件）。
- **播放归属协议**：任何页面都可以成为"引擎持有者"。规则：
  1. 页面内播放操作（点歌、播放按钮）→ 本页引擎接管：广播 `{type:"takeover", epoch}`，其他页静音挂起自己的 `<audio>` 并转为"控制端"（只发命令、镜像状态）。
  2. 控制端的播放类命令（play/pause/next/seek/volume）广播给当前持有者执行。
  3. 持有者关闭/卸载 → 播放停止（与 Go 版关窗即退出行为一致），广播 `{type:"owner-gone"}`。
  4. 桌面歌词页永远不持有引擎，只发命令 + 接收状态。
  5. `epoch` 单调递增防竞争；两端同 epoch 时以时间戳新者接管。
  6. **持久化单写者（主控页，本次拍板）**：全应用只有一个页面（"主控页"）允许调用宿主持久化 API。启动时各页广播 claim（epoch 单调递增、首次者胜、2s 心跳、卸载广播重选）；引擎持有者的播放快照、其他页面的曲库/设置变更统一经 BroadcastChannel 汇入主控页内存 store，由它落盘。原因：宿主 `patchPluginLocalState` 是整 JSON 读-改-写 + 顶层键浅合并（`ot-plugin-state/src/lib.rs:361-372`），同键并发写丢更新。浏览器直开时本页即主控页。
- 面板失焦隐藏不影响播放：隐藏 ≠ 销毁，`<audio>` 与 AudioContext 照常运行；可视化 rAF 在隐藏页被节流属预期（反正不可见）。
- 与宿主文件对话框的配合：宿主 dialog 弹出会导致 panel 失焦隐藏，dialog 返回后调用 `invoke('show_panel_window')` 恢复。

## 6. 音频管线

### 6.1 传输抽象（为二期流式预留）

```ts
interface AudioTransport {
  // 返回可直接给 <audio src> / fetch 的 URL
  resolve(path: string): Promise<string>
  // 读取文件字节（元数据解析用）；streaming 实现可用 Range/提前 cancel
  readBytes(path: string, opts?: { maxBytes?: number }): Promise<Uint8Array>
}
```

- **BlobTransport（v1 唯一实现）**：`resolve` = `tools_webview_read_file(path)` → base64 解码 → `Blob` → `URL.createObjectURL`；持有者切换曲目时 revoke 旧 URL。同时只持有当前一首。
- **AssetTransport（二期）**：宿主加 allow 命令后 `resolve` = `convertFileSrc(path)`，读头用 `fetch + 提前 cancel`。store 按 `__TAURI_INTERNALS__` 探测可用性自动选择。

### 6.2 播放引擎（持有者页内）

- `<audio>` 元素 + `MediaElementAudioSourceNode` → `GainNode`(音量/静音) → 10×`BiquadFilterNode`(peaking, 31/62/125/250/500/1k/2k/4k/8k/16k, Q=1.414, ±12dB) → `AnalyserNode` → destination。
- EQ 与 Go 版 `audio/eq.go` 完全对应；EQ 关闭时把各频段 gain 置 0（保持链路，避免重建）。
- 事件驱动：`timeupdate`（500ms 粒度刷新状态）、`ended` → 按 playMode 自动切曲（sequence/repeat_all/repeat_one/shuffle，逻辑照抄 Go `state.go:856-876`）、`error` → 标记 `TrackBad` 并提示。
- seek：直接设 `audio.currentTime`；scrub 期间 250ms 内不从时钟回填（对应 Go `scrubHold`）。
- 音量 0..1；静音取消时若 volume 为 0 则恢复 0.5（对应 Go `app.go:495-505`）。
- 会话恢复：暂停时记录 position（≤5s 或距结尾 2s 内不记），恢复时定位但不自动播放（`RestoreSession`）。

### 6.3 频谱信号（喂给可视化）

- `AnalyserNode`（fftSize 4096）：`getByteFrequencyData` → 按**频率**折 56 个对数带（40Hz–16kHz，边缘计算逻辑移植自 tauri `spectrum.ts`/`fft.ts`）→ 归一化（运行峰值衰减 ×0.94 + `log1p(r*9)/log10` 压缩）→ level = RMS×3.2、beat = 低频(<150Hz)能量 > 滚动均值×1.35 的 onset（EMA 0.92/0.08）。
- wave：`getByteTimeDomainData` 降采样 256 点。
- 包络平滑沿用 tauri `signal.ts` 的 SignalEngine（attack 22–26/s，release 6.5–7/s），并完整保留其**合成信号**分支（按曲目 id 种子生成带 BPM/粉噪倾斜的伪音乐信号）——用于浏览器直开、无实时频谱（如宿主 audio 会话被节流）与暂停时的 idle 呼吸。

### 6.4 元数据 / 封面 / 时长（纯 JS 解析器，`audio/metadata.ts`）

后台逐个整读文件字节（读完即弃），解析：

| 格式 | 标签 | 封面 | 内嵌歌词 | 时长 |
|---|---|---|---|---|
| mp3 | ID3v2.3/2.4（TIT2/TPE1/TALB/USLT） | APIC | USLT(SYLT 忽略) | Xing/VBRI 或 CBR 估算（文件大小/比特率） |
| flac | VORBIS_COMMENT | PICTURE block | `LYRICS`/`UNSYNCEDLYRICS` comment | STREAMINFO totalSamples |
| ogg | vorbis comment | METADATA_BLOCK_PICTURE | comment | 最后一页 granule |
| wav | LIST/INFO（尽力） | 无 | 无 | data 块大小 |
| m4a/aac（超越 Go 版） | MP4 ilst（©nam/©ART/©alb/©lyr） | covr | ©lyr | moov/mvhd |

- 空值回退：未知艺术家 / 未知专辑（对应 Go `state.go:609-625`）；标题缺省用文件名。
- 解码失败的扩展名标 `TrackBad`（"· 格式不支持"），文件不存在标 `TrackMissing`（"· 文件缺失"）——恢复/扫描时用 `readHostFile` 失败或 `listHostDir` 对账判断。
- **封面持久化为 96px JPEG 缩略图 data URL**（quality 0.75，约 2–4KB/首）——UI 只在 48×48 封面位使用，曲库状态 JSON 体积可控；浏览器降级模式超过 localStorage 配额则丢弃缩略图。

### 6.5 歌词

- 解析器照抄 Go `lyrics.go` 语义：多时间戳行、metadata 标签跳过、无时间戳行归 t=0、offset 支持。
- 来源顺序：同名 `.lrc`（`path` 去扩展名 + `.lrc`，`tools_webview_read_file` 读取）→ 内嵌标签。
- 面板歌词：当前行高亮（15px Bold vs 13px muted）、支持桌面歌词开关按钮。
- 桌面歌词查找：与 Go 相同的 karaoke current+next 逻辑（playhead 定位）。

## 7. 可视化移植

- **直接移植**（tauri 分支，框架无关 TS，几乎原样可用）：`drawModes.ts`（spectrum/waveform/radial/aurora/particles/waterfall/kaleidoscope 7 种）、`generative.ts`（constellation/ribbons/lattice/orbits/flowfield 5 场景，16–27s 轮换 + 1.4s smoothstep 交叉淡化）、`signal.ts`（合成信号 + 平滑）、`modes.ts`（模式目录）。菜单上 generative 是**单个**模式项（5 场景内部自转）；顶栏"随机切换"的 5–20s 只轮换 9 个模式项，与 generative 内部场景轮换互不干扰（Go `app.go:139-142` 即如此）。
- 适配点：调色板从 CSS 变量改为 skin 对象直读（`{a,b,ink}`，对应 Go 皮肤 VizA/VizB/VizInk）；Canvas 组件保留 DPR≤2、ResizeObserver、`dt` 钳制 0–0.05、`prefers-reduced-motion` 静帧。
- **piano.ts（新写）**：按 Go `viz.go:652-1033` 算法 Canvas 2D 重写——14 白键 + 10 黑键、透视投影（`kbPersp 0.16`、后沿 `kbBackV 0.17`、黑键止于 0.76、白键远端收窄 18%、黑键宽 0.52、lift 0.125）、键盘高 `min(0.30H,168)`、前沿/键降/键槽 clamp 公式、固定乐器配色（白键 RGB(112,118,142)→RGB(241,244,250)，黑键 RGB(13,14,20)→RGB(58,61,74)，琴体 RGB(26,27,36)）、频段→琴键映射（低频在左）、按下快攻(0.5 lerp)/慢放(0.6/s)、beat 全键微沉(0.10/0.08)、击键光束、阴影、上下表面 5–20 切片。
- 顶部中央模式选择：28×28 图标按钮 → 自定义弹出菜单（9 模式 + 选中态 + 分隔线 + "随机切换可视化：开/关"）；随机轮换 5–20s（Go `app.go:139-142`）。

## 8. UI 布局移植（全部常量出自 Go `view.go`）

### 8.1 三层结构与常量

| 项 | 值 |
|---|---|
| 主窗口/面板 | 1100×720，min 820×560 |
| 顶栏 | 高 52，`Padding(12,14) Gap 10`，Surface@0.82 玻璃，整条可拖动窗口 |
| 播放条 | 高 92（seek 条 24 含 `Padding(4,16)` + deck 行 `Padding(10,16) Gap 14`） |
| 可视化背景 | `Top:52, Bottom:75`（transport 上沿留 17px 呼吸位 `vizDeckInset`），全屏铺底 |
| 左栏（曲库/歌单） | 宽 268，`Left(12) Top(60) Bottom(100)`，Surface@0.82，`Radius(0,14,14,0)` |
| 右栏（功能面板） | 宽 300，`Right(12) Top(60) Bottom(100)`，Surface@0.82 |
| 自动收起 | 右栏指针静止 10s 收起（歌词面板常驻 sticky）；左栏指针离开 3s 收起；pin 固定；收起态不画任何内容 |
| 高亮态 | 按钮 Accent@0.22、选中行 Accent@0.16 |

### 8.2 顶栏

- 左：logo 22×22 + "悠悠乐听" 16px Bold；曲库开关 32×32 r8（开/钉住时 Accent@0.22）。
- 中：可视化模式按钮（28×28 槽位，r7，Accent@0.22）。
- 右：4 个功能按钮 32×32 r8 —— 均衡器 / 歌词 / 最近播放 / 外观 / 关于（`SidePanels=["eq","lyrics","skins","about"]`；Go 版顶栏第 3 颗是历史入口图标）。**主窗口（frameless）需在右端留出最小化/关闭自绘按钮**；panel 页不需要（宿主管）。

### 8.3 左栏（曲库/歌单）

1. 歌单选择行：全宽下拉按钮（h30 r7，13px + 16×16 chevron）→ 自定义菜单：歌单列表（选中态）/ 新建歌单 / 重命名歌单 / 删除歌单（`default` 禁用）。内联重命名 = TextInput(h30 r7) + ✓/✕ 28×28 r7（Enter 提交 Esc 取消）。
2. 分段器：自绘 5 段「列表 / 专辑 / 歌手 / 历史 / 喜欢」，高 28、track Surface@0.9 + 1px 边 + r8 + padding 2，滑动药丸 r6 Accent 填充，字 11px 选中 AccentText；右侧 "+" 28×28 r7（菜单：导入音乐…/打开文件夹…）与图钉 28×28 r7。
3. 搜索框：过滤当前 tab（标题/艺术家/专辑，大小写不敏感）。
4. 内容区：
   - **列表**：行 `Padding(7,8) Gap 10 r8`，播放中 Accent@0.16；序号 chip 30×30 r8 + 标题 13px/歌手 11px + 状态后缀 + ♥ 24×24 r6 + 时长 11px。左键播放；**右键上下文菜单**：下一首播放 / 添加到歌单 ▸（子菜单）/ 加到队列末尾 / 上移 / 下移 / 从当前歌单移除（`default` 视图隐藏移除）。
   - **专辑/歌手**：分组行 `Padding(8,10) Gap 10 r8` 斑马纹（偶数行 Background@0.35），图标盒 36×36 r8 + 名称 13px Bold + 计数 11px；下钻页有返回按钮 56×28 r7。
   - **历史**：行 `Padding(8,9)`，右侧相对时间 11px（刚刚/N分钟前/N小时前/N天前/MM-DD）。
   - **喜欢**：trackRow 复用，取消喜欢即移除。
   - 空态文案照抄 Go（"还没有音乐。点右上角的 + 导入音乐或文件夹。"等）。

### 8.4 播放条

- 左：封面 48×48 r10（无封面时 135° Primary→Accent 渐变 + 音乐图标）、标题 14px Bold / 艺术家·专辑 11px muted；未播放："尚未播放 / 从左侧播放列表选择音乐"。
- 中：播放模式 34×34 r9（顺序→列表循环→单曲循环→随机循环切换）、上一首 38×38 r19、播放/暂停 46×46 r23（Primary 渐变按钮）、下一首 38×38 r19。
- 右：时间 12px muted、静音 32×32 r8（图标按 0.34/0.67 阈值切换）、音量滑条宽 110。
- 无曲目时 seek 条为惰性 6px 高轨道（Border@0.4）。

### 8.5 右栏（功能面板）

- 头部：标题 14px Bold + 关闭 26×26 r6。
- **均衡器**：启用开关 + 7 预设（平直/摇滚/流行/古典/重低音/人声/高音）+ 10 行（频率标签 11px 宽 34 + 滑条 ±12 + 值 11px 宽 42）。
- **歌词**：桌面歌词开关 28×28 r7、说明文案 12px、逐行列表（当前行 15px Bold 高亮）。
- **外观**：皮肤卡片 `Padding(9,9) Gap 10 r10`，三色 swatch 16×16 r5 + 名称 13px + 作者 11px + 选中 ✓。
- **关于**：应用名 18px Bold、简介与特性列表、Divider、版本信息（不含更新器——插件由市场分发）。

### 8.6 通用件与交互

- 图标：照抄 Go `icons.go` 的 24×24 单色手绘 SVG 线性图标集（不引图标库），18×18 居中于按钮。
- Tooltip：自定义跟随组件（Go `icons.go:155-175` 样式）。
- 右键菜单 / 弹出菜单：自定义 portal 组件替代 Go 的原生菜单（点击外部/Esc 关闭；"添加到歌单"带子菜单展开）。
- 空格键切换播放；主窗口顶栏空白处拖动窗口（`data-tauri-drag-region` 或 `startDragging`）。
- 皮肤：4 套色值精确照抄 Go `state.go:168-191`（aurora #8b5cf6/#22d3ee/#0e0b1a/#171327/#f4f1ff；midnight #d946ef/#6366f1/…；sunset #f97316/#facc15/…；mint #34d399/#38bdf8/…，完整表见源码）。全应用恒为暗色玻璃拟态（不跟随宿主亮暗主题，与 Go 版一致）。
- i18n：文案集中管理（zh-CN 为源），en-US 翻译表；读取 `__OTOOLS_LOCALE__` 并监听 `otools-locale-changed`。
- 动效（CSS，移植 tauri `app.css` 关键帧）：播放中旋转唱片/封面光泽、播放中行 3 条 eq-bounce 跳动条、行 hover 160ms 过渡、按钮 160–180ms 过渡、live 徽章 dot-pulse、全局 `prefers-reduced-motion` 关停。aurora 背景光斑（3 个 blur 80px 色斑 22/26/30s 漂移）作为 panel 之外的主窗口背景氛围（可视化背景之上、面板之下）。

## 9. 桌面歌词窗口

- 打开：右栏歌词面板的开关按钮 → `open_custom_plugin_window { windowId:"yoyomusic-lyrics", url:"index.html?lyrics=1", options:{ width:880, height:110, transparent:true, decorations:false, shadow:false, resizable:false, skipTaskbar:true, alwaysOnTop:true } }`；重复调用不重复开（先 `list_custom_plugin_windows` 查询）。
- 页面：`?lyrics=1` 或 `__OTOOLS_CUSTOM_WINDOW__` 识别自身；`custom_plugin_window_ready` 上报就绪；只读状态 + 发送控制命令（如点击切歌：上一首/下一首可选）。
- 视觉（照抄 Go `lyrics_desktop.go`）：歌词药丸 `Padding(12,26) Gap 8, Surface@0.42, r18`；当前行 34×scale Bold、下一行 20×scale @0.55；"暂无歌词"占位。
- 悬浮工具栏（hover 显隐）：高 34，5 按钮 26×26 r6 —— 调色板（循环 白/金 RGB(255,214,102)/青 RGB(120,230,255)/粉 RGB(255,160,200)/绿 RGB(160,255,170)）、锁定/解锁、字号 −/＋（步进 0.15，clamp 0.6..3）、关闭（`close_custom_plugin_windows`）。
- 锁定 = 禁用拖动 + 隐藏工具栏（可选 bonus：运行时 `setIgnoreCursorEvents` 点击穿透，默认不做）。
- 位置记忆：拖动结束读 `outerPosition()` 存入状态，下次打开 `setPosition` 恢复。
- 播放状态/歌词实时同步走 BroadcastChannel（见 §5.3）。

## 10. 状态与持久化

### 10.1 Store 结构（React store，zustand 或自制微 store，实现者定）

```
library: { tracks: Map<path, Track>, playlists: Map<id, {id,name,trackIds,currentIndex,playMode}>,
           currentPlaylist, queueCursor, history[≤200], }
playback: { trackId, positionMs, durationMs, volume, muted, playMode, eqEnabled, eqBands[10] }
settings: { skin, vizMode, vizRandom, restoreSession, desktopLyrics:{color,fontScale,locked,position},
            mainWindowBounds, language }
ui: { libraryOpen/Pinned/Tab/Query/Browse, sidePanel, panelsPinned, renamingPlaylistId, ... }
runtime: { transport, engineOwner, remoteState, crawlQueue }
```

- Track: `{ id(=绝对路径), filePath, title, artist, album, durationMs, status(ok/bad/missing), liked, coverThumb? , hasLyrics }`。

### 10.2 持久化

- **宿主模式**：`getPluginLocalState()/patchPluginLocalState()` 单 JSON（结构对应 Go `library.json` + `settings.json` 合一）；写节流：settings 400ms、library 1500ms；播放位置每 5s 冲刷。
- **单写者规则（本次拍板）**：宿主 patch 语义为整 JSON 读-改-写、顶层键浅合并（`ot-plugin-state/src/lib.rs:361-372`）——同键并发写丢更新，故只有主控页（§5.3 协议 6）调用持久化 API，各页变更经 BroadcastChannel 汇入。
- **规模预算（本次拍板）**：曲库 2,000 首体验流畅、10,000 首可用性不崩。扫描即时出列表（文件名先行），元数据后台爬虫补齐（限并发 2、可取消、可见行优先）；1,000 首 FLAC 库爬完约 3–8 分钟属预期。二期流式传输（§4 方案 B）落地后爬虫改 Range 头读，彻底解决。
- **浏览器降级**：localStorage 同一 JSON（配额不足时按 缩略图 → 历史 → resume 顺序裁剪）。
- 恢复对账：按 id 合并，文件缺失的条目从歌单剔除并标 `TrackMissing`（对应 Go `state.go:995-1057`）。
- 曲库扫描：`dialog.open({multiple:true, filters:[{name:'Audio', extensions:['mp3','wav','flac','ogg','aac','m4a','opus']}]})` 与 `listHostDir` 递归文件夹；先建行（文件名做标题、时长 "—"），后台爬虫队列逐个整读解析元数据（可取消、虚拟列表可见行优先）。

## 11. 构建 / 打包 / 发布

- `scripts/build-web.mjs`：改为执行 `vite build`（root=web，outDir=../dist，空 base 相对路径），产物自检 `dist/index.html` 存在且包含宿主桥标记（verify 要求 HTML 匹配 `/otools/i`）。
- pack/verify/publish/release-policy 脚本与 `release-plugin.yml` 原样沿用：tag `v<version>` → `.oplg`（ZIP 内平铺 plugin.json/logo.svg/dist）→ GitHub Release（+`OTOOLS_PUBLISH_MARKET=true` 时推市场 API）。
- 本地联调：`devUrl:http://127.0.0.1:6482` + `quickDev:true`（vite dev 端口对齐），`node scripts/deploy-to-otools.ps1`（-OtoolsRoot `D:\Repos\xyito\otools\otools`）部署到宿主 `plugins/otools-yoyomusic` 后重载宿主验证。dev 模式下子页面可直接调试：quickDev 的自定义窗口 URL 重写**保留**请求查询参数（宿主 `custom_url.rs` 测试 `custom_quick_dev_instance_retains_host_plugin_routing` 已验证），`?main=1`/`?lyrics=1` 无需绕路。
- 仓库挂载：GitHub 建 `ootools/otools-yoyomusic`，超级工程 `git submodule add` 到 `otools/otools-yoyomusic` + `branch = main`，提交 `chore(submodule): 挂载 otools-yoyomusic（悠悠乐听音乐播放器插件）为子模块`。
- `dist/`、`node_modules/` 不入库；提交信息中文、按功能分批。

## 12. 移植差异表

| Go 版 | 插件版 | 说明 |
|---|---|---|
| 原生窗口 1100×720 | panel 1100×720（宿主钳制）+ 可选自定义主窗口 | panel 失焦自收 |
| 原生菜单（右键/下拉） | 自定义 portal 菜单组件 | 视觉对齐 Go 风格 |
| 托盘 / 全局快捷键 / 文件关联 | 不移植 | 宿主职责域 |
| 自动更新（GitHub go-v） | 不移植；关于面板展示版本 | 市场分发 |
| WAV/MP3/FLAC/OGG | + AAC/M4A/Opus | 浏览器解码红利 |
| 整曲 PCM 内存解码 | Blob URL + `<audio>` 流式（整文件入内存但交给媒体元素） | seek 行为一致 |
| Go FFT 56 带 | AnalyserNode 折带（同 56 带/频率边缘/压缩公式） | 数值口径对齐 |
| 独立桌面歌词窗口（原生） | 自定义窗口 `?lyrics=1` | 全能力覆盖 |
| RBJ biquad EQ | BiquadFilterNode 链 | 参数一致 |
| mygo 主题 | React + CSS 变量 + 4 皮肤 | 恒暗色 |

## 13. 风险与对策

| 风险 | 对策 |
|---|---|
| 隐藏 panel 的 webview 被浏览器节流影响播放推进 | 引擎用媒体元素事件（timeupdate/ended）驱动而非定时器；状态消费方都是可见窗口 |
| FLAC 大文件（30–60MB）整读 base64 IPC 有 1–3s 换曲延迟 | 传输层抽象好换流式；v1 做队列预读下一首（后台 readBytes 预热 Blob）；UI 加载态 |
| 大曲库状态 JSON 膨胀 | 缩略图压到 96px/0.75；配额裁剪顺序固定；爬虫限并发 2 |
| BroadcastChannel 在 `otools-plugin://` 下的可用性未验证 | 实现双通道：BroadcastChannel + localStorage `storage` 事件兜底（daymark 先例） |
| 自定义窗口透明在 Windows 下的合成表现 | daymark 已在 Windows 使用 transparent:true，先例成立；仍列入冒烟测试 |
| 宿主 dialog 期间 panel 失焦隐藏 | dialog 返回后 `show_panel_window`；主窗口路径不受影响 |
| 三窗口状态漂移 | 主控页单写者协议（§5.3-6）+ 播放归属 epoch；UI 状态不跨窗口写库（只读快照） |
| 旧版宿主缺命令（自定义窗口/状态 API） | `minOtoolsVersion:"0.9.0"` 兜底 + 全能力运行时探测：缺失时隐藏入口并提示升级，核心播放/导入不受影响 |

## 14. 留给实现者

- store 选型（zustand vs 自制）、组件文件划分、CSS 组织（CSS 变量 + 模块化）。
- 单测范围建议：LRC 解析、56 带折叠/归一化、playMode 切曲逻辑、歌单增删/队列上移下移、持久化合并对账、元数据解析器（用固定字节样本）。
- 图标 SVG 从 Go `icons.go` 逐一转录的准确度自查。
- piano 视觉与 Go 版逐帧对照调参。

## 15. 参考文件索引

| 内容 | 位置 |
|---|---|
| 布局全部常量/交互 | `YoYoMusic/internal/ui/view.go`（477-489 常量、233-282 顶栏、548-676 播放条、493-528 左栏、533-544 右栏、691-740 分段器、917-1011 曲目行、1331-1516 右栏面板） |
| 图标/Tooltip | `YoYoMusic/internal/ui/icons.go` |
| 皮肤色值 | `YoYoMusic/internal/app/state.go:168-191` |
| 播放/队列/历史逻辑 | `YoYoMusic/internal/app/{app,state,persist,settings,library,lyrics}.go` |
| EQ/FFT 参数 | `YoYoMusic/internal/app/audio/{eq,fft}.go` |
| 桌面歌词 | `YoYoMusic/internal/ui/lyrics_desktop.go` |
| 可视化（tauri 8 种） | `YoYoMusic tauri 分支 src/features/visualization/{drawModes,generative,signal,spectrum,fft,modes}.ts` |
| CSS 动效关键帧 | `YoYoMusic tauri 分支 src/styles/app.css` |
| 自定义窗口先例 | `D:\Repos\xyito\otools\otools-daymark\{plugin.json, web/js/float.js}` |
| 宿主桥 API | `otools\otools\vendor\otools-plugin-sdk\src\`、`src\platform\webview\embedded-runtime.js` |
| 插件模板 | `D:\Repos\xyito\otools\otools-plugin-template\` |
