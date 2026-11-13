import fs from 'node:fs';
import path from 'node:path';
import { inflateRawSync, crc32 } from 'node:zlib';
import { createHash } from 'node:crypto';
import { NATIVE_TARGETS, inspectNative } from './package-matrix.mjs';

/** 独立核验从Release下载的六包；只读字节不解包或执行下载内容。 */
const directory = process.argv[2];
if (!directory) throw new Error('Release directory argument is required');
const source = JSON.parse(fs.readFileSync(path.join(directory, 'plugin.json'), 'utf8'));
const expectedFiles = new Set(['plugin.json', 'logo.svg', ...NATIVE_TARGETS.map((target) => `${source.packid}-${source.version}-${target.suffix}.oplg`)]);
const sums = fs.readFileSync(path.join(directory, 'SHA256SUMS'), 'utf8').trim().split(/\r?\n/);
if (sums.length !== expectedFiles.size) throw new Error('Checksum list must cover the six packages and manifest/logo');
for (const line of sums) {
  const [digest, name] = line.split('  ');
  if (!expectedFiles.delete(name)) throw new Error(`Unexpected or duplicate checksum entry: ${name}`);
  if (createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex') !== digest) throw new Error(`Checksum mismatch: ${name}`);
}
function zipEntries(buffer) {
  const end = buffer.length - 22;
  if (buffer.readUInt32LE(end) !== 0x06054b50) throw new Error('Missing ZIP end record');
  let offset = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  for (let index = 0; index < buffer.readUInt16LE(end + 10); index++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP directory');
    const method = buffer.readUInt16LE(offset + 10), checksum = buffer.readUInt32LE(offset + 16);
    const size = buffer.readUInt32LE(offset + 20), decodedSize = buffer.readUInt32LE(offset + 24), len = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + len), local = buffer.readUInt32LE(offset + 42);
    if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..') || entries.has(name)) throw new Error(`Unsafe archive name: ${name}`);
    if (buffer.readUInt32LE(local) !== 0x04034b50) throw new Error('Invalid ZIP local record');
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(start, start + size);
    const data = method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null;
    if (!data || data.length !== decodedSize || crc32(data) !== checksum) throw new Error(`ZIP CRC/size mismatch: ${name}`);
    entries.set(name, data);
    offset += 46 + len + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  return entries;
}
const report = [];
for (const target of NATIVE_TARGETS) {
  const filename = `${source.packid}-${source.version}-${target.suffix}.oplg`;
  const entries = zipEntries(fs.readFileSync(path.join(directory, filename)));
  const manifest = JSON.parse(entries.get('plugin.json').toString('utf8'));
  if (manifest.version !== source.version || manifest.uuid !== source.uuid || manifest.native?.enabled !== true || manifest.devUrl || manifest.quickDev) throw new Error(`Invalid release manifest: ${filename}`);
  const libraries = [...entries.keys()].filter((name) => name.startsWith('lib/'));
  if (libraries.length !== 1 || libraries[0] !== `lib/${target.file}`) throw new Error(`Wrong native library layout: ${filename}`);
  const native = entries.get(libraries[0]);
  inspectNative(native, target.id);
  for (const required of ['dist/index.html', 'LICENSE', 'source/native/src/lib.rs', 'source/native/Cargo.lock']) if (!entries.has(required)) throw new Error(`Missing release source/license: ${required}`);
  for (const name of entries.keys()) if (name.includes('dev-check') || name.split('/').some((part) => ['node_modules', '.git', 'stage', 'target'].includes(part) || part.startsWith('.env'))) throw new Error(`Development data leaked: ${name}`);
  report.push({ package: filename, nativeFile: libraries[0], nativeBytes: native.length, platform: target.platform, arch: target.arch, entries: entries.size });
}
console.log(JSON.stringify({ packid: source.packid, version: source.version, checksums: 'verified', packages: report }, null, 2));
