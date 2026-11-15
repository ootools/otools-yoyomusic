# 悠悠乐听 · OTools 独立插件 0.1.3

本次更新：

- 接入宿主最新 `window.otools.pageMode()`，实际为 `panel` 时隐藏顶栏logo和名称；tabs/独立窗口保留，不再以插件内部路由误判宿主容器。
- 启动时调用 `window.otools.setTempHostTheme('dark')` 临时使用暗色宿主外壳，离开页面清除覆盖；不修改用户长期主题设置。
- 旧宿主缺少上述能力时兼容跳过，不影响音乐播放。
- 发布标签采用工作区规范 `plugin-otools-yoyomusic-v0.1.3`，兼容历史版本标签。

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

本地423条前端测试、21条原生FFI/JSON测试和发布脚本测试、严格类型检查及构建验证通过。六平台产物由CI编译并核验OS/CPU、ABI、CRC和SHA256。跨系统真实OTools透明置顶、拖动和后台播放仍须实机验证，不因CI构建而宣称已完成。

完整对应源码和AGPL-3.0-or-later许可证随 `.oplg` 的 `source/` 提供；PAT/本地配置不进入源码、包或发布日志。
