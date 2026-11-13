import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function entryNames(buffer) {
  const end = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(end), 0x06054b50);
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const names = [];
  for (let index = 0; index < count; index += 1) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    const length = buffer.readUInt16LE(offset + 28);
    names.push(buffer.toString('utf8', offset + 46, offset + 46 + length));
    offset += 46 + length + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  return names;
}

test('正式插件包含许可证与可重建源码，不包含模拟宿主页或开发路由', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yoyomusic-pack-check-'));
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.mkdirSync(path.join(root, 'web', 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
    fs.mkdirSync(path.join(root, 'dist'));
    for (const script of ['pack-plugin.mjs', 'verify-plugin.mjs', 'package-matrix.mjs']) fs.copyFileSync(path.join(repository, 'scripts', script), path.join(root, 'scripts', script));
    fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({ packid: 'otools-yoyomusic', uuid: 'otools-yoyomusic', version: '0.1.0', entry: 'dist/index.html', devUrl: 'http://127.0.0.1:6482', quickDev: true }));
    fs.writeFileSync(path.join(root, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    fs.writeFileSync(path.join(root, 'LICENSE'), 'AGPL test license');
    fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'MIT attribution');
    fs.writeFileSync(path.join(root, 'package.json'), '{"scripts":{"build":"node scripts/build-web.mjs"}}');
    fs.writeFileSync(path.join(root, 'web', 'src', 'main.tsx'), 'export const app = "otools";');
    fs.writeFileSync(path.join(root, 'web', 'dev-check.html'), 'must not ship fake host');
    fs.writeFileSync(path.join(root, 'web', 'dev-check.ts'), 'fake host');
    fs.mkdirSync(path.join(root, 'web', 'node_modules', '.vite', 'vitest'), { recursive: true });
    fs.writeFileSync(path.join(root, 'web', 'node_modules', '.vite', 'vitest', 'results.json'), '{"cache":true}');
    fs.writeFileSync(path.join(root, 'web', '.env.local'), 'LOCAL_TEST_SECRET=not-for-package');
    fs.mkdirSync(path.join(root, 'native', 'stage'), { recursive: true });
    fs.writeFileSync(path.join(root, 'native', 'stage', 'Windows.dll'), 'private build output');
    fs.writeFileSync(path.join(root, 'dist', 'index.html'), '<title>OTools</title>');
    const output = path.join(root, 'absolute-output');
    const packed = spawnSync(process.execPath, [path.join(root, 'scripts', 'pack-plugin.mjs'), '--out', output], { encoding: 'utf8' });
    assert.equal(packed.status, 0, packed.stderr);
    assert.ok(fs.existsSync(path.join(output, 'otools-yoyomusic-0.1.0.oplg')), 'absolute --out must not be joined twice');
    const names = entryNames(fs.readFileSync(path.join(output, 'otools-yoyomusic-0.1.0.oplg')));
    for (const required of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'source/LICENSE', 'source/package.json', 'source/web/src/main.tsx', 'source/scripts/pack-plugin.mjs', 'dist/index.html']) assert.ok(names.includes(required), `missing ${required}`);
    assert.equal(names.some((name) => name.includes('dev-check')), false);
    assert.equal(names.some((name) => name.split('/').includes('node_modules')), false);
    assert.equal(names.some((name) => name.startsWith('source/native/stage/')), false);
    assert.equal(names.some((name) => name.split('/').some((part) => part.startsWith('.env'))), false);
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'plugin.json'), 'utf8'));
    assert.equal(Object.hasOwn(manifest, 'devUrl'), false);
    assert.equal(Object.hasOwn(manifest, 'quickDev'), false);
    const checked = spawnSync(process.execPath, [path.join(root, 'scripts', 'verify-plugin.mjs'), output], { encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stderr);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
