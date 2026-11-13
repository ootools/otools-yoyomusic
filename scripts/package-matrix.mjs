export const NATIVE_TARGETS = [
  { id: 'windows-x64', platform: 'windows', arch: 'x64', target: 'x86_64-pc-windows-msvc', file: 'Windows.dll' },
  { id: 'windows-arm64', platform: 'windows', arch: 'arm64', target: 'aarch64-pc-windows-msvc', file: 'Windows.dll' },
  { id: 'macos-x64', platform: 'macos', arch: 'x64', target: 'x86_64-apple-darwin', file: 'macOS.dylib' },
  { id: 'macos-arm64', platform: 'macos', arch: 'arm64', target: 'aarch64-apple-darwin', file: 'macOS.dylib' },
  { id: 'linux-x64', platform: 'linux', arch: 'x64', target: 'x86_64-unknown-linux-gnu', file: 'Linux.so' },
  { id: 'linux-arm64', platform: 'linux', arch: 'arm64', target: 'aarch64-unknown-linux-gnu', file: 'Linux.so' },
];

/** 校验OS/CPU文件头和必需ABI符号；不会拿改名文本冒充真实平台库。 */
export function inspectNative(data, id) {
  const expected = NATIVE_TARGETS.find((value) => value.id === id);
  if (!expected) throw new Error(`Unknown native target: ${id}`);
  let platform; let arch;
  if (data.length >= 0x40 && data.toString('ascii', 0, 2) === 'MZ') {
    const offset = data.readUInt32LE(0x3c);
    if (offset + 6 > data.length || data.readUInt32LE(offset) !== 0x4550) throw new Error('Invalid PE library');
    platform = 'windows';
    arch = ({ 0x8664: 'x64', 0xaa64: 'arm64' })[data.readUInt16LE(offset + 4)];
  } else if (data.length >= 20 && data.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    if (data[4] !== 2 || data[5] !== 1) throw new Error('Expected little-endian ELF64 library');
    platform = 'linux';
    arch = ({ 62: 'x64', 183: 'arm64' })[data.readUInt16LE(18)];
  } else if (data.length >= 8 && data.readUInt32LE(0) === 0xfeedfacf) {
    platform = 'macos';
    arch = ({ 0x1000007: 'x64', 0x100000c: 'arm64' })[data.readUInt32LE(4)];
  }
  if (platform !== expected.platform || arch !== expected.arch) throw new Error(`Native OS/architecture mismatch for ${id}: ${platform || 'unknown'}-${arch || 'unknown'}`);
  for (const symbol of ['otools_plugin_invoke', 'otools_plugin_free']) if (!data.includes(Buffer.from(symbol))) throw new Error(`Missing native export: ${symbol}`);
  return { platform, arch };
}

/** 精确架构包启用lib；OS兼容包仅携带可选库，由现有完整前端提供功能。 */
export function packageSpec(manifest, variant = 'web') {
  const target = NATIVE_TARGETS.find((value) => value.id === variant);
  const targets = target ? [target] : NATIVE_TARGETS.filter((value) => variant === 'universal' || value.platform === variant);
  if (variant !== 'web' && !targets.length) throw new Error(`Unknown package variant: ${variant}`);
  const native = { ...manifest.native, enabled: Boolean(target), autoReload: false, libDir: 'lib' };
  const libraries = targets.map((value) => target ? `lib/${value.file}` : `lib/${value.id}/${value.file}`);
  return { manifest: { ...manifest, native }, targets, libraries, suffix: variant === 'web' || variant === 'universal' ? '' : variant };
}
