import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { NATIVE_TARGETS, inspectNative } from './package-matrix.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback;
const libRoot = path.resolve(root, option('libs', 'lib'));
const output = path.resolve(root, option('out', 'dist-release'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
const invoke = (script, argv) => {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', script), ...argv], { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`${script} failed (${result.status ?? result.error?.code})`);
};

try {
  // 六架构真实库齐备才发布，按最新市场标准suffix生成正好六包。
  for (const target of NATIVE_TARGETS) inspectNative(fs.readFileSync(path.join(libRoot, target.id, target.file)), target.id);
  fs.mkdirSync(output, { recursive: true });
  const variants = NATIVE_TARGETS.map((value) => value.id);
  const assets = [];
  for (const variant of variants) {
    const staging = path.join(root, 'dist-pack', `matrix-${variant}`);
    invoke('pack-plugin.mjs', ['--variant', variant, '--libs', libRoot, '--out', path.relative(root, staging)]);
    invoke('verify-plugin.mjs', [staging]);
    const metadata = JSON.parse(fs.readFileSync(path.join(staging, 'meta.json'), 'utf8'));
    fs.copyFileSync(path.join(staging, metadata.filename), path.join(output, metadata.filename));
    assets.push(metadata.filename);
    if (variant === 'windows-x64') for (const name of ['plugin.json', 'logo.svg']) { fs.copyFileSync(path.join(staging, name), path.join(output, name)); assets.push(name); }
  }
  const sums = assets.sort().map((name) => `${createHash('sha256').update(fs.readFileSync(path.join(output, name))).digest('hex')}  ${name}`);
  fs.writeFileSync(path.join(output, 'SHA256SUMS'), `${sums.join('\n')}\n`);
  const report = { packid: manifest.packid, version: manifest.version, nativeTargets: NATIVE_TARGETS.map((value) => value.id), packageCount: 6, assets };
  fs.writeFileSync(path.join(output, 'release-assets.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Six actual native target packages ready: ${output}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
