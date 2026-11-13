# 六目标发布与市场分发

## 本次发布

用户授权：推送GitHub、添加 `xyito` 子模块、发布插件市场，独立插件内置lib的六个包。

- 仓库：`ootools/otools-yoyomusic`，公开，默认 `main`。
- 子模块：`xyito/xyito` 的 `otools/otools-yoyomusic`，跟踪 `main`。
- Release：`v0.1.1`。首轮 `v0.1.0` 的Win/Linux四目标成功，macos-14 runner不受支持取消，未发市场；保留历史标签，不强推改标签。
- 新runner：macos-latest，跨编译Intel/ARM并ad-hoc签名；Windows静态CRT、Linux原生runner。
- PAT：外部配置中的XyCloud市场PAT只在发布进程内使用，不写入Git、Release、源码包或日志，不自动存储到GitHub Secrets。

## 六目标与市场标准

新远程提交的stock插件固定SHA `95f5aa8` 提供六架构分发契约（此前本机源码未同步，只见三OS规范）。沿用它的suffix及市场字段，每个YoYoMusic包均包含真实对应平台lib，而不是复制纯前端包冒充库。

| ID | Rust target | 文件后缀 | 市场字段 | 库 |
|---|---|---|---|---|
| windows-x64 | x86_64-pc-windows-msvc | windows | packageUrlWindows | lib/Windows.dll |
| windows-arm64 | aarch64-pc-windows-msvc | windows-arm | packageUrlWindowsArm | lib/Windows.dll |
| macos-arm64 | aarch64-apple-darwin | macos | packageUrlMacos | lib/macOS.dylib |
| macos-x64 | x86_64-apple-darwin | macos-intel | packageUrlMacosIntel | lib/macOS.dylib |
| linux-x64 | x86_64-unknown-linux-gnu | linux | packageUrlLinux | lib/Linux.so |
| linux-arm64 | aarch64-unknown-linux-gnu | linux-arm | packageUrlLinuxArm | lib/Linux.so |

文件名：`otools-yoyomusic-0.1.1-<后缀>.oplg`。Release正好六个插件包；市场单uuid、`packageMode=1`、六URL字段，不引用缺失的通用包。

原生库提供健康查询、本地LRC解析及安全关闭回执；音频仍用已有Web Audio引擎，不改变Go布局和动效、不上传音乐、不新建网络服务。精确架构包 `native.enabled=true`，只有显式启用才使用可选原生歌词解析；库缺失会回退已测试的TS歌词解析。

## 验证与范围

CI六目标编译，校验二进制OS/CPU文件头、ABI导出、CRC、摘要与清单。Windows x64已在本地真实加载进行ABI health/LRC/free验证。CI构建并不代表所有平台真实OTools透明置顶、拖动和后台播放的实机验收，仍见 `docs/smoke-checklist.md`。

父仓库存在无关本地/远程分歧；只在基于远程main的干净worktree应用本次子模块gitlink和.gitmodules，不强推父main、不提交其它未推送提交。
