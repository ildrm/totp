import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, sep } from 'node:path';
const project = `still-smoke-${randomBytes(4).toString('hex')}`;
const artifactRoot = resolve('artifacts'),
  compose = resolve(artifactRoot, `${project}.yml`),
  environment = resolve(artifactRoot, `.env.${project}`);
if (![compose, environment].every((path) => path.startsWith(artifactRoot + sep)))
  throw new Error('Invalid smoke-test artifact path.');
const databasePassword = randomBytes(32).toString('hex'),
  rateKey = randomBytes(32).toString('hex'),
  verifierKey = randomBytes(32).toString('hex');
const testEnvironment = {
  DATABASE_URL: `postgres://still:${databasePassword}@127.0.0.1:55433/still`,
  API_TEST_URL: 'http://127.0.0.1:4100/api',
  APP_ORIGIN: 'http://localhost:3100',
  RP_ID: 'localhost',
  RATE_LIMIT_KEY: rateKey,
  MFA_ENABLED: 'true',
  MFA_DEV_KEY: verifierKey,
  E2E_BASE_URL: 'http://localhost:3100',
};
await mkdir(artifactRoot, { recursive: true });
await writeFile(
  environment,
  Object.entries({ POSTGRES_PASSWORD: databasePassword, ...testEnvironment })
    .map(([key, value]) => `${key}=${value}\n`)
    .join(''),
  { flag: 'wx', mode: 0o600 },
);
await writeFile(
  compose,
  `services:
  db:
    image: still-database:release
    environment:
      POSTGRES_DB: still
      POSTGRES_USER: still
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
    ports: ['127.0.0.1:55433:5432']
    volumes: ['smoke-data:/var/lib/postgresql/data']
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U still -d still']
      interval: 2s
      timeout: 3s
      retries: 30
  migrate:
    image: still-api:release
    command: ['node','migrate.mjs']
    environment:
      DATABASE_URL: postgres://still:\${POSTGRES_PASSWORD}@db:5432/still
    depends_on:
      db: {condition: service_healthy}
    read_only: true
    cap_drop: ['ALL']
    security_opt: ['no-new-privileges:true']
  api:
    image: still-api:release
    environment:
      NODE_ENV: development
      DATABASE_URL: postgres://still:\${POSTGRES_PASSWORD}@db:5432/still
      APP_ORIGIN: http://localhost:3100
      RP_ID: localhost
      TRUST_PROXY_HOPS: '1'
      RATE_LIMIT_KEY: \${RATE_LIMIT_KEY}
      MFA_ENABLED: 'true'
      MFA_DEV_KEY: \${MFA_DEV_KEY}
    ports: ['127.0.0.1:4100:4000']
    depends_on:
      migrate: {condition: service_completed_successfully}
    read_only: true
    tmpfs: ['/tmp']
    cap_drop: ['ALL']
    security_opt: ['no-new-privileges:true']
  web:
    image: still-web:release
    environment:
      HOST: 0.0.0.0
      API_URL: http://api:4000
    ports: ['127.0.0.1:3100:3000']
    depends_on: ['api']
    read_only: true
    cap_drop: ['ALL']
    security_opt: ['no-new-privileges:true']
volumes:
  smoke-data:
`,
  { flag: 'wx' },
);
// Prepare-only mode lets an operator review and run each Docker/test step separately.
// This creates fixture files only; it neither starts nor removes any container.
if (process.argv.includes('--prepare')) {
  process.stdout.write(`Prepared isolated project: ${project}\n`);
  process.exit(0);
}
function execute(command, args, extra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, ...extra } });
    child.on('error', () => reject(new Error('Smoke-test process could not start.')));
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('Container smoke-test phase failed.')),
    );
  });
}
const composeArguments = ['compose', '--env-file', environment, '-p', project, '-f', compose];
try {
  await execute('docker', [...composeArguments, 'up', '-d', '--wait', '--wait-timeout', '120']);
  // Verify the upgrade runner is idempotent after a clean four-migration installation.
  await execute('docker', [...composeArguments, 'run', '--rm', '--no-deps', 'migrate']);
  await execute(process.execPath, ['scripts/database-recovery-smoke.mjs', project]);
  await execute('docker', [
    ...composeArguments,
    'exec',
    '-T',
    'api',
    'node',
    '-e',
    'if(process.getuid()===0)process.exit(1);console.info("API runtime is non-root.")',
  ]);
  const manager = process.env.npm_execpath;
  if (!manager) throw new Error('Run through pnpm test:containers.');
  const nativeManager = /\.exe$/i.test(manager),
    command = nativeManager ? manager : process.execPath;
  for (const script of ['test', 'test:e2e'])
    await execute(
      command,
      nativeManager ? ['run', script] : [manager, 'run', script],
      testEnvironment,
    );
  process.stdout.write(
    'Fresh database migrations, idempotent migration, isolated API tests, and runtime browser checks passed.\n',
  );
} finally {
  // Only this invocation's randomly named project and synthetic volume are removed.
  await execute('docker', [...composeArguments, 'down', '--volumes', '--remove-orphans']).catch(
    () => process.stderr.write('Synthetic stack cleanup needs operator attention.\n'),
  );
  await unlink(environment);
}
