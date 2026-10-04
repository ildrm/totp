import { randomBytes } from 'node:crypto';
import { writeFile, access } from 'node:fs/promises';
try {
  await access('.env');
  process.stdout.write('Existing .env retained.\n');
} catch {
  const password = randomBytes(32).toString('hex');
  const rate = randomBytes(32).toString('hex');
  const mfa = randomBytes(32).toString('hex');
  await writeFile(
    '.env',
    `NODE_ENV=development\nPOSTGRES_PASSWORD=${password}\nDATABASE_URL=postgres://still:${password}@127.0.0.1:55432/still\nAPP_ORIGIN=http://localhost:3000\nRP_ID=localhost\nPORT=4000\nRATE_LIMIT_KEY=${rate}\nMFA_ENABLED=true\nMFA_DEV_KEY=${mfa}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  process.stdout.write('Local development configuration generated. No credentials were printed.\n');
}
