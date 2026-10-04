import { describe, expect, it, beforeAll } from 'vitest';
import {
  createVault,
  unlockVault,
  openJson,
  sealJson,
  seal,
  open,
  random,
  importAes,
  makeBackup,
  validateBackup,
  formatRecovery,
  parseRecovery,
  changePassphrase,
  encode,
  type VaultHeader,
  type Envelope,
} from '../../packages/core/src/index';
let key: CryptoKey, header: VaultHeader, recovery: string, envelope: Envelope;
const passphrase = 'a calm meadow under silver stars';
beforeAll(async () => {
  const created = await createVault(passphrase);
  ({ key, header, recovery } = created);
  envelope = await sealJson(key, header.vaultId, header.keyId, crypto.randomUUID(), {
    secret: 'private test secret',
    issuer: 'private issuer',
  });
});
describe('encrypted vault envelopes', () => {
  it('keeps imported AES keys non-extractable', () => expect(key.extractable).toBe(false));
  it('round-trips authenticated encrypted records', async () =>
    expect(await openJson(key, envelope)).toEqual({
      secret: 'private test secret',
      issuer: 'private issuer',
    }));
  it('persists no plaintext in an envelope', () =>
    expect(JSON.stringify(envelope)).not.toContain('private'));
  it('rejects the wrong key', async () =>
    expect(openJson(await importAes(random(32)), envelope)).rejects.toThrow());
  it('binds the vault and record identifiers', async () => {
    await expect(openJson(key, { ...envelope, vaultId: crypto.randomUUID() })).rejects.toThrow();
    await expect(openJson(key, { ...envelope, recordId: 'other-record' })).rejects.toThrow();
  });
  it('rejects modified ciphertext, nonce, versions, and truncated input', async () => {
    for (const modified of [
      { ...envelope, nonce: encode(random(12)) },
      { ...envelope, ciphertext: envelope.ciphertext.slice(0, -2) },
      { ...envelope, version: 2 },
      { ...envelope, keyId: crypto.randomUUID() },
    ])
      await expect(openJson(key, modified as Envelope)).rejects.toThrow();
  });
  it('uses fresh 96-bit random nonces', async () => {
    const nonces = new Set();
    for (let i = 0; i < 100; i++)
      nonces.add(
        (await seal(key, header.vaultId, header.keyId, 'nonce-test', new Uint8Array([1]))).nonce,
      );
    expect(nonces.size).toBe(100);
  });
  it('rejects short encryption keys', async () => expect(importAes(random(16))).rejects.toThrow());
  it('rejects wrong passphrases', async () =>
    expect(unlockVault(header, 'the wrong passphrase')).rejects.toThrow());
  it('unlocks with an independent recovery key', async () =>
    expect(
      await openJson(await unlockVault(header, recovery, 'recovery'), envelope),
    ).toHaveProperty('issuer', 'private issuer'));
  it('detects recovery transcription errors', async () => {
    const formatted = await formatRecovery(random(32));
    expect((await parseRecovery(formatted)).length).toBe(32);
    await expect(
      parseRecovery(formatted.replace(/^./, formatted[0] === 'A' ? 'B' : 'A')),
    ).rejects.toThrow();
  });
  it('rejects hostile KDF parameters before doing expensive work', async () =>
    expect(
      unlockVault({ ...header, kdf: { ...header.kdf, memory: 2 ** 31 } }, passphrase),
    ).rejects.toThrow());
  it('authenticates complete backups, including record set and header', async () => {
    const backup = await makeBackup(key, header, [envelope]);
    const restored = await validateBackup(JSON.parse(JSON.stringify(backup)), recovery, 'recovery');
    expect(await openJson(restored.key, restored.backup.records[0]!)).toHaveProperty(
      'secret',
      'private test secret',
    );
    await expect(validateBackup({ ...backup, records: [] }, recovery, 'recovery')).rejects.toThrow(
      'integrity',
    );
    await expect(
      validateBackup({ ...backup, exportedAt: '2020-01-01T00:00:00.000Z' }, recovery, 'recovery'),
    ).rejects.toThrow('integrity');
  });
  it('changes passphrases without changing the vault key', async () => {
    const next = await changePassphrase(
      header,
      passphrase,
      'passphrase',
      'a different long and strong phrase',
    );
    expect(
      await openJson(await unlockVault(next, 'a different long and strong phrase'), envelope),
    ).toHaveProperty('issuer');
    await expect(unlockVault(next, passphrase)).rejects.toThrow();
    expect(await openJson(await unlockVault(next, recovery, 'recovery'), envelope)).toHaveProperty(
      'issuer',
    );
  });
  it('authenticates raw buffers', async () =>
    expect(
      await open(
        key,
        await seal(key, header.vaultId, header.keyId, 'bytes', new Uint8Array([1, 2, 3])),
      ),
    ).toEqual(new Uint8Array([1, 2, 3])));
});
