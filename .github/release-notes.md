# 悠悠乐听 · OTools 独立插件 0.1.6

本次更新：

- 支持系统文件关联：声明 7 种音频格式（`mp3` / `wav` / `flac` / `ogg` / `aac` / `m4a` / `opus`），在 OTools 设置 →「文件关联」里勾选后，这些类型的文件可以直接投递给悠悠乐听打开。
- 声明了 `default: true`：同一扩展名被多个插件声明时（`.mp3` 同时被 puter-audio、soundcraft 声明），悠悠乐听作为专用播放器直接接管，不再弹「用哪个插件打开」的选择框。这是宿主 0.9.8 起的新语义；旧宿主会忽略该字段，退化成弹框询问。
- 本版首次进入 OTools 插件市场，六个平台分包（`packageMode=1`），安装对应平台的 `.oplg` 即可。

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
