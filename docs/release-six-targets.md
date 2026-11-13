# 六目标发布与市场分发

## 本次发布

用户授权：推送GitHub、添加 `xyito` 子模块、发布插件市场，要求独立插件内置lib的六个包。对“六包”未另给组合答案，因此本次采用 `Windows/macOS/Linux × x64/arm64` 六目标作为实施默认（不是用户明示的矩阵）。

- 仓库：`ootools/otools-yoyomusic`，公开，默认 `main`。
- 子模块：`xyito/xyito` 中 `otools/otools-yoyomusic`，跟踪 `main`。
- Release：`v0.1.0`，与插件版本保持一致；只有真实CI编译成功才上传平台lib。
- PAT：外部配置中的XyCloud市场PAT只在发布进程内使用，不写入Git、Release、源码包或日志，不自动存储到GitHub Secrets。

## 六目标

| ID | Rust target | lib文件 |
|---|---|---|
| windows-x64 | x86_64-pc-windows-msvc | lib/Windows.dll |
| windows-arm64 | aarch64-pc-windows-msvc | lib/Windows.dll |
| macos-x64 | x86_64-apple-darwin | lib/macOS.dylib |
| macos-arm64 | aarch64-apple-darwin | lib/macOS.dylib |
| linux-x64 | x86_64-unknown-linux-gnu | lib/Linux.so |
| linux-arm64 | aarch64-unknown-linux-gnu | lib/Linux.so |

文件名：`otools-yoyomusic-0.1.0-<ID>.oplg`。

新增原生库只提供插件ABI健康查询、本地LRC解析及安全关闭回执；音频仍用已有Web Audio引擎，不改变Go布局和动效、不上传音乐、不自行构建新的网络服务。

## 市场兼容

现有宿主的native清单只支持静态 `libDir/libName/libPath`，市场只支持三种OS的package URL，不具有可验证的六架构自动选择契约。为了不让不同架构用户加载错误二进制：

- 六个精确架构包启用 `native.enabled=true`，对应固定平台lib。
- 三个市场OS兼容包和通用包携带目标库于 `lib/<ID>/`，设置 `native.enabled=false`；所有音乐/歌词/窗口前端功能正常走宿主接口和Web Audio，不依赖可选原生库。
- 市场payload：同一uuid，`packageMode=1`，`packageUrlWindows/Macos/Linux` 指OS兼容包，`packageUrl` 为通用包。不得编造额外服务器架构分发API。

CI编译六目标并验证文件头的OS/架构、ABI导出、摘要、每包内容；Windows x64可本地编译做ABI调用测试，其它平台声明“CI构建验证”而非“真实宿主实机播放验收”。

## 验证与外部动作

1. 原生库JSON输入/输出与FFI边界测试，原生库不接受任意路径读写。
2. 六目标ZIP分别检查native清单、平台库文件头与导出；兼容包不错误启用native。
3. CI安装锁定依赖，前端全套test/typecheck/build，原生六目标build。
4. 创建GitHub库、提交/推送、父子模块仅提交 `.gitmodules` 与gitlink，不提交其它工作区修改。
5. Release全部产物成功后，市场PAT请求并查询线上元信息验证。
6. 原生窗口透明置顶/拖动与后台播放的真实OTools验收仍按 `docs/smoke-checklist.md` 标未验证，不因发布而勾选。
