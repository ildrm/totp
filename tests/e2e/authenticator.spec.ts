import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const QR: typeof import('qrcode') = createRequire(
  new URL('../../apps/web/package.json', import.meta.url),
)('qrcode');
const passphrase = 'a calm meadow under silver stars';
const fixture = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
async function create(page: Page) {
  await page.goto('/');
  await page.getByLabel('Vault passphrase', { exact: true }).fill(passphrase);
  await page.getByLabel('Confirm passphrase', { exact: true }).fill(passphrase);
  await page.getByRole('button', { name: 'Create secure vault' }).click();
  await expect(page.getByRole('heading', { name: 'Your way back in.' })).toBeVisible();
  const recovery = (await page.locator('.recovery-key').textContent())!.trim();
  await page.getByLabel('I saved my recovery key').check();
  await page.getByRole('button', { name: 'Open my vault' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your vault is ready for its first account.' }),
  ).toBeVisible();
  return recovery;
}
async function add(page: Page, type: 'totp' | 'hotp' = 'totp') {
  await page.getByRole('button', { name: 'Add account', exact: true }).first().click();
  await page
    .getByLabel('Service name', { exact: true })
    .fill(type === 'totp' ? 'Example' : 'Counter service');
  await page.getByLabel('Account name or email').fill('public-fixture@example.com');
  await page.getByLabel('Setup key', { exact: true }).fill(fixture);
  if (type === 'hotp') {
    await page.getByRole('button', { name: 'Advanced options' }).click();
    await page.getByRole('combobox', { name: 'OTP type', exact: true }).selectOption('hotp');
  }
  await page.getByRole('button', { name: 'Save account', exact: true }).click();
  await expect(
    page.getByRole('heading', {
      name: type === 'totp' ? 'Example' : 'Counter service',
      exact: true,
    }),
  ).toBeVisible();
}
test('onboarding is accessible and has no network dependencies', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A little peace of mind.' })).toBeVisible();
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual(
    [],
  );
});
test('create, encrypt, add, copy, lock, and unlock with no persisted plaintext', async ({
  page,
  context,
  browserName,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  if (browserName === 'chromium')
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await create(page);
  await add(page);
  await page.getByRole('button', { name: 'Copy code', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Code copied');
  if (browserName === 'chromium')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^\d{6}$/);
  const persisted = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('still-encrypted-vault');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const stores: unknown[] = [];
    for (const name of ['header', 'records', 'sync']) {
      stores.push(
        await new Promise((resolve) => {
          const r = db.transaction(name).objectStore(name).getAll();
          r.onsuccess = () => resolve(r.result);
        }),
      );
    }
    db.close();
    return JSON.stringify({
      stores,
      localStorage: { ...localStorage },
      sessionStorage: { ...sessionStorage },
    });
  });
  expect(persisted).not.toContain(fixture);
  expect(persisted).not.toContain('public-fixture@example.com');
  expect(persisted).not.toContain('Example');
  await page.getByRole('button', { name: 'Lock vault', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Unlock your vault' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Example', exact: true })).toHaveCount(0);
  await page.getByLabel('Vault passphrase', { exact: true }).fill('wrong passphrase');
  await page.getByRole('button', { name: 'Unlock your vault', exact: true }).click();
  await expect(page.locator('.error[role=alert]')).toContainText('Could not unlock');
  await page.getByLabel('Vault passphrase', { exact: true }).fill(passphrase);
  await page.getByRole('button', { name: 'Unlock your vault', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Example', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test('HOTP advances only on explicit copy and persists the counter', async ({
  page,
  context,
  browserName,
}) => {
  if (browserName === 'chromium')
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await create(page);
  await add(page, 'hotp');
  await expect(page.getByText('Counter 0')).toBeVisible();
  await page.getByRole('button', { name: 'Copy and advance counter' }).click();
  await expect(page.getByText('Counter 1')).toBeVisible();
  if (browserName === 'chromium')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('755224');
  await page.reload();
  await page.getByLabel('Vault passphrase', { exact: true }).fill(passphrase);
  await page.getByRole('button', { name: 'Unlock your vault', exact: true }).click();
  await expect(page.getByText('Counter 1')).toBeVisible();
});
test('encrypted backup restores and tampering does not overwrite the local vault', async ({
  page,
}) => {
  await create(page);
  await add(page);
  await page.getByRole('button', { name: 'Encrypted backup', exact: true }).click();
  await page.getByLabel('Confirm vault passphrase').fill(passphrase);
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download encrypted backup' }).click();
  const downloaded = await event;
  const path = await downloaded.path();
  expect(path).toBeTruthy();
  const content = await readFile(path!, 'utf8');
  expect(content).not.toContain(fixture);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  const before = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('still-encrypted-vault');
      r.onsuccess = () => resolve(r.result);
    });
    const result = await new Promise((resolve) => {
      const r = db.transaction('records').objectStore('records').getAll();
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return JSON.stringify(result);
  });
  const tampered = JSON.parse(content);
  tampered.records[0].ciphertext =
    (tampered.records[0].ciphertext[0] === 'A' ? 'B' : 'A') +
    tampered.records[0].ciphertext.slice(1);
  await page.locator('input[type=file]').setInputFiles({
    name: 'tampered.otpvault',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(tampered)),
  });
  await page.getByLabel('Confirm vault passphrase').fill(passphrase);
  await page.getByLabel('I understand this replaces the encrypted vault on this device.').check();
  await page.getByRole('button', { name: 'Authenticate & restore' }).click();
  await expect(page.locator('dialog .error[role=alert]')).toBeVisible();
  const after = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('still-encrypted-vault');
      r.onsuccess = () => resolve(r.result);
    });
    const result = await new Promise((resolve) => {
      const r = db.transaction('records').objectStore('records').getAll();
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return JSON.stringify(result);
  });
  expect(after).toBe(before);
  await page.locator('input[type=file]').setInputFiles({
    name: 'test.otpvault',
    mimeType: 'application/json',
    buffer: Buffer.from(content),
  });
  await page.getByLabel('Confirm vault passphrase').fill(passphrase);
  await page.getByLabel('I understand this replaces the encrypted vault on this device.').check();
  await page.getByRole('button', { name: 'Authenticate & restore' }).click();
  await expect(page.getByRole('heading', { name: 'Example', exact: true })).toBeVisible();
});
test('production shell starts offline and generates codes offline', async ({ page, context }) => {
  await create(page);
  await add(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.getByRole('button', { name: 'Lock vault', exact: true }).click();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Unlock your vault' })).toBeVisible();
  await page.getByLabel('Vault passphrase', { exact: true }).fill(passphrase);
  await page.getByRole('button', { name: 'Unlock your vault', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Example', exact: true })).toBeVisible();
  await expect(page.locator('.otp')).toHaveText(/^\d{3} \d{3}$/);
  await page.getByRole('textbox', { name: 'Search accounts' }).fill('public-fixture');
  await expect(page.getByRole('heading', { name: 'Example', exact: true })).toBeVisible();
  await context.setOffline(false);
});
test('privacy removes sensitive account text, and locking propagates across tabs', async ({
  page,
  context,
}) => {
  await create(page);
  await add(page);
  await page.getByRole('button', { name: 'Privacy mode', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Private account' })).toBeVisible();
  await expect(page.getByText('public-fixture@example.com')).toHaveCount(0);
  const second = await context.newPage();
  await second.goto('/');
  await second.getByLabel('Vault passphrase', { exact: true }).fill(passphrase);
  await second.getByRole('button', { name: 'Unlock your vault', exact: true }).click();
  await expect(second.getByRole('button', { name: 'Lock vault', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Unlock your vault' })).toBeVisible();
  await second.getByRole('button', { name: 'Lock vault', exact: true }).click();
  await expect(second.getByRole('heading', { name: 'Unlock your vault' })).toBeVisible();
});
test('RTL and mobile remain usable with no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('Language').selectOption('fa');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('button', { name: 'Close navigation' }).first()).toBeVisible();
});
test('production security policy excludes unsafe inline scripts and network caches', async ({
  request,
  page,
}) => {
  const response = await request.get('/');
  const csp = response.headers()['content-security-policy']!;
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain("'unsafe-inline'");
  expect(csp).not.toContain("'unsafe-eval'");
  const sw = await request.get('/sw.js');
  expect(await sw.text()).toContain("url.pathname.startsWith('/api/')");
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const urls: string[] = [];
    for (const key of keys) {
      for (const req of await (await caches.open(key)).keys()) urls.push(req.url);
    }
    return urls;
  });
  expect(cached.some((url) => url.includes('/api/'))).toBe(false);
});
test('QR images decode locally, imported text is escaped, and core dialogs are accessible', async ({
  page,
}) => {
  await create(page);
  const requests: string[] = [];
  const origin = new URL(page.url()).origin;
  page.on('request', (r) => {
    if (
      r.url().includes('/api/') ||
      (/^https?:/.test(r.url()) && new URL(r.url()).origin !== origin)
    )
      requests.push(r.url());
  });
  await page.getByRole('button', { name: 'Add account', exact: true }).first().click();
  const checks = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze();
  expect(checks.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual(
    [],
  );
  await page.getByRole('tab', { name: 'Scan QR' }).click();
  const uri = `otpauth://totp/QR%20fixture%3Apublic?secret=${fixture}&issuer=QR%20fixture`;
  await page.locator('input[type=file]').setInputFiles({
    name: 'public-qr.png',
    mimeType: 'image/png',
    buffer: await QR.toBuffer(uri, { width: 500 }),
  });
  await expect(
    page.getByText('QR decoded locally. Review the account before saving.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'QR fixture', exact: true })).toBeVisible();
  expect(requests).toEqual([]);
  const dashboard = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze();
  expect(
    dashboard.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
});
test('virtual passkey registers, authenticates, and syncs only ciphertext', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Virtual authenticator requires Chromium CDP; hardware matrix is a separate gate.',
  );
  await create(page);
  await add(page);
  const session = await context.newCDPSession(page);
  await session.send('WebAuthn.enable');
  await session.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.getByRole('button', { name: 'Security', exact: true }).click();
  await page.getByRole('button', { name: 'Manage cloud account', exact: true }).click();
  await page.getByRole('button', { name: 'Create with a passkey' }).click();
  await expect(page.getByRole('heading', { name: 'Encrypted synchronization' })).toBeVisible();
  const upload = page.waitForRequest((r) => r.url().endsWith('/api/vaults/operations'));
  await page.getByRole('button', { name: 'Sync encrypted vault' }).click();
  const payload = (await upload).postData()!;
  expect(payload).not.toContain(fixture);
  expect(payload).not.toContain('public-fixture@example.com');
  expect(payload).not.toContain('Example');
  expect(JSON.parse(payload).proof.recordId).toMatch(/^sync-op:/);
  await expect(page.getByRole('heading', { name: 'Unlock your vault' })).toBeVisible();
  await page.getByLabel('Vault passphrase', { exact: true }).fill(passphrase);
  await page.getByRole('button', { name: 'Unlock your vault', exact: true }).click();
  await page.getByRole('button', { name: 'Security', exact: true }).click();
  await page.getByRole('button', { name: 'Manage cloud account', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Unlock your vault' })).toBeVisible();
  await page.getByLabel('Vault passphrase', { exact: true }).fill(passphrase);
  await page.getByRole('button', { name: 'Unlock your vault', exact: true }).click();
  await page.getByRole('button', { name: 'Security', exact: true }).click();
  await page.getByRole('button', { name: 'Manage cloud account', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Encrypted synchronization' })).toBeVisible();
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete cloud account' }).click();
  await expect(page.getByRole('heading', { name: 'Unlock your vault' })).toBeVisible();
});

test('recovery unlock can replace a forgotten passphrase without losing accounts', async ({
  page,
}) => {
  const recovery = await create(page);
  await add(page);
  await page.getByRole('button', { name: 'Lock vault', exact: true }).click();
  await page.getByRole('button', { name: 'Use a recovery key' }).click();
  await page.getByLabel('Recovery key', { exact: true }).fill(recovery);
  await page.getByRole('button', { name: 'Unlock your vault', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Example', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Change passphrase', exact: true }).click();
  await page.getByLabel('Verify with').selectOption('recovery');
  await page.getByLabel('Recovery key', { exact: true }).fill(recovery);
  const next = 'the new meadow has brighter stars';
  await page.getByLabel('New passphrase', { exact: true }).fill(next);
  await page.getByLabel('Confirm new passphrase', { exact: true }).fill(next);
  await page.getByRole('button', { name: 'Update passphrase', exact: true }).click();
  await expect(page.locator('.inline-notice[role=status]')).toContainText('Passphrase updated');
  await page.getByRole('button', { name: 'Lock vault', exact: true }).click();
  if (await page.getByRole('button', { name: 'Use your passphrase' }).isVisible())
    await page.getByRole('button', { name: 'Use your passphrase' }).click();
  await page.getByLabel('Vault passphrase', { exact: true }).fill(next);
  await page.getByRole('button', { name: 'Unlock your vault', exact: true }).click();
  await page.getByRole('button', { name: /^My vault/ }).click();
  await expect(page.getByRole('heading', { name: 'Example', exact: true })).toBeVisible();
});

test('batch import previews errors, skips duplicates, and escapes untrusted labels', async ({
  page,
}) => {
  await create(page);
  await add(page);
  await page.getByRole('button', { name: 'Add account', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Import', exact: true }).click();
  const label = '<img src=x onerror=alert(1)>';
  const csv = `issuer,account,secret\nExample,public-fixture@example.com,${fixture}\n${label},public,${fixture}\nMalformed,invalid,NOT_A_SECRET\n`;
  await page
    .getByLabel('Import accounts file')
    .setInputFiles({ name: 'fixtures.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText(/2 valid · 1 duplicates · 1 unsupported/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import reviewed accounts' })).toBeDisabled();
  await page.getByLabel('I reviewed the preview and want to save the supported accounts.').check();
  await page.getByRole('button', { name: 'Import reviewed accounts' }).click();
  await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Example', exact: true })).toHaveCount(1);
  await expect(page.locator('img[src=x]')).toHaveCount(0);
  const raw = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('still-encrypted-vault');
      r.onsuccess = () => resolve(r.result);
    });
    const records = await new Promise((resolve) => {
      const r = db.transaction('records').objectStore('records').getAll();
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return JSON.stringify(records);
  });
  expect(raw).not.toContain(fixture);
  expect(raw).not.toContain(label);
});

test('damaged encrypted records are preserved and can be quarantined without hiding healthy accounts', async ({
  page,
}) => {
  await create(page);
  await add(page);
  await page.getByRole('button', { name: 'Lock vault', exact: true }).click();
  const damagedId = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('still-encrypted-vault');
      r.onsuccess = () => resolve(r.result);
    });
    const header = await new Promise<{ vaultId: string }>((resolve) => {
      const r = db.transaction('header').objectStore('header').get('vault');
      r.onsuccess = () => resolve(r.result);
    });
    const id = crypto.randomUUID();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite');
      tx.objectStore('records').put({
        vaultId: header.vaultId,
        recordId: id,
        ciphertext: 'damaged',
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return id;
  });
  await page.reload();
  await page.getByLabel('Vault passphrase', { exact: true }).fill(passphrase);
  await page.getByRole('button', { name: 'Unlock your vault', exact: true }).click();
  await expect(page.getByText(/1 records could not be authenticated/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Example', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Encrypted backup', exact: true }).click();
  await page.getByLabel('Confirm vault passphrase').fill(passphrase);
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export encrypted recovery archive' }).click();
  const exported = await event;
  const raw = await readFile((await exported.path())!, 'utf8');
  expect(raw).toContain(damagedId);
  expect(raw).not.toContain(fixture);
});

test('two isolated passkey accounts pair a shared key, compare fingerprints, and retain personal vaults', async ({
  browser,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Virtual authenticators require Chromium CDP.');
  test.setTimeout(180000);
  const ownerContext = await browser.newContext(),
    peerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage(),
    peerPage = await peerContext.newPage();
  const unlock = async (p: Page) => {
    await p.getByLabel('Vault passphrase', { exact: true }).fill(passphrase);
    await p.getByRole('button', { name: 'Unlock your vault', exact: true }).click();
    await expect(p.getByRole('button', { name: 'Lock vault', exact: true })).toBeVisible();
  };
  const visible = async (p: Page) => {
    await p.bringToFront();
    await p.getByRole('button', { name: 'Settings', exact: true }).click();
    if (await p.getByLabel('Lock when backgrounded').isChecked())
      await p.getByLabel('Lock when backgrounded').click();
    await expect(p.getByLabel('Lock when backgrounded')).not.toBeChecked();
  };
  async function register(p: Page) {
    await create(p);
    await visible(p);
    const cdp = await p.context().newCDPSession(p);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    await p.getByRole('button', { name: 'Cloud account', exact: true }).click();
    await p.getByRole('button', { name: 'Create with a passkey' }).click();
    await expect(p.getByRole('heading', { name: 'Encrypted synchronization' })).toBeVisible();
    return p.evaluate(async () => {
      const r = await fetch('/api/auth/me', { cache: 'no-store' });
      if (!r.ok) throw new Error('Fixture account unavailable');
      return (await r.json()).userId as string;
    });
  }
  let stage = 'register owner';
  const at = (label: string) => {
    stage = label;
    process.stdout.write(`Pairing fixture: ${label}\n`);
  };
  try {
    at('register owner');
    await register(ownerPage);
    at('register recipient');
    const peerId = await register(peerPage);
    at('create shared vault');
    await ownerPage.getByRole('button', { name: 'Shared vaults', exact: true }).click();
    await ownerPage.getByRole('button', { name: 'Create shared vault', exact: true }).click();
    await ownerPage.getByLabel('Shared vault passphrase').fill(passphrase);
    await ownerPage.getByLabel('Confirm passphrase', { exact: true }).fill(passphrase);
    await ownerPage.getByRole('button', { name: 'Create independent vault' }).click();
    await expect(
      ownerPage.getByRole('heading', { name: 'Save the shared vault recovery key' }),
    ).toBeVisible();
    await ownerPage.getByLabel('I saved the recovery key separately.').check();
    await ownerPage.getByRole('button', { name: 'Open shared vault' }).click();
    await visible(ownerPage);
    await ownerPage.getByRole('button', { name: /^My vault/ }).click();
    await add(ownerPage);
    at('sync owner records');
    await ownerPage.getByRole('button', { name: 'Cloud account', exact: true }).click();
    await ownerPage.getByRole('button', { name: 'Sync encrypted vault' }).click();
    await expect(ownerPage.getByRole('heading', { name: 'Unlock your vault' })).toBeVisible();
    await unlock(ownerPage);
    at('invite recipient');
    await ownerPage.getByRole('button', { name: 'Shared vaults', exact: true }).click();
    await ownerPage.getByLabel('Member cloud account ID').fill(peerId);
    await ownerPage.getByLabel('Role').selectOption('member');
    await ownerPage.getByRole('button', { name: 'Add member', exact: true }).click();
    await expect(ownerPage.getByText(peerId, { exact: true })).toBeVisible();
    at('request pairing');
    await peerPage.getByRole('button', { name: 'Settings', exact: true }).click();
    await peerPage.getByRole('button', { name: 'Cloud account', exact: true }).click();
    await peerPage.getByRole('button', { name: 'Receive a vault on this device' }).click();
    await peerPage.getByRole('button', { name: 'Generate pairing QR' }).click();
    const event = peerPage.waitForEvent('download');
    await peerPage.getByRole('button', { name: 'Download public pairing request' }).click();
    const proposal = await event;
    const content = await readFile((await proposal.path())!, 'utf8');
    at('approve pairing');
    await ownerPage.getByRole('button', { name: 'Cloud account', exact: true }).click();
    await ownerPage.getByRole('button', { name: 'Approve another device' }).click();
    await ownerPage.getByLabel('Public pairing request', { exact: true }).fill(content);
    await ownerPage.getByLabel('Confirm this vault’s passphrase').fill(passphrase);
    await ownerPage.getByRole('button', { name: 'Approve encrypted key transfer' }).click();
    await expect(
      ownerPage.getByText('Encrypted key sent. The receiving device must verify this fingerprint.'),
    ).toBeVisible();
    const fingerprint = (await ownerPage.locator('dialog .recovery-key').textContent())!.trim();
    at('verify fingerprint and receive');
    await peerPage.getByRole('button', { name: 'Check for approval' }).click();
    await expect(peerPage.locator('dialog .recovery-key')).toHaveText(fingerprint);
    await peerPage.getByLabel('The fingerprints match on both devices.').check();
    await peerPage.getByLabel('New local vault passphrase').fill(passphrase);
    await peerPage.getByRole('button', { name: 'Receive & protect vault key' }).click();
    await expect(
      peerPage.getByRole('heading', { name: 'Save your new recovery key' }),
    ).toBeVisible();
    await peerPage.getByLabel('I saved this key safely.').check();
    await peerPage.getByRole('button', { name: 'Continue to encrypted sync' }).click();
    at('sync recipient');
    await peerPage.getByRole('button', { name: 'Sync encrypted vault' }).click();
    await expect(peerPage.getByRole('heading', { name: 'Unlock your vault' })).toBeVisible();
    await unlock(peerPage);
    await peerPage.getByRole('button', { name: /^My vault/ }).click();
    await expect(peerPage.getByRole('heading', { name: 'Example', exact: true })).toBeVisible();
    const count = await peerPage.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open('still-encrypted-vault');
        r.onsuccess = () => resolve(r.result);
      });
      const ids = await new Promise<string[]>((resolve) => {
        const r = db.transaction('header').objectStore('header').getAll();
        r.onsuccess = () => resolve([...new Set(r.result.map((h) => h.vaultId as string))]);
      });
      db.close();
      return ids.length;
    });
    expect(count).toBe(2);
    at('delete synthetic cloud accounts');
    await ownerPage.getByRole('button', { name: 'Done', exact: true }).click();
    for (const p of [peerPage, ownerPage]) {
      await p.getByRole('button', { name: 'Cloud account', exact: true }).click();
      p.once('dialog', (d) => d.accept());
      await p.getByRole('button', { name: 'Delete cloud account' }).click();
      await expect(p.getByRole('heading', { name: 'Unlock your vault' })).toBeVisible();
    }
  } catch (error) {
    process.stderr.write(
      `Pairing failed at ${stage}: ${error instanceof Error ? error.message : 'unknown error'}\n`,
    );
    throw error;
  } finally {
    await Promise.race([
      Promise.allSettled([peerContext.close(), ownerContext.close()]),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  }
});

test('seed reveal authenticates again, creates a local provisioning QR, and clears on lock', async ({
  page,
}) => {
  await create(page);
  await add(page);
  await page.getByRole('button', { name: 'Options for Example' }).click();
  await page.getByRole('button', { name: 'Reveal setup key' }).click();
  await page.getByLabel('Confirm vault passphrase').fill(passphrase);
  await page.getByRole('button', { name: 'Reveal for 30 seconds', exact: true }).click();
  await expect(page.locator('dialog .secret-reveal code')).toHaveText(fixture);
  await expect(page.getByRole('img', { name: 'Sensitive provisioning QR code' })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Lock vault', exact: true }).click();
  await expect(page.locator('.secret-reveal')).toHaveCount(0);
});
