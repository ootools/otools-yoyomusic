# 悠悠乐听 · OTools 独立插件 0.1.7

本次更新：

- 频谱柱布局优化：柱体下移贴近播放条，柱顶上方稳定留出约三分之一空间；倒影高度钳制在画布内，不再渗到播放进度条下面（画布底边对齐进度条顶沿）。
- 移除动效下方「实时 —— 模式」状态文案，画面更干净。
- 动效切换按钮移入右上按钮组首位（频谱柱 pill → 均衡器 → 歌词 → 外观 → 关于），不再占用顶栏中央。
- 打开桌面歌词独立窗口后自动收起右侧歌词栏，歌词不再两处同时显示。

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
