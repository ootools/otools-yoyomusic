/**
 * 构建插件前端 → dist/（本仓库唯一的构建入口）。
 * ------------------------------------------------------------------
 * 本插件是 Vite + React + TS：源码在 web/，由仓库根的 vite.config.ts
 * （root=web、outDir=../dist、emptyOutDir）驱动 vite build。
 * 构建后自检：dist/index.html 必须存在且包含 OTools 宿主桥标记（/otools/i，
 * verify-plugin.mjs 对入口 HTML 有同样要求），否则退出码非 0。
 *
 * 用法：node scripts/build-web.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');

if (!fs.existsSync(viteBin)) {
  console.error('找不到 vite：请先执行 npm install。');
  process.exit(1);
}

// stdin 必须是 'ignore'：某些机器（安全软件挂钩匿名管道）上给子进程接 stdin 管道
// 会让 CreateProcess 直接 EBUSY（沿用模板脚本约定）。
const result = spawnSync(process.execPath, [viteBin, 'build'], {
  cwd: repoRoot,
  stdio: ['ignore', 'inherit', 'inherit'],
});
if (result.error) {
  console.error('执行失败：vite build');
  console.error(result.error.message);
  process.exit(1);
}
if ((result.status ?? 1) !== 0) {
  console.error('vite build 失败。');
  process.exit(result.status ?? 1);
}

// 入口自检：dist/index.html 必须存在且含 OTools 宿主桥标记。
const entry = path.join(repoRoot, 'dist', 'index.html');
if (!fs.existsSync(entry)) {
  console.error(`构建产物里没有 ${entry}，但 plugin.json 的 entry 指向它。`);
  process.exit(1);
}
const html = fs.readFileSync(entry, 'utf8');
if (!/otools/i.test(html)) {
  console.error('dist/index.html 里没有 OTools 宿主桥标记（应包含 /otools/i 可匹配的字符串）。');
  process.exit(1);
}

for (const notice of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  const source = path.join(repoRoot, notice);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(repoRoot, 'dist', notice));
}

console.log(`\n完成。${entry} 就绪且含 OTools 宿主桥标记；用 scripts/deploy-to-otools.ps1 同步到 otools 仓库即可本地试跑。`);
