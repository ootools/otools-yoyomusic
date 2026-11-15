# 悠悠乐听 · OTools 独立插件 0.1.5

本次更新：

- 桌面歌词窗口升级为宿主 `windowType: "overlay"` NSPanel 浮层：可悬浮在任意界面之上（包括 Safari 等其他应用的全屏 Space），显示不抢焦点（不打断当前应用），macOS Dock 不再出现宿主图标；歌词窗拖动、锁定、鼠标穿透行为不变。
- 浮层是 macOS 专属行为；需要包含 NSPanel 浮层支持的新版 OTools 宿主生效。旧宿主会忽略 `windowType` 字段，安全降级为普通置顶悬浮窗（`alwaysOnTop` 继续兜底），不影响其他功能。
- 发布标签采用工作区规范 `plugin-otools-yoyomusic-v0.1.5`，兼容历史版本标签。

## 下载

| 系统 | 架构 | .oplg后缀 | 包内库 |
|---|---|---|---|
| Windows | x64 | windows | lib/Windows.dll |
| Windows | ARM64 | windows-arm | lib/Windows.dll |
| macOS | Apple Silicon | macos | lib/macOS.dylib |
| macOS | Intel | macos-intel | lib/macOS.dylib |
| Linux | x64 | linux | lib/Linux.so |
| Linux | ARM64 | linux-arm | lib/Linux.so |

每个包均包含真实对应架构lib。Windows静态CRT，macOS ad-hoc签名。原生lib提供健康查询、本地LRC解析和安全关闭回执；音频仍通过Web Audio播放。

本地425条前端测试、21条原生FFI/JSON测试和发布脚本测试、严格类型检查及构建验证通过。六平台产物由CI编译并核验OS/CPU、ABI、CRC和SHA256。跨系统真实OTools透明置顶、拖动和后台播放仍须实机验证，不因CI构建而宣称已完成。

完整对应源码和AGPL-3.0-or-later许可证随 `.oplg` 的 `source/` 提供；PAT/本地配置不进入源码、包或发布日志。
