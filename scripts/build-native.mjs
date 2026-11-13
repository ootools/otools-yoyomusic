import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const nativeRoot = path.join(root, 'native');

// Keep this build entry point standalone. pack/verify owns strong PE/ELF/Mach-O
// header and machine validation through its package matrix.
const targets = new Map([
  ['x86_64-pc-windows-msvc', ['windows-x64', 'otools_yoyomusic_native.dll', 'Windows.dll']],
  ['aarch64-pc-windows-msvc', ['windows-arm64', 'otools_yoyomusic_native.dll', 'Windows.dll']],
  ['x86_64-apple-darwin', ['macos-x64', 'libotools_yoyomusic_native.dylib', 'macOS.dylib']],
  ['aarch64-apple-darwin', ['macos-arm64', 'libotools_yoyomusic_native.dylib', 'macOS.dylib']],
  ['x86_64-unknown-linux-gnu', ['linux-x64', 'libotools_yoyomusic_native.so', 'Linux.so']],
  ['aarch64-unknown-linux-gnu', ['linux-arm64', 'libotools_yoyomusic_native.so', 'Linux.so']],
]);

export function parseBuildArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (flag !== '--target' && flag !== '--out') {
      throw new Error(`unknown argument: ${flag}`);
    }
    const key = flag.slice(2);
    if (Object.hasOwn(options, key)) throw new Error(`duplicate argument: ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for argument: ${flag}`);
    options[key] = value;
  }
  return options;
}

export function createBuildPlan({ target, out } = {}) {
  const metadata = targets.get(target);
  if (!metadata) {
    throw new Error(`unsupported or missing --target: ${target ?? '(none)'}; supported targets: ${[...targets.keys()].join(', ')}`);
  }
  const [platformId, cargoName, packageName] = metadata;
  const targetDir = path.join(nativeRoot, 'target');
  const outputDir = out ? path.resolve(out) : path.join(root, 'lib', platformId);
  return {
    command: 'cargo',
    cwd: root,
    args: [
      'build', '--locked', '--release', '--lib',
      '--manifest-path', path.join(nativeRoot, 'Cargo.toml'),
      '--target', target,
      '--target-dir', targetDir,
    ],
    platformId,
    source: path.join(targetDir, target, 'release', cargoName),
    destination: path.join(outputDir, packageName),
  };
}

export function validateNativeSymbols(data) {
  for (const name of ['otools_plugin_invoke', 'otools_plugin_free']) {
    if (!data.includes(Buffer.from(`${name}\0`, 'ascii'))) {
      throw new Error(`native library is missing ABI symbol: ${name}`);
    }
  }
}

async function main() {
  const plan = createBuildPlan(parseBuildArgs(process.argv.slice(2)));
  // RUSTFLAGS (including Windows +crt-static) and linker selection are inherited
  // from CI unchanged. No cross-target compiler success is simulated here.
  const result = spawnSync(plan.command, plan.args, { cwd: plan.cwd, stdio: 'inherit', shell: false });
  if (result.error) throw new Error(`cannot run cargo: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`cargo build failed (${result.signal ?? result.status ?? 'no exit status'})`);
  const data = await readFile(plan.source);
  validateNativeSymbols(data);
  await mkdir(path.dirname(plan.destination), { recursive: true });
  await writeFile(plan.destination, data);
  console.log(`Native library staged: ${plan.destination} (${data.length} bytes, ${plan.platformId})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`build-native: ${error.message}`);
    process.exitCode = 1;
  });
}
