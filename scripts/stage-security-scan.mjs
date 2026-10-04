import { readdir, mkdir, copyFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
const root = resolve('.'),
  target = resolve('artifacts/scanner-source');
const excluded = new Set([
  '.git',
  '.next',
  '.agents',
  '.codex',
  '.aws',
  'node_modules',
  'out',
  'dist',
  'artifacts',
  'test-results',
  'playwright-report',
]);
async function copy(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(item.name) || (item.name.startsWith('.env') && item.name !== '.env.example'))
      continue;
    const source = resolve(directory, item.name);
    if (!source.startsWith(root + sep)) throw new Error('Source scan path escaped the workspace.');
    if (item.isDirectory()) {
      await copy(source);
      continue;
    }
    if (!item.isFile()) continue;
    const destination = resolve(target, relative(root, source));
    if (!destination.startsWith(target + sep))
      throw new Error('Scan destination escaped the artifact directory.');
    await mkdir(resolve(destination, '..'), { recursive: true });
    await copyFile(source, destination);
  }
}
await mkdir(target, { recursive: true });
await copy(root);
process.stdout.write(
  'Security scan source staged without local environments, browser state, or build caches.\n',
);
