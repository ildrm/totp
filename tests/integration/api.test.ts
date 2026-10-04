import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import pg from 'pg';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import {
  sealJson,
  importAes,
  random,
  parseUri,
  totp,
  hotp,
  deviceKeys,
  publicDeviceKey,
  pairingKey,
  wrapForDevice,
  authenticateOperation,
  verifyOperation,
  type SyncInput,
  type Envelope,
  type Pairing,
} from '../../packages/core/src/index';
const enabled = !!process.env.DATABASE_URL;
const base = process.env.API_TEST_URL ?? 'http://127.0.0.1:4000/api';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
type Identity = { userId: string; deviceId: string; bearer: string };
const owner: Identity = {
    userId: randomUUID(),
    deviceId: randomUUID(),
    bearer: randomBytes(32).toString('base64url'),
  },
  stranger: Identity = {
    userId: randomUUID(),
    deviceId: randomUUID(),
    bearer: randomBytes(32).toString('base64url'),
  };
const vaultId = randomUUID(),
  keyId = randomUUID(),
  recordId = randomUUID();
let envelope: Envelope, apiKey: string, applicationId: string, fixtureKey: CryptoKey;
const sign = (input: SyncInput) =>
  authenticateOperation(fixtureKey, input.envelope?.keyId ?? keyId, input);
