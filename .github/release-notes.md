# 悠悠乐听 · OTools 独立插件 v0.1.1

- 默认 panel，另开独立主窗口；桌面歌词通过透明、置顶、无边框自定义窗口显示。
- 布局参考最新版 Go YoYoMusic，Canvas 动效移植自 Tauri 分支，含9种可视化和3D钢琴。
- 宿主自绘文件/目录选择器，多歌单、队列、喜欢、历史、搜索、专辑/歌手、LRC与内嵌歌词。
- 10段EQ、7预设、4套皮肤及中文/英文界面。
- 多窗口音频接管等待旧窗口暂停确认；正常关闭排空写队列，避免并发播放和陈旧状态覆盖。
- 修正旧macOS runner不可用，六平台使用标准suffix及六个市场URL分发字段。

## 下载

| 系统 | 架构 | .oplg后缀 | 包内库 |
|---|---|---|---|
| Windows | x64 | windows | lib/Windows.dll |
| Windows | ARM64 | windows-arm | lib/Windows.dll |
| macOS | Apple Silicon | macos | lib/macOS.dylib |
| macOS | Intel | macos-intel | lib/macOS.dylib |
| Linux | x64 | linux | lib/Linux.so |
| Linux | ARM64 | linux-arm | lib/Linux.so |

每个包均包含真实对应架构的lib。Windows静态CRT，macOS ad-hoc签名。原生lib提供健康查询、本地歌词解析和安全关闭回执；音频仍通过Web Audio播放，不上传音乐、不新建网络服务。

## 验证边界

本地前端413测试、21原生FFI/JSON测试、构建/发布脚本测试与TypeScript严格检查通过。六平台库经CI编译并校验OS/CPU文件头、ABI导出、CRC/SHA256。跨系统真实OTools透明置顶、拖动和后台播放仍须实机验证；CI构建不等于这部分验收。

源码和许可证随 `.oplg` 的 `source/` 提供，AGPL-3.0-or-later；第三方通知见 `THIRD_PARTY_NOTICES.md`。
