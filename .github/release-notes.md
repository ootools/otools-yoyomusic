# 悠悠乐听 · OTools 独立插件 v0.1.0

- 默认 panel 面板，另开独立主窗口；桌面歌词通过透明、置顶、无边框自定义窗口显示。
- 布局参考最新版 Go YoYoMusic，Canvas 动效移植自 Tauri 分支，含9种可视化和3D钢琴。
- 宿主自绘文件/目录选择器，多歌单、队列、喜欢、历史、搜索、专辑/歌手、LRC与内嵌歌词。
- 10段EQ、7预设、4套皮肤及中文/英文界面。
- 多窗口音频接管等待旧窗口暂停确认；正常关闭排空写队列，避免并发播放和陈旧状态覆盖。

## 下载与 lib

六个精确目标包：`windows-x64/windows-arm64/macos-x64/macos-arm64/linux-x64/linux-arm64`。各包包含对应架构的真实 `lib/Windows.dll`、`lib/macOS.dylib` 或 `lib/Linux.so`。

另提供三系统兼容包及通用包供当前市场客户端使用：兼容包携带双架构可选库，但不在未知CPU上自动加载native库，完整播放器继续用Web Audio和宿主文件/窗口接口。

原生lib提供健康查询、本地歌词解析和关闭回执，不上传音乐、不新建网络服务。

## 验证边界

本地前端411测试、TypeScript严格检查和包CRC/SHA256验证通过。六平台库经CI编译并校验文件头和导出。跨系统真实OTools透明置顶、拖动和后台播放仍须实机验证；CI构建并不等于这部分验收。

源码和许可证随 `.oplg` 的 `source/` 提供。AGPL-3.0-or-later；第三方通知见 `THIRD_PARTY_NOTICES.md`。
