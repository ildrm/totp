import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.loadEnvFile(new URL('../.env', import.meta.url));
const child = spawn(
  process.execPath,
  [fileURLToPath(new URL('../apps/api/dist/apps/api/src/main.js', import.meta.url))],
  { env: process.env, stdio: 'inherit' },
);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => (process.exitCode = code ?? 1));
