import { describe, expect, it } from 'vitest';
import {
  can,
  checkRevision,
  deviceKeys,
  publicDeviceKey,
  pairingKey,
  wrapForDevice,
  unwrapFromDevice,
  random,
  importAes,
  sealJson,
  openJson,
  authenticateOperation,
  verifyOperation,
  pairingFingerprint,
  type Pairing,
} from '../../packages/core/src/index';
describe('roles and sync invariants', () => {
  it('authenticates sync payloads, deletion markers, identities, and base revisions', async () => {
    const key = await importAes(random(32)),
      vaultId = crypto.randomUUID(),
      keyId = crypto.randomUUID(),
      recordId = crypto.randomUUID();
    const envelope = await sealJson(key, vaultId, keyId, recordId, { fixture: true });
    const operation = await authenticateOperation(key, keyId, {
      operationId: crypto.randomUUID(),
      vaultId,
      recordId,
      envelope,
      baseRevision: 8,
      tombstone: false,
    });
    await expect(verifyOperation(key, keyId, operation)).resolves.toBeUndefined();
    for (const changes of [
      { envelope: null, tombstone: true },
      { baseRevision: 0 },
      { recordId: crypto.randomUUID() },
      { operationId: crypto.randomUUID() },
      { envelope: { ...envelope, nonce: 'AAAAAAAAAAAAAAAA' } },
    ]) {
      await expect(verifyOperation(key, keyId, { ...operation, ...changes })).rejects.toThrow();
    }
    const deletion = await authenticateOperation(key, keyId, {
      operationId: crypto.randomUUID(),
      vaultId,
      recordId,
      envelope: null,
      baseRevision: 9,
      tombstone: true,
    });
    await expect(verifyOperation(key, keyId, deletion)).resolves.toBeUndefined();
    await expect(verifyOperation(await importAes(random(32)), keyId, deletion)).rejects.toThrow();
  });
  it('enforces role capabilities', () => {
    expect(can('viewer', 'read')).toBe(true);
    expect(can('viewer', 'write')).toBe(false);
    expect(can('member', 'invite')).toBe(false);
    expect(can('admin', 'delete')).toBe(false);
    expect(can('owner', 'delete')).toBe(true);
  });
  it('detects server rollback', () => {
    expect(() => checkRevision(12, 11)).toThrow();
    expect(() => checkRevision(12, 12)).not.toThrow();
    expect(() => checkRevision(1, NaN)).toThrow();
  });
  it('wraps keys to a recipient using domain-separated ECDH/HKDF', async () => {
    const sender = await deviceKeys(),
      recipient = await deviceKeys();
    const senderPublic = await publicDeviceKey(sender),
      recipientPublic = await publicDeviceKey(recipient);
    const context: Pairing = {
      version: 1,
      transactionId: crypto.randomUUID(),
      vaultId: crypto.randomUUID(),
      senderId: crypto.randomUUID(),
      recipientId: crypto.randomUUID(),
      epoch: 1,
      expiresAt: Date.now() + 120000,
      publicKey: { kty: 'EC', crv: 'P-256', x: recipientPublic.x!, y: recipientPublic.y! },
    };
    const kekA = await pairingKey(sender.privateKey, recipientPublic, context),
      kekB = await pairingKey(recipient.privateKey, senderPublic, context),
      raw = random(32),
      vaultKey = await importAes(raw);
    const fingerprint = await pairingFingerprint(senderPublic, recipientPublic, context);
    expect(fingerprint).toMatch(/^[0-9a-f]{4}( [0-9a-f]{4}){3}$/);
    expect(
      await pairingFingerprint(senderPublic, recipientPublic, { ...context, epoch: 2 }),
    ).not.toBe(fingerprint);
    const wrapped = await wrapForDevice(kekA, raw, context),
      restored = await unwrapFromDevice(kekB, wrapped, context);
    const record = await sealJson(vaultKey, context.vaultId, crypto.randomUUID(), 'example', {
      message: 'private',
    });
    expect(await openJson(restored, record)).toEqual({ message: 'private' });
    const attacker = await deviceKeys();
    await expect(
      unwrapFromDevice(
        await pairingKey(attacker.privateKey, senderPublic, context),
        wrapped,
        context,
      ),
    ).rejects.toThrow();
    await expect(unwrapFromDevice(kekB, wrapped, { ...context, epoch: 2 })).rejects.toThrow();
    await expect(
      pairingKey(sender.privateKey, recipientPublic, { ...context, expiresAt: Date.now() - 1 }),
    ).rejects.toThrow();
    raw.fill(0);
  });
});
