import './setup.mjs';
import { loadEnvFile } from 'node:process';
import { spawn } from 'node:child_process';
loadEnvFile('.env');
if (!process.env.npm_execpath) throw new Error('Run through pnpm dev:all.');
function execute(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env: process.env });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('Development setup failed.')),
    );
  });
}
await execute('docker', ['compose', 'up', '--build', '-d', '--wait', 'db']);
await execute(process.execPath, ['apps/api/migrate.mjs']);
const nativeManager = /\.exe$/i.test(process.env.npm_execpath);
const children = ['dev:api', 'dev'].map((script) =>
  spawn(
    nativeManager ? process.env.npm_execpath : process.execPath,
    nativeManager ? ['run', script] : [process.env.npm_execpath, 'run', script],
    {
      stdio: 'inherit',
      env: process.env,
    },
  ),
);
for (const child of children)
  child.on('exit', (code) => {
    for (const other of children) if (other !== child) other.kill();
    process.exitCode = code ?? 1;
  });
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    for (const child of children) child.kill(signal);
  });
