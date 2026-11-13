# 悠悠乐听 GitHub / 市场发布结果

## 已完成

- GitHub 仓库：https://github.com/ootools/otools-yoyomusic ，公开，main。
- 正式 Release：https://github.com/ootools/otools-yoyomusic/releases/tag/v0.1.2
- 成功流水线：https://github.com/ootools/otools-yoyomusic/actions/runs/43414248797
- 发布提交：`7028547ae73c55d994dbed1bc97b1345b073c910`。
- `xyito/xyito` 的 `otools/otools-yoyomusic` 子模块已推送，跟踪main，最初发布指针为上述提交。
- 市场：PAT发布接口业务码200；公开插件列表已查实 `id/packid=otools-yoyomusic`、`version=0.1.2`、`packageMode=1`。
- PAT从用户指定的仓库外配置读入，只在发布进程内使用；未提交、未写入Release或GitHub Secrets、未输出凭证。

## 六个独立内置lib包

| OS / CPU | Release文件 | lib尺寸 |
|---|---|---|
| Windows x64 | otools-yoyomusic-0.1.2-windows.oplg | 311296 bytes |
| Windows ARM64 | otools-yoyomusic-0.1.2-windows-arm.oplg | 293376 bytes |
| macOS Apple Silicon | otools-yoyomusic-0.1.2-macos.oplg | 400880 bytes |
| macOS Intel | otools-yoyomusic-0.1.2-macos-intel.oplg | 395200 bytes |
| Linux x64 | otools-yoyomusic-0.1.2-linux.oplg | 411760 bytes |
| Linux ARM64 | otools-yoyomusic-0.1.2-linux-arm.oplg | 373384 bytes |

所有包 `native.enabled=true`，Windows库staticCRT，macOS ad-hoc签名。原生lib处理健康查询、LRC解析和安全关闭；音频仍用Web Audio。

每个包均从GitHub下载到新的隔离目录，用本仓库校验脚本独立验证：SHA256摘要、ZIP CRC/大小/路径、平台库OS和CPU文件头、必需ABI导出、入口、对应源码与许可证。六包全部通过，无用户音乐/凭证/环境文件/node_modules或测试夹具。市场六个packageUrl字段精确指向这些已存在文件，公开列表读回确认。

## 发布过程中修复

1. v0.1.0：Win/Linux四lib成功，旧macos-14 runner不可用取消，未产生Release和市场版本。
2. v0.1.1：六目标lib全部成功，Linux绝对输出路径被重复join导致打包失败，未发布市场。
3. v0.1.2：改用path.resolve，并使用相对暂存输出路径；六个平台、前端和打包作业全部成功。未强推或覆盖旧标签。
4. 初始本地只见三OS发布规范；同步新远程stock先例后对齐六架构标准后缀/URL字段，最终正好六个插件包，不额外发布通用或兼容包。

## 验证边界

前端413测试、脚本30测试、原生21FFI/JSON测试通过；六平台CI编译校验通过不等于所有系统的真实OTools运行验收。透明置顶/拖动/后台播放和真实音乐的大库性能仍见 `smoke-checklist.md` 未验项。原生窗口实现已保留，不拿浏览器弹窗冒充置顶能力。

## 父仓库保护

本机xyito main原有无关本地/远程分歧；直接push被拒后，使用基于远程main的新干净worktree，仅应用本次.gitmodules/gitlink新增与版本更新。没有强推、丢弃或提交其它本地修改。远程main的所有其它插件变更保留。
