# 悠悠乐听 · OTools 独立插件 0.1.4

本次更新：

- 启动调用 `window.otools.setTempHostTheme('dark', { background: 皮肤.bg })`，除临时暗色外壳外，新增让宿主 TABS 顶栏 / Panel 头部底色跟随当前皮肤（极光/午夜/落日/薄荷四套皮肤的页面底色），消除宿主默认暗色与播放器玻璃拟态色系的割裂；切换皮肤即时联动。
- 需要 OTools 0.9.4+ 支持背景染色；旧宿主会忽略未知参数，安全降级为只声明明暗主题，不影响音乐播放。
- 离开页面仍清除本页临时覆盖，不修改用户长期主题设置。
- 发布标签采用工作区规范 `plugin-otools-yoyomusic-v0.1.4`，兼容历史版本标签。

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