async function request(
  path: string,
  body?: unknown,
  identity: Identity = owner,
  method?: string,
  bearer?: string,
) {
  return fetch(`${base}/${path}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: {
      Origin: process.env.APP_ORIGIN ?? 'http://localhost:3000',
      'Content-Type': 'application/json',
      Cookie: `__Host-still-session=${identity.bearer}`,
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
describe.skipIf(!enabled)('real PostgreSQL and API security', () => {
  beforeAll(async () => {
    expect((await request('health/ready')).status).toBe(200);
    for (const id of [owner, stranger]) {
      await pool.query('INSERT INTO users(id) VALUES($1)', [id.userId]);
      await pool.query('INSERT INTO devices(id,user_id,name) VALUES($1,$2,$3)', [
        id.deviceId,
        id.userId,
        'Integration fixture',
      ]);
      await pool.query(
        "INSERT INTO sessions(token_hash,user_id,device_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
        [sha(id.bearer), id.userId, id.deviceId],
      );
    }
    fixtureKey = await importAes(random(32));
    envelope = await sealJson(fixtureKey, vaultId, keyId, recordId, {
      secret: 'public test fixture',
      issuer: 'fixture issuer',
    });
    expect((await request('vaults', { id: vaultId, keyId, shared: false })).status).toBe(201);
  });
  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [
      [owner.userId, stranger.userId],
    ]);
    await pool.end();
  });
  it('rejects unauthenticated access', async () =>
    expect((await fetch(`${base}/vaults`)).status).toBe(401));
  it('blocks cross-origin writes', async () => {
    const result = await fetch(`${base}/vaults`, {
      method: 'POST',
      headers: {
        Origin: 'https://attacker.example',
        'Content-Type': 'application/json',
        Cookie: `__Host-still-session=${owner.bearer}`,
      },
      body: JSON.stringify({ id: randomUUID(), keyId, shared: false }),
    });
    expect(result.status).toBe(403);
  });
  it('isolates vault ownership and prevents IDOR', async () => {
    expect((await request(`vaults/${vaultId}/operations`, undefined, stranger)).status).toBe(403);
    expect((await request('vaults', { id: vaultId, keyId, shared: false }, stranger)).status).toBe(
      403,
    );
  });
  it('stores ciphertext only and retries operations idempotently', async () => {
    const op = await sign({
      operationId: randomUUID(),
      vaultId,
      recordId,
      baseRevision: 0,
      envelope,
      tombstone: false,
    });
    const first = await (await request('vaults/operations', op)).json();
    expect(first).toEqual({ revision: 1, conflict: false });
    expect(await (await request('vaults/operations', op)).json()).toEqual(first);
    expect(
      (await request('vaults/operations', { ...op, tombstone: true, envelope: null })).status,
    ).toBe(409);
    const stored = (
      await pool.query('SELECT envelope FROM sync_operations WHERE operation_id=$1', [
        op.operationId,
      ])
    ).rows[0].envelope;
    expect(JSON.stringify(stored)).not.toContain('fixture issuer');
    expect(JSON.stringify(stored)).not.toContain('public test fixture');
  });
  it('preserves concurrent conflicting versions instead of last-write-wins', async () => {
    const writes = Array.from({ length: 12 }, async () =>
      request(
        'vaults/operations',
        await sign({
          operationId: randomUUID(),
          vaultId,
          recordId,
          baseRevision: 1,
          envelope,
          tombstone: false,
        }),
      ),
    );
    const results = await Promise.all(writes);
    expect(results.every((r) => r.status === 201)).toBe(true);
    const bodies = await Promise.all(results.map((r) => r.json()));
    expect(bodies.filter((r) => !r.conflict)).toHaveLength(1);
    expect(bodies.filter((r) => r.conflict)).toHaveLength(11);
    const history = await (await request(`vaults/${vaultId}/operations?after=0`)).json();
    expect(history.operations).toHaveLength(13);
    expect(history.revision).toBe(13);
  });
  it('rejects mismatched envelope context and future revisions', async () => {
    expect(
      (
        await request('vaults/operations', {
          operationId: randomUUID(),
          vaultId,
          recordId: randomUUID(),
          baseRevision: 0,
          envelope,
          tombstone: false,
          proof: await sealJson(fixtureKey, vaultId, keyId, 'sync-op:' + randomUUID(), {}),
        })
      ).status,
    ).toBe(400);
    expect((await request(`vaults/${vaultId}/operations?after=999999`)).status).toBe(409);
  });
  it('enforces team viewer and owner permissions', async () => {
    const id = randomUUID();
    expect((await request('vaults', { id, keyId: randomUUID(), shared: true })).status).toBe(201);
    expect(
      (await request(`vaults/${id}/members`, { userId: stranger.userId, role: 'viewer' })).status,
    ).toBe(201);
    expect((await request(`vaults/${id}/operations`, undefined, stranger)).status).toBe(200);
    const e = { ...envelope, vaultId: id, keyId: randomUUID() };
    expect(
      (
        await request(
          'vaults/operations',
          await sign({
            operationId: randomUUID(),
            vaultId: id,
            recordId,
            baseRevision: 0,
            envelope: e,
            tombstone: false,
          }),
          stranger,
        )
      ).status,
    ).toBe(403);
    expect((await request(`vaults/${id}`, undefined, stranger, 'DELETE')).status).toBe(403);
    expect(
      (await request(`vaults/${id}/members`, { userId: randomUUID(), role: 'member' }, stranger))
        .status,
    ).toBe(403);
  });
  it('rotates every live head, filters old epochs, and revokes removed members', async () => {
    const id = randomUUID(),
      oldId = randomUUID(),
      newId = randomUUID(),
      record = randomUUID();
    expect((await request('vaults', { id, keyId: oldId, shared: true })).status).toBe(201);
    expect(
      (await request(`vaults/${id}/members`, { userId: stranger.userId, role: 'member' })).status,
    ).toBe(201);
    const encrypted = await sealJson(fixtureKey, id, oldId, record, { fixture: 'rotation' });
    const initial = await authenticateOperation(fixtureKey, oldId, {
      operationId: randomUUID(),
      vaultId: id,
      recordId: record,
      baseRevision: 0,
      envelope: encrypted,
      tombstone: false,
    });
    expect((await request('vaults/operations', initial)).status).toBe(201);
    const newKey = await importAes(random(32));
    const next = await sealJson(newKey, id, newId, record, { fixture: 'rotation' });
    const operation = await authenticateOperation(newKey, newId, {
      operationId: randomUUID(),
      vaultId: id,
      recordId: record,
      baseRevision: 0,
      envelope: next,
      tombstone: false,
    });
    expect(
      (
        await request(`vaults/${id}/rotate`, {
          removeUserId: stranger.userId,
          newKeyId: newId,
          operations: [],
          envelopes: [],
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(`vaults/${id}/rotate`, {
          removeUserId: owner.userId,
          newKeyId: newId,
          operations: [operation],
          envelopes: [],
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(`vaults/${id}/rotate`, {
          removeUserId: stranger.userId,
          newKeyId: newId,
          operations: [operation],
          envelopes: [],
        })
      ).status,
    ).toBe(201);
    expect((await request(`vaults/${id}/operations`, undefined, stranger)).status).toBe(403);
    const history = await (await request(`vaults/${id}/operations?after=0`)).json();
    expect(history.epoch).toBe(2);
    expect(history.keyId).toBe(newId);
    expect(history.operations).toHaveLength(1);
    expect(history.operations[0].revision).toBe(2);
    await expect(verifyOperation(newKey, newId, operation)).resolves.toBeUndefined();
    expect((await request('vaults/operations', initial)).status).toBe(409);
  });
  it('stores key envelopes only and rejects pairing approval replay', async () => {
    const recipientId = randomUUID(),
      recipientBearer = randomBytes(32).toString('base64url');
    await pool.query('INSERT INTO devices(id,user_id,name) VALUES($1,$2,$3)', [
      recipientId,
      owner.userId,
      'Paired test device',
    ]);
    await pool.query(
      "INSERT INTO sessions(token_hash,user_id,device_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [sha(recipientBearer), owner.userId, recipientId],
    );
    const recipient = { userId: owner.userId, deviceId: recipientId, bearer: recipientBearer };
    const receiver = await deviceKeys(),
      sender = await deviceKeys(),
      pub = await publicDeviceKey(receiver),
      senderPub = await publicDeviceKey(sender);
    const publicKey = { kty: 'EC', crv: 'P-256', x: pub.x!, y: pub.y! };
    const proposal = await (await request('pairings', { vaultId, publicKey }, recipient)).json();
    const context: Pairing = { ...proposal, senderId: owner.deviceId, epoch: 1 };
    const kek = await pairingKey(sender.privateKey, pub, context);
    const wrapped = await wrapForDevice(kek, random(32), context);
    const payload = {
      context,
      envelope: wrapped,
      senderPublicKey: { kty: 'EC', crv: 'P-256', x: senderPub.x!, y: senderPub.y! },
    };
    expect((await request(`pairings/${proposal.transactionId}/approve`, payload)).status).toBe(201);
    expect((await request(`pairings/${proposal.transactionId}/approve`, payload)).status).toBe(409);
    expect((await request(`pairings/${proposal.transactionId}`, undefined, stranger)).status).toBe(
      403,
    );
  });
  it('makes passkey challenges one-time and rejects invalid proofs', async () => {
    const options = await request('auth/register/options', {});
    expect(options.status).toBe(201);
    const setCookie = options.headers.get('set-cookie')!;
    expect(setCookie).toContain('__Host-still-challenge=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Strict');
    const challengeCookie = setCookie.split(';')[0]!;
    const verify = () =>
      fetch(`${base}/auth/verify`, {
        method: 'POST',
        headers: {
          Origin: process.env.APP_ORIGIN!,
          'Content-Type': 'application/json',
          Cookie: challengeCookie,
        },
        body: JSON.stringify({ response: { id: 'invalid-proof' } }),
      });
    expect((await verify()).status).toBe(401);
    expect((await verify()).status).toBe(401);
  });
  it.skipIf(process.env.MFA_ENABLED !== 'true')(
    'requires possession before MFA activation and prevents concurrent TOTP replay',
    async () => {
      const application = await (
        await request('developer/applications', { name: 'Integration verifier' })
      ).json();
      applicationId = application.id;
      const key = await (
        await request(`developer/applications/${applicationId}/keys`, {
          scopes: ['enroll', 'verify'],
          days: 1,
        })
      ).json();
      apiKey = key.key;
      const enrollment = await (
        await request(
          'mfa/enrollments',
          {
            subject: randomUUID(),
            issuer: 'Public fixture',
            account: 'test-account',
            algorithm: 'SHA-256',
            digits: 8,
          },
          owner,
          undefined,
          apiKey,
        )
      ).json();
      const input = parseUri(enrollment.uri);
      const code = await totp(input);
      expect(
        (await request(`mfa/${enrollment.credentialId}/verify`, { code }, owner, undefined, apiKey))
          .status,
      ).toBe(401);
      expect(
        (
          await request(
            `mfa/${enrollment.credentialId}/confirm`,
            { code: '00000000' },
            owner,
            undefined,
            apiKey,
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await request(
            `mfa/${enrollment.credentialId}/confirm`,
            { code },
            owner,
            undefined,
            apiKey,
          )
        ).status,
      ).toBe(201);
      expect(
        (await request(`mfa/${enrollment.credentialId}/verify`, { code }, owner, undefined, apiKey))
          .status,
      ).toBe(401);
      const row = (
        await pool.query('SELECT active,envelope,last_step FROM verifier.credentials WHERE id=$1', [
          enrollment.credentialId,
        ])
      ).rows[0];
      expect(row.active).toBe(true);
      expect(JSON.stringify(row.envelope)).not.toContain(input.secret);
      await pool.query('UPDATE verifier.credentials SET last_step=-1 WHERE id=$1', [
        enrollment.credentialId,
      ]);
      // Isolate replay protection from the independent guess throttle.
      const bucket = createHmac('sha256', process.env.RATE_LIMIT_KEY!)
        .update(`mfa-guess:${applicationId}:${enrollment.credentialId}`)
        .digest('hex');
      await pool.query('DELETE FROM rate_limits WHERE bucket=$1', [bucket]);
      const race = await Promise.all([
        request(`mfa/${enrollment.credentialId}/verify`, { code }, owner, undefined, apiKey),
        request(`mfa/${enrollment.credentialId}/verify`, { code }, owner, undefined, apiKey),
      ]);
      expect(race.filter((r) => r.status === 201)).toHaveLength(1);
      expect(race.map((r) => r.status).sort()).toEqual([201, 401]);
    },
  );
  it.skipIf(process.env.MFA_ENABLED !== 'true')(
    'consumes recovery codes and HOTP counters atomically',
    async () => {
      const enrollment = await (
        await request(
          'mfa/enrollments',
          {
            subject: randomUUID(),
            issuer: 'HOTP fixture',
            account: 'test',
            type: 'hotp',
            algorithm: 'SHA-1',
            digits: 6,
          },
          owner,
          undefined,
          apiKey,
        )
      ).json();
      const input = parseUri(enrollment.uri);
      const first = await hotp(input.secret, 0n);
      expect(
        (
          await request(
            `mfa/${enrollment.credentialId}/confirm`,
            { code: first },
            owner,
            undefined,
            apiKey,
          )
        ).status,
      ).toBe(201);
      const current = await hotp(input.secret, 1n);
      const race = await Promise.all([
        request(
          `mfa/${enrollment.credentialId}/verify`,
          { code: current },
          owner,
          undefined,
          apiKey,
        ),
        request(
          `mfa/${enrollment.credentialId}/verify`,
          { code: current },
          owner,
          undefined,
          apiKey,
        ),
      ]);
      expect(race.filter((r) => r.status === 201)).toHaveLength(1);
      const codes = await (
        await request(`developer/credentials/${enrollment.credentialId}/recovery-codes`, {})
      ).json();
      const recovery = await Promise.all([
        request(
          `mfa/${enrollment.credentialId}/verify`,
          { code: codes.codes[0] },
          owner,
          undefined,
          apiKey,
        ),
        request(
          `mfa/${enrollment.credentialId}/verify`,
          { code: codes.codes[0] },
          owner,
          undefined,
          apiKey,
        ),
      ]);
      expect(recovery.filter((r) => r.status === 201)).toHaveLength(1);
    },
  );
  it.skipIf(process.env.MFA_ENABLED !== 'true')(
    'keeps the old factor active until a bound replacement proves possession',
    async () => {
      const subject = randomUUID();
      const enroll = async (extra: Record<string, unknown> = {}) =>
        (
          await request(
            'mfa/enrollments',
            {
              subject,
              issuer: 'Rotation fixture',
              account: 'public',
              type: 'hotp',
              algorithm: 'SHA-256',
              digits: 8,
              ...extra,
            },
            owner,
            undefined,
            apiKey,
          )
        ).json();
      const previous = await enroll(),
        oldInput = parseUri(previous.uri);
      expect(
        (
          await request(
            `mfa/${previous.credentialId}/confirm`,
            { code: await hotp(oldInput.secret, 0n, 'SHA-256', 8) },
            owner,
            undefined,
            apiKey,
          )
        ).status,
      ).toBe(201);
      const replacement = await enroll({ replacesCredentialId: previous.credentialId }),
        newInput = parseUri(replacement.uri);
      expect(
        (
          await request(
            `mfa/${previous.credentialId}/verify`,
            { code: await hotp(oldInput.secret, 1n, 'SHA-256', 8) },
            owner,
            undefined,
            apiKey,
          )
        ).status,
      ).toBe(201);
      const denied = await request(
        'mfa/enrollments',
        {
          subject: randomUUID(),
          issuer: 'Other',
          account: 'public',
          replacesCredentialId: previous.credentialId,
        },
        owner,
        undefined,
        apiKey,
      );
      expect(denied.status).toBe(403);
      expect(
        (
          await request(
            `mfa/${replacement.credentialId}/confirm`,
            { code: await hotp(newInput.secret, 0n, 'SHA-256', 8) },
            owner,
            undefined,
            apiKey,
          )
        ).status,
      ).toBe(201);
      expect(
        (
          await pool.query('SELECT id FROM verifier.credentials WHERE id=$1', [
            previous.credentialId,
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await request(
            `mfa/${previous.credentialId}/verify`,
            { code: await hotp(oldInput.secret, 2n, 'SHA-256', 8) },
            owner,
            undefined,
            apiKey,
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await request(
            `mfa/${replacement.credentialId}/verify`,
            { code: await hotp(newInput.secret, 1n, 'SHA-256', 8) },
            owner,
            undefined,
            apiKey,
          )
        ).status,
      ).toBe(201);
    },
  );
  it('rejects exhausted ciphertext budgets before adding a revision', async () => {
    const limited = randomUUID();
    expect((await request('vaults', { id: limited, keyId, shared: false })).status).toBe(201);
    await pool.query('UPDATE vaults SET storage_bytes=$2 WHERE id=$1', [
      limited,
      100 * 1024 * 1024,
    ]);
    const e = await sealJson(fixtureKey, limited, keyId, randomUUID(), { fixture: true });
    const op = await authenticateOperation(fixtureKey, keyId, {
      operationId: randomUUID(),
      vaultId: limited,
      recordId: e.recordId,
      baseRevision: 0,
      envelope: e,
      tombstone: false,
    });
    expect((await request('vaults/operations', op)).status).toBe(413);
    expect(
      (await pool.query('SELECT revision FROM vaults WHERE id=$1', [limited])).rows[0].revision,
    ).toBe('0');
  });
  it('revokes sessions and prevents a revoked device from syncing', async () => {
    expect((await request(`auth/devices/${stranger.deviceId}/revoke`, {}, stranger)).status).toBe(
      201,
    );
    expect((await request('auth/me', undefined, stranger)).status).toBe(401);
    expect((await request(`vaults/${vaultId}/operations`, undefined, stranger)).status).toBe(401);
  });
});
