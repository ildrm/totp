import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { format, resolveConfig } from 'prettier';
if (!process.env.npm_execpath) throw new Error('Run this command through pnpm security:sbom.');
const nativeManager = process.env.npm_execpath.toLowerCase().endsWith('.exe');
const command = spawnSync(
  nativeManager ? process.env.npm_execpath : process.execPath,
  [
    ...(nativeManager ? [] : [process.env.npm_execpath]),
    '-r',
    'list',
    '--prod',
    '--depth',
    'Infinity',
    '--json',
  ],
  { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
);
if (command.status !== 0)
  throw new Error('Dependency inventory failed. Run with package-store access.');
const graph = JSON.parse(command.stdout),
  components = new Map(),
  dependencies = new Map(),
  seen = new Set();
async function visit(node) {
  if (!node.path) return null;
  const path = resolve(node.path);
  let pkg,
    installed = true;
  try {
    pkg = JSON.parse(await readFile(resolve(path, 'package.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT' || !node.resolved?.startsWith('https://') || !node.from)
      throw error;
    pkg = { name: node.from, version: node.version };
    installed = false;
  }
  const purl = `pkg:npm/${pkg.name.replace('@', '%40')}@${pkg.version}`;
  if (!components.has(purl))
    components.set(purl, {
      type: pkg.name.startsWith('@still/') ? 'application' : 'library',
      'bom-ref': purl,
      name: pkg.name,
      version: pkg.version,
      properties: [{ name: 'still:installed-on-inventory-platform', value: String(installed) }],
      purl,
      ...(pkg.license
        ? {
            licenses: [
              {
                license: {
                  name:
                    typeof pkg.license === 'string'
                      ? pkg.license
                      : (pkg.license.type ?? 'Unspecified'),
                },
              },
            ],
          }
        : {}),
      ...(node.resolved?.startsWith('https://')
        ? { externalReferences: [{ type: 'distribution', url: node.resolved }] }
        : {}),
    });
  if (seen.has(path) && !node.dependencies && !node.optionalDependencies) return purl;
  seen.add(path);
  const childRefs = [];
  for (const child of Object.values({ ...node.dependencies, ...node.optionalDependencies })) {
    const ref = await visit(child);
    if (ref) childRefs.push(ref);
  }
  dependencies.set(purl, new Set([...(dependencies.get(purl) ?? []), ...childRefs]));
  return purl;
}
for (const project of graph) await visit(project);
const lockHash = createHash('sha256')
  .update(await readFile('pnpm-lock.yaml'))
  .digest('hex');
const list = [...components.values()].sort((a, b) => a.purl.localeCompare(b.purl));
const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  serialNumber: `urn:uuid:${randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: { type: 'application', name: 'still-authenticator', version: '1.0.0' },
    properties: [{ name: 'still:pnpm-lock-sha256', value: lockHash }],
  },
  components: list,
  dependencies: [...dependencies]
    .map(([ref, refs]) => ({ ref, dependsOn: [...refs].sort() }))
    .sort((a, b) => a.ref.localeCompare(b.ref)),
};
await mkdir('artifacts', { recursive: true });
await mkdir('docs/security', { recursive: true });
await writeFile('artifacts/still.cdx.json', JSON.stringify(bom, null, 2) + '\n');
await writeFile(
  'docs/security/dependency-inventory.md',
  await format(
    `# Production dependency inventory\n\nGenerated with \`pnpm security:sbom\`. Lockfile SHA-256: \`${lockHash}\`. This inventory records resolved runtime packages, including optional platform variants, and declared licenses where available; bundled framework components and distribution obligations require release review. The CycloneDX artifact is \`artifacts/still.cdx.json\`.\n\n| Package | Version | Declared license |\n| --- | --- | --- |\n${list.map((c) => `| ${c.name} | ${c.version} | ${(c.licenses?.[0]?.license.name ?? 'Unspecified — review required').replaceAll('|', '\\|')} |`).join('\n')}\n`,
    {
      ...(await resolveConfig('docs/security/dependency-inventory.md')),
      parser: 'markdown',
    },
  ),
);
process.stdout.write(
  `CycloneDX SBOM and license inventory generated: ${list.length} runtime components.\n`,
);
