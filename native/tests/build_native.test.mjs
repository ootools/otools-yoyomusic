import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createBuildPlan, parseBuildArgs, validateNativeSymbols } from '../../scripts/build-native.mjs';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const nativeRoot = path.join(root, 'native');

const targets = [
  ['x86_64-pc-windows-msvc', 'windows-x64', 'otools_yoyomusic_native.dll', 'Windows.dll'],
  ['aarch64-pc-windows-msvc', 'windows-arm64', 'otools_yoyomusic_native.dll', 'Windows.dll'],
  ['x86_64-apple-darwin', 'macos-x64', 'libotools_yoyomusic_native.dylib', 'macOS.dylib'],
  ['aarch64-apple-darwin', 'macos-arm64', 'libotools_yoyomusic_native.dylib', 'macOS.dylib'],
  ['x86_64-unknown-linux-gnu', 'linux-x64', 'libotools_yoyomusic_native.so', 'Linux.so'],
  ['aarch64-unknown-linux-gnu', 'linux-arm64', 'libotools_yoyomusic_native.so', 'Linux.so'],
];

for (const [target, platformId, cargoName, packageName] of targets) {
  test(`native build plans real cargo output and standard staging name for ${platformId}`, () => {
    const plan = createBuildPlan({ target });
    assert.equal(plan.platformId, platformId);
    assert.equal(plan.source, path.join(nativeRoot, 'target', target, 'release', cargoName));
    assert.equal(plan.destination, path.join(root, 'lib', platformId, packageName));
    assert.equal(plan.command, 'cargo');
    assert.equal(plan.cwd, root);
    assert.deepEqual(plan.args, [
      'build', '--locked', '--release', '--lib',
      '--manifest-path', path.join(nativeRoot, 'Cargo.toml'),
      '--target', target,
      '--target-dir', path.join(nativeRoot, 'target'),
    ]);
  });
}

test('native build honors an explicit output directory without changing the library name', () => {
  const out = path.join(nativeRoot, 'stage', 'test-output');
  assert.equal(createBuildPlan({ target: 'x86_64-pc-windows-msvc', out }).destination, path.join(out, 'Windows.dll'));
});

test('native build rejects unsupported or missing targets', () => {
  for (const target of [undefined, '', 'x86_64-unknown-linux-musl', 'wasm32-unknown-unknown', 'toString']) {
    assert.throws(() => createBuildPlan({ target }), /target/);
  }
});

test('native CLI parses target and output values without shell interpolation', () => {
  assert.deepEqual(
    parseBuildArgs(['--target', 'x86_64-pc-windows-msvc', '--out', 'directory with spaces']),
    { target: 'x86_64-pc-windows-msvc', out: 'directory with spaces' },
  );
  assert.deepEqual(parseBuildArgs(['--target', 'aarch64-apple-darwin']), { target: 'aarch64-apple-darwin' });
});

test('native CLI rejects unknown flags, missing values and duplicate flags', () => {
  for (const args of [
    ['--unknown'], ['--target'], ['--out', '--target', 'x86_64-pc-windows-msvc'],
    ['--target', 'one', '--target', 'two'], ['--out', 'one', '--out', 'two'],
  ]) {
    assert.throws(() => parseBuildArgs(args), /argument|value|duplicate/);
  }
});

test('staging rejects buffers missing either mandatory ABI symbol', () => {
  for (const data of [Buffer.alloc(0), Buffer.from('otools_plugin_invoke'), Buffer.from('otools_plugin_free')]) {
    assert.throws(() => validateNativeSymbols(data), /otools_plugin_/);
  }
  assert.doesNotThrow(() => validateNativeSymbols(Buffer.from('\0otools_plugin_invoke\0otools_plugin_free\0')));
});
