import { loadEnvFile } from 'node:process';
import { spawn } from 'node:child_process';
try {
  loadEnvFile('.env');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const child = spawn(process.execPath, ['apps/api/migrate.mjs'], {
  stdio: 'inherit',
  env: process.env,
});
child.on('exit', (code) => process.exit(code ?? 1));
