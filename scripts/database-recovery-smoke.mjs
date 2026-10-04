import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

// This intentionally changes schema state, so only a prepared synthetic project
// with the reserved loopback test ports and test volume is accepted.
const project = process.argv[2];
if (!/^still-smoke-[a-f0-9]{8}$/.test(project ?? ''))
  throw new Error('A prepared synthetic project name is required.');
const root = resolve('artifacts');
const compose = resolve(root, `${project}.yml`),
  environment = resolve(root, `.env.${project}`);
if (![compose, environment].every((path) => path.startsWith(root + sep)))
  throw new Error('Synthetic recovery path escaped its artifact directory.');
const configuration = await readFile(compose, 'utf8');
const fixtureEnvironment = await readFile(environment, 'utf8');
if (
  !configuration.includes('image: still-database:release') ||
  !configuration.includes('127.0.0.1:55433:5432') ||
  !configuration.includes('smoke-data:') ||
  !fixtureEnvironment.includes('API_TEST_URL=http://127.0.0.1:4100/api\n')
)
  throw new Error('Only the generated synthetic recovery fixture is accepted.');
const prefix = [
  'compose',
  '--env-file',
  environment,
  '-p',
  project,
  '-f',
  compose,
  'exec',
  '-T',
  'db',
];
function execute(args) {
  const result = spawnSync('docker', [...prefix, ...args], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Synthetic database recovery check failed.');
}
execute([
  'psql',
  '-U',
  'still',
  '-d',
  'still',
  '-v',
  'ON_ERROR_STOP=1',
  '-c',
  "CREATE TABLE public.still_restore_probe (id integer PRIMARY KEY, cipher text NOT NULL); INSERT INTO public.still_restore_probe VALUES (1, 'synthetic encrypted-record marker');",
]);
execute([
  'pg_dump',
  '-U',
  'still',
  '-d',
  'still',
  '--format=custom',
  '--compress=gzip:6',
  '--file=/tmp/still-synthetic.dump',
]);
execute([
  'psql',
  '-U',
  'still',
  '-d',
  'still',
  '-v',
  'ON_ERROR_STOP=1',
  '-c',
  'DELETE FROM public.still_restore_probe;',
]);
execute([
  'pg_restore',
  '-U',
  'still',
  '-d',
  'still',
  '--single-transaction',
  '--clean',
  '--if-exists',
  '--no-owner',
  '--no-acl',
  '--exit-on-error',
  '/tmp/still-synthetic.dump',
]);
execute([
  'psql',
  '-U',
  'still',
  '-d',
  'still',
  '-v',
  'ON_ERROR_STOP=1',
  '-c',
  "DO $$ BEGIN IF (SELECT cipher FROM public.still_restore_probe WHERE id=1) IS DISTINCT FROM 'synthetic encrypted-record marker' OR (SELECT count(*) FROM public.schema_migrations) <> 4 OR (SELECT max(version) FROM public.schema_migrations) <> 4 THEN RAISE EXCEPTION 'Synthetic restore integrity failed'; END IF; END $$; DROP TABLE public.still_restore_probe;",
]);
process.stdout.write(
  'Synthetic gzip database backup, atomic restore, marker integrity and schema versions passed.\n',
);
