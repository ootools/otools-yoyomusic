import test from 'node:test';
import assert from 'node:assert/strict';
import { NATIVE_TARGETS, inspectNative, packageSpec } from './package-matrix.mjs';

function library(id) {
  const metadata = NATIVE_TARGETS.find((target) => target.id === id);
  const bytes = Buffer.alloc(256);
  if (metadata.platform === 'windows') {
    bytes.write('MZ'); bytes.writeUInt32LE(0x40, 0x3c); bytes.writeUInt32LE(0x4550, 0x40); bytes.writeUInt16LE(metadata.arch === 'arm64' ? 0xaa64 : 0x8664, 0x44);
  } else if (metadata.platform === 'linux') {
    bytes.set([0x7f,0x45,0x4c,0x46,2,1]); bytes.writeUInt16LE(metadata.arch === 'arm64' ? 183 : 62, 18);
  } else {
    bytes.writeUInt32LE(0xfeedfacf, 0); bytes.writeUInt32LE(metadata.arch === 'arm64' ? 0x100000c : 0x1000007, 4);
  }
  bytes.write('otools_plugin_invoke\0otools_plugin_free', 100);
  return bytes;
}

test('六个独立目标必须含真实对应OS和CPU的native库', () => {
  assert.equal(NATIVE_TARGETS.length, 6);
  for (const target of NATIVE_TARGETS) {
    assert.deepEqual(inspectNative(library(target.id), target.id), { platform: target.platform, arch: target.arch });
    const wrong = NATIVE_TARGETS.find((other) => other.id !== target.id);
    assert.throws(() => inspectNative(library(wrong.id), target.id));
    const spec = packageSpec({ version: '0.1.0', packid: 'otools-yoyomusic', native: {} }, target.id);
    assert.equal(spec.manifest.native.enabled, true);
    assert.deepEqual(spec.libraries, [`lib/${target.file}`]);
  }
});
test('兼容包不在未知架构上默认加载动态库，包含双架构目录', () => {
  const platform = packageSpec({ version: '0.1.0', packid: 'otools-yoyomusic', native: { enabled: true } }, 'windows');
  assert.equal(platform.manifest.native.enabled, false);
  assert.deepEqual(platform.libraries, ['lib/windows-x64/Windows.dll', 'lib/windows-arm64/Windows.dll']);
  const all = packageSpec({ version: '0.1.0', packid: 'otools-yoyomusic' }, 'universal');
  assert.equal(all.manifest.native.enabled, false);
  assert.equal(all.libraries.length, 6);
});
test('六架构发布使用当前市场标准后缀和字段', () => {
  assert.deepEqual(NATIVE_TARGETS.map((value) => value.suffix), ['windows', 'windows-arm', 'macos-intel', 'macos', 'linux', 'linux-arm']);
  assert.deepEqual(NATIVE_TARGETS.map((value) => value.field), ['packageUrlWindows', 'packageUrlWindowsArm', 'packageUrlMacosIntel', 'packageUrlMacos', 'packageUrlLinux', 'packageUrlLinuxArm']);
  for (const target of NATIVE_TARGETS) assert.equal(packageSpec({}, target.id).suffix, target.suffix);
});

test('缺导出、未知平台或伪造二进制均拒绝', () => {
  assert.throws(() => inspectNative(Buffer.from('fake dll'), 'windows-x64'));
  const missing = library('linux-arm64'); missing.fill(0, 100);
  assert.throws(() => inspectNative(missing, 'linux-arm64'));
  assert.throws(() => packageSpec({}, '../../invalid'));
});
