import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
await page.goto('http://localhost:3000');
await page.getByRole('heading', { name: 'A little peace of mind.' }).waitFor();
await page.screenshot({ path: 'artifacts/onboarding-desktop.png', fullPage: true });
await page
  .getByLabel('Vault passphrase', { exact: true })
  .fill('public visual review fixture passphrase');
await page
  .getByLabel('Confirm passphrase', { exact: true })
  .fill('public visual review fixture passphrase');
await page.getByRole('button', { name: 'Create secure vault' }).click();
await page.getByLabel('I saved my recovery key').check();
await page.getByRole('button', { name: 'Open my vault' }).click();
for (const [issuer, color, folder] of [
  ['GitHub', 'slate', 'Work'],
  ['Google', 'blue', 'Personal'],
  ['Linear', 'violet', 'Work'],
  ['Dropbox', 'blue', 'Personal'],
  ['Figma', 'rose', 'Work'],
  ['Amazon', 'orange', 'Personal'],
]) {
  await page.getByRole('button', { name: 'Add account', exact: true }).first().click();
  await page.getByLabel('Service name', { exact: true }).fill(issuer);
  await page.getByLabel('Account name or email').fill('Public test fixture · not a real account');
  await page.getByLabel('Setup key', { exact: true }).fill('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  await page.getByRole('combobox', { name: 'Color', exact: true }).selectOption(color);
  await page.getByRole('combobox', { name: 'Folder', exact: true }).selectOption(folder);
  await page.getByRole('button', { name: 'Save account', exact: true }).click();
  await page.getByRole('heading', { name: issuer, exact: true }).waitFor();
}
await page.screenshot({ path: 'artifacts/vault-desktop.png', fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForFunction(
  () =>
    globalThis.getComputedStyle(globalThis.document.querySelector('.sidebar')).visibility ===
    'hidden',
);
await page.screenshot({ path: 'artifacts/vault-mobile.png', fullPage: true });
await context.close();
await browser.close();
process.stdout.write('Visual review images generated from public fixtures.\n');
