import { z } from 'zod';
import { envelopeSchema } from './models.js';
import {
  decode,
  encode,
  importAes,
  open,
  random,
  seal,
  sealJson,
  openJson,
  digestJson,
} from './crypto.js';

export const syncInputSchema = z
  .object({
    operationId: z.uuid(),
    vaultId: z.uuid(),
    recordId: z.string().min(1).max(80),
    baseRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    envelope: envelopeSchema.nullable(),
    tombstone: z.boolean(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.tombstone !== (v.envelope === null) ||
      (v.envelope && (v.envelope.vaultId !== v.vaultId || v.envelope.recordId !== v.recordId))
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid operation context.' });
  });
export type SyncInput = z.infer<typeof syncInputSchema>;
export const syncOperationSchema = syncInputSchema
  .safeExtend({ proof: envelopeSchema })
  .superRefine((v, ctx) => {
    if (
      v.proof.vaultId !== v.vaultId ||
      v.proof.recordId !== `sync-op:${v.operationId}` ||
      (v.envelope && v.proof.keyId !== v.envelope.keyId)
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid operation proof context.' });
  });
export type SyncOperation = z.infer<typeof syncOperationSchema>;
async function operationClaim(input: SyncInput) {
  return {
    version: 1,
    operationId: input.operationId,
    vaultId: input.vaultId,
    recordId: input.recordId,
    baseRevision: input.baseRevision,
    tombstone: input.tombstone,
    envelopeDigest: await digestJson(input.envelope),
  };
}
export async function authenticateOperation(
  key: CryptoKey,
  keyId: string,
  input: SyncInput,
): Promise<SyncOperation> {
  const parsed = syncInputSchema.parse(input);
  return {
    ...parsed,
    proof: await sealJson(
      key,
      parsed.vaultId,
      keyId,
      `sync-op:${parsed.operationId}`,
      await operationClaim(parsed),
    ),
  };
}
export async function verifyOperation(
  key: CryptoKey,
  keyId: string,
  operation: SyncOperation,
): Promise<void> {
  const parsed = syncOperationSchema.parse(operation);
  if (parsed.proof.keyId !== keyId) throw new Error('Sync operation key mismatch.');
  const claim = await openJson(key, parsed.proof);
  if ((await digestJson(claim)) !== (await digestJson(await operationClaim(parsed))))
    throw new Error('Sync operation authentication failed.');
}
export const roles = ['owner', 'admin', 'member', 'viewer'] as const;
export type Role = (typeof roles)[number];
export function can(
  role: Role,
  action: 'read' | 'write' | 'invite' | 'remove' | 'delete',
): boolean {
  return (
    action === 'read' ||
    (action === 'write' && role !== 'viewer') ||
    (['invite', 'remove'].includes(action) && ['owner', 'admin'].includes(role)) ||
    (action === 'delete' && role === 'owner')
  );
}
export function checkRevision(remembered: number, received: number): void {
  if (!Number.isSafeInteger(received) || received < remembered)
    throw new Error('Sync rollback detected.');
}

export const pairingSchema = z
  .object({
    version: z.literal(1),
    transactionId: z.uuid(),
    vaultId: z.uuid(),
    senderId: z.uuid(),
    recipientId: z.uuid(),
    epoch: z.number().int().positive(),
    expiresAt: z.number().int().positive(),
    publicKey: z
      .object({
        kty: z.literal('EC'),
        crv: z.literal('P-256'),
        x: z.string().max(64),
        y: z.string().max(64),
      })
      .strict(),
  })
  .strict();
export type Pairing = z.infer<typeof pairingSchema>;
export async function deviceKeys(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
}
export async function publicDeviceKey(keys: CryptoKeyPair): Promise<JsonWebKey> {
  return crypto.subtle.exportKey('jwk', keys.publicKey);
}
export async function pairingKey(
  privateKey: CryptoKey,
  peer: JsonWebKey,
  context: Pairing,
): Promise<CryptoKey> {
  pairingSchema.parse(context);
  if (context.expiresAt < Date.now() || context.expiresAt > Date.now() + 300000)
    throw new Error('Pairing expired.');
  const pub = await crypto.subtle.importKey(
    'jwk',
    peer,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const secret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, privateKey, 256),
  );
  try {
    const hkdf = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
    return await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new TextEncoder().encode(context.transactionId),
        info: new TextEncoder().encode(
          JSON.stringify([
            'still-pairing-v1',
            context.vaultId,
            context.senderId,
            context.recipientId,
            context.epoch,
            context.expiresAt,
          ]),
        ),
      },
      hkdf,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  } finally {
    secret.fill(0);
  }
}
export async function wrapForDevice(kek: CryptoKey, raw: Uint8Array, context: Pairing) {
  return seal(
    kek,
    context.vaultId,
    context.transactionId,
    `${context.senderId}:${context.recipientId}:${context.epoch}`,
    raw,
  );
}
export async function unwrapFromDevice(
  kek: CryptoKey,
  envelope: import('./models.js').Envelope,
  context: Pairing,
): Promise<CryptoKey> {
  if (
    envelope.vaultId !== context.vaultId ||
    envelope.keyId !== context.transactionId ||
    envelope.recordId !== `${context.senderId}:${context.recipientId}:${context.epoch}`
  )
    throw new Error('Invalid pairing context.');
  const raw = await open(kek, envelope);
  try {
    return await importAes(raw);
  } finally {
    raw.fill(0);
  }
}
export async function pairingFingerprint(
  sender: JsonWebKey,
  recipient: JsonWebKey,
  context: Pairing,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      'still-pairing-fingerprint-v1',
      context.transactionId,
      context.vaultId,
      context.senderId,
      context.recipientId,
      context.epoch,
      context.expiresAt,
      sender.x,
      sender.y,
      recipient.x,
      recipient.y,
    ]),
  );
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest.slice(0, 8)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .match(/.{4}/g)!
    .join(' ');
}
export const randomToken = () => encode(random(32));
export const tokenBytes = (token: string) => decode(token);
