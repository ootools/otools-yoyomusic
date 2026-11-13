# 实施记录 — otools-yoyomusic

计划：`docs/superpowers/plans/2026-11-12-otools-yoyomusic.md`
设计：`docs/superpowers/specs/2026-11-12-otools-yoyomusic-design.md`

## 已完成（不重复实施）

- Task 1–9：脚手架、宿主桥、跨窗口总线、曲库/歌单状态、元数据解析器、Blob 传输与爬虫、播放引擎、信号分析、9 种可视化；已有提交截至 `ed5c4b6`。
- Task 10：4皮肤与双语文案已完成，342条测试与严格类型检查曾全绿。
- Task 11–14：完整Go三层布局、左栏曲库五页签、歌单管理/右键队列/搜索、底部播放条、EQ/歌词/外观/关于面板、LRC解析、Portal菜单/删除确认、自绘提示与idle保护已实施，真实DOM回归通过。
- Task 15：panel/main/歌词入口与协调层已实施；独立审查确认的5项多窗口竞态均由专门子代理观察RED→GREEN修复：handover等待旧owner暂停ack、shutdown排空在途/排队/配额重试写、无锁main不竞写、持锁重读最新数据、已销毁页面不应用迟到load。全套复验399测试+typecheck+build+pack通过。
- 最后界面审查5项Important已修复：歌词move事件最终位置保存、菜单onClose ref防抢focus、长菜单滚动+子菜单独立Portal、input/contenteditable焦点防idle折叠、删除确认focus trap/Esc/背景Space保护；各项观察RED→GREEN，最终父代理全套29文件/411测试、13打包/发布测试、typecheck/build/pack全部通过，源码包119文件、无缓存/环境文件/用户音乐。
- Task 16：生产构建及`.oplg`包曾校验通过（含许可证与source对应源码）；发布策略12测试、实际打包执行1测试通过。修复稳态后须再次全套/typecheck/build/pack。
- 独立GUI验收：自绘多选两个WAV/两曲显示/实际播放响应/均衡器面板确认；后续皮肤/钢琴/歌词被工具超时阻断。证据与未验项见`docs/smoke-checklist.md`。


## 当前裁决

- Ruling: 用户要求音乐文件和文件夹选择改为宿主自绘选择器；替代此前 `dialog.open` 的系统原生路径。使用宿主 SDK 的 `host-file-tree.ts` 模式（原生 DOM、宿主目录数据），在插件适配层补多选和异步导航保护；不修改宿主。`window.otools.browseHostDir` / `tools_webview_browse_dialog` 返回真实宿主路径。宿主内不退回原生 dialog；无宿主才走 File input。
- Ruling: 自绘选择器停留在插件页面，不会因原生文件对话框而触发 panel 失焦；删除“每次选文件强制 show_panel_window”的必要性，避免从独立主窗意外弹出 panel。
- Ruling: 当前 `Agent` 执行服务连续返回 token-rate-limit，重启旧代理和新代理均失败；已告知用户，当前会话暂时代执行并保留测试门槛，服务恢复后补独立审查。不得把失败代理记为验收通过。
- Ruling: 开发完成前不自动提交或上架；随后用户明确授权GitHub推送、xyito子模块及六包市场发布，已完成v0.1.2。详情见 `docs/release-v0.1.2-result.md`。
- Ruling: 布局数字以 Go `view.go` 为准，暗色皮肤与 tauri Canvas 动效不改；桌面歌词用真实宿主自定义窗口，不能以网页内浮层充当。

## 待集成注意点

1. 主控页持久化需串行、跨窗变更发 action 而非全库陈旧快照；歌词页不参与引擎或主控选举。
2. 隐藏 panel 的定时器可能节流，需稳定单写者（Web Locks 优先，能力缺失时明确降级），避免心跳误接管。
3. 连点下一首：异步 resolve 完成后核对请求版本和 trackId，释放迟到 URL。
4. 播放、暂停、自然结束与 previous 到首的语义由 `playing` 位显式区分；状态不能先行假定 `audio.play()` 成功。
5. 会话恢复暂停定位；位置由实际媒体时钟保存。浏览器 blob 文件刷新后需重新选择，明确提示。
6. LRC 同名 sidecar 优先、内嵌标签回退；加载后逐行高亮并同步桌面窗口。
7. 页面关闭释放音频图、Blob URL、监听器、BroadcastChannel 与扫描任务。
8. 原始源码许可证和 SDK MIT 版权随移植保留；不发布用户文件。

## 验证记录

后续每个任务写入真实 RED/GREEN、类型检查与构建结果。宿主 native 桌面窗的验证若当前环境无法执行，明确记“未验证”，不勾选冒烟清单。
