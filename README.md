# 悠悠乐听 · OTools 独立插件

本地音乐播放器，默认以 **panel** 面板打开，可另开常驻主窗口。桌面歌词通过 OTools 的 **自定义窗口** 实现（透明、无边框、置顶、隐藏任务栏）。

- 布局参考 YoYoMusic 最新 Go 版：52px 顶栏、92px 播放条、268px 曲库浮层、300px 功能浮层。
- 动效移植自 Tauri 分支：8 种 Canvas 可视化 + Go 版 3D 钢琴，共9种。
- 曲库文件/目录导入、多个歌单、队列顺序、喜欢、历史、专辑/歌手浏览、搜索。
- 10段均衡器、7预设、4套皮肤、中文/英文、LRC/内嵌歌词、会话恢复。
- 文件选择使用 **宿主数据的自绘选择树**（多选、盘符/目录导航、路径跳转）；不调用系统原生文件对话框。
- 使用宿主 `pageMode()` 判断实际容器：panel 隐藏顶栏logo及名称，tabs/独立窗口保留。启动调用 `setTempHostTheme('dark', { background: 皮肤.bg })` 临时使用暗色宿主外壳，TABS 顶栏 / Panel 头部底色随当前皮肤联动（旧宿主忽略未知参数安全降级），离页清除覆盖，不修改用户长期主题；旧宿主缺接口时兼容跳过。

## 本地开发

Node 22.22+，运行：

```bash
npm ci
npm test
npm run typecheck
npm run build
npm run pack
npm run dev
```

- 开发：`http://127.0.0.1:6482/`
- 生产预览：`npm run preview` → `http://127.0.0.1:6483/`
- 包：从 GitHub Release 选择本机系统/架构的 `.oplg`，通过 OTools 插件管理的本地安装入口安装。
- `plugin.json` 默认 `openMode: panel`；生产包自动移除 `devUrl`、`quickDev`。

宿主源码内联调（会覆盖指定宿主 `plugins/otools-yoyomusic`；使用前确认目标）：

```powershell
pwsh -File scripts/deploy-to-otools.ps1 -OtoolsRoot D:\Repos\xyito\otools\otools
```

完整播放器可以只用前端和宿主能力运行，不需要宿主补丁。六目标精确架构包另内置 Rust 原生lib，提供可选歌词解析、健康查询和关闭回执；音乐解码仍由 Web Audio 完成。

## 播放与多窗口

panel 和独立主窗共享曲库与设置。点曲目/播放的窗口先请求旧窗口暂停并确认，再接管音频；若未收到确认，会显示重试提示而不会冒险双播。持久化由同源独占协调页串行写入，优先使用 Web Locks，正常关闭会先排空写队列再释放锁，不依赖隐藏面板心跳超时抢占。

无 Web Locks 的旧运行环境只允许 panel 作为固定协调页，主窗/歌词窗只转发数据操作；需要保持 panel 页面存在，不支持主窗自行竞选写权。强制结束进程、系统崩溃或硬关窗口仍只能尽力保存，不保证未落盘改动耐久。

桌面歌词页只接收歌词/播放快照与发送设置，不参与播放或曲库写者选举。悬浮工具栏支持5色循环、字号增减（0.6–3倍）、位置锁定、关闭；锁定只禁止拖动，不开启鼠标穿透。

## 限制与验证状态

- OTools 宿主 ≥0.9.0，并需提供 `browseHostDir`/文件读取/自定义窗口接口。
- 音乐保留原路径，播放时整文件读取为 Blob；大 FLAC 初次读取延迟由文件大小与宿主IPC决定。下一首预读降低切换延迟，不保证每台机器均≤3秒。
- 浏览器原生音频解码依操作系统/Chromium编解码器支持；WAV/MP3/FLAC/OGG为主，AAC/M4A/Opus尽力支持。纯 AAC/Opus 的标签解析有限。
- 独立浏览器使用 File input；重载后本地 File 句柄失效，需要重选。浏览器弹窗不能替代跨应用置顶桌面歌词。
- 不导入 Go/Tauri 版已有数据；不上传音乐，不写标签，无托盘/全局快捷键/独立更新器。
- 最终本地验证结果见 `docs/smoke-checklist.md`。真实宿主的透明/置顶/拖动窗口和后台播放仍需实机验证；模拟宿主验收不能代替这部分。

## 源码与许可证

YoYoMusic 衍生移植，**AGPL-3.0-or-later**，见 `LICENSE`、`THIRD_PARTY_NOTICES.md`。对应源码随 `.oplg` 放在 `source/`，可取出后 `npm ci && npm run build` 重建。源包不包含用户音乐、node_modules、开发模拟宿主测试页。开发源码另有 `web/dev-check.html` 供模拟API验收，生产入口不会加载它。

## 六目标发布

`plugin-otools-yoyomusic-v<plugin.json.version>` 标签触发六目标 CI（兼容历史 `v*` 标签）：Windows/macOS/Linux × x64/arm64，各包包含对应架构的真实lib。Windows库使用静态CRT。`0.1.3` 发布正好六个包：

- Windows：`otools-yoyomusic-0.1.3-windows.oplg`（x64）、`-windows-arm.oplg`（ARM64）。
- macOS：`otools-yoyomusic-0.1.3-macos.oplg`（Apple Silicon）、`-macos-intel.oplg`（Intel）。
- Linux：`otools-yoyomusic-0.1.3-linux.oplg`（x64）、`-linux-arm.oplg`（ARM64）。

沿用最新市场的六架构URL字段和 `packageMode=1`，不引用不存在的通用包。各包启用匹配架构的可选native歌词库；完整音乐播放仍通过Web Audio和宿主接口。详情见 `docs/release-six-targets.md`。原生源码位于 `native/`：

```bash
cargo test --locked --manifest-path native/Cargo.toml
node scripts/build-native.mjs --target x86_64-pc-windows-msvc
node scripts/release-packages.mjs --libs lib --out dist-release
```

最后一条要求六目标真实库齐备，不生成缺lib的伪平台包。市场发布使用本次授权的外部PAT，默认不将PAT保存到仓库或GitHub Secrets。
