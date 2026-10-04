import { argon2id } from 'hash-wasm';
import { base32, base64urlnopad as base64url } from '@scure/base';
import {
  backupSchema,
  envelopeSchema,
  headerSchema,
  kdfSchema,
  type Backup,
  type Envelope,
  type VaultHeader,
} from './models.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
export const encode = (bytes: Uint8Array) => base64url.encode(bytes);
export function decode(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(base64url.decode(value));
}
export const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));
export async function importAes(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== 32) throw new Error('Invalid encryption key.');
  return crypto.subtle.importKey('raw', new Uint8Array(raw), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}
function aad(
  e: Pick<Envelope, 'version' | 'suite' | 'vaultId' | 'recordId' | 'keyId'>,
): Uint8Array<ArrayBuffer> {
  return encoder.encode(
    JSON.stringify(['still-vault', e.version, e.suite, e.vaultId, e.recordId, e.keyId]),
  );
}
export async function seal(
  key: CryptoKey,
  vaultId: string,
  keyId: string,
  recordId: string,
  plaintext: Uint8Array,
): Promise<Envelope> {
  const nonce = random(12);
  const context = { version: 1 as const, suite: 'A256GCM' as const, vaultId, keyId, recordId };
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad(context), tagLength: 128 },
    key,
    new Uint8Array(plaintext),
  );
  return { ...context, nonce: encode(nonce), ciphertext: encode(new Uint8Array(ciphertext)) };
}
export async function open(key: CryptoKey, input: Envelope): Promise<Uint8Array<ArrayBuffer>> {
  const e = envelopeSchema.parse(input);
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decode(e.nonce), additionalData: aad(e), tagLength: 128 },
      key,
      decode(e.ciphertext),
    ),
  );
}
export async function sealJson(
  key: CryptoKey,
  vaultId: string,
  keyId: string,
  recordId: string,
  value: unknown,
): Promise<Envelope> {
  const buffer = encoder.encode(JSON.stringify(value));
  try {
    return await seal(key, vaultId, keyId, recordId, buffer);
  } finally {
    buffer.fill(0);
  }
}
export async function openJson(key: CryptoKey, e: Envelope): Promise<unknown> {
  const buffer = await open(key, e);
  try {
    return JSON.parse(decoder.decode(buffer)) as unknown;
  } finally {
    buffer.fill(0);
  }
}
export async function passwordKey(
  passphrase: string,
  input: VaultHeader['kdf'],
): Promise<CryptoKey> {
  const kdf = kdfSchema.parse(input);
  if (passphrase.length < 1 || passphrase.length > 1024)
    throw new Error('Invalid passphrase length.');
  const pass = encoder.encode(passphrase.normalize('NFC'));
  let bytes: Uint8Array | undefined;
  try {
    bytes = await argon2id({
      password: pass,
      salt: decode(kdf.salt),
      iterations: kdf.iterations,
      memorySize: kdf.memory,
      parallelism: kdf.parallelism,
      hashLength: 32,
      outputType: 'binary',
    });
    return await importAes(bytes);
  } finally {
    pass.fill(0);
    bytes?.fill(0);
  }
}
export async function recoveryKey(
  secret: Uint8Array,
  salt: string,
  vaultId: string,
): Promise<CryptoKey> {
  const key = await crypto.subtle.importKey('raw', new Uint8Array(secret), 'HKDF', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-512',
      salt: decode(salt),
      info: encoder.encode(`still:recovery:v1:${vaultId}`),
    },
    key,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function formatRecovery(raw: Uint8Array): Promise<string> {
  if (raw.length !== 32) throw new Error('Invalid recovery material.');
  const checksum = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(raw))).slice(
    0,
    4,
  );
  const combined = new Uint8Array(36);
  combined.set(raw);
  combined.set(checksum, 32);
  return base32
    .encode(combined)
    .replace(/=+$/, '')
    .match(/.{1,4}/g)!
    .join('-');
}
export async function parseRecovery(text: string): Promise<Uint8Array<ArrayBuffer>> {
  if (text.length > 100) throw new Error('Invalid recovery key.');
  const clean = text.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z2-7]{58}$/.test(clean)) throw new Error('Invalid recovery key.');
  const combined = new Uint8Array(base32.decode(clean.padEnd(64, '=')));
  if (base32.encode(combined).replace(/=+$/, '') !== clean)
    throw new Error('Invalid recovery key.');
  const raw = combined.slice(0, 32);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', raw));
  let mismatch = 0;
  for (let i = 0; i < 4; i++) mismatch |= digest[i]! ^ combined[32 + i]!;
  combined.fill(0);
  digest.fill(0);
  if (mismatch) {
    raw.fill(0);
    throw new Error('Recovery key checksum does not match.');
  }
  return raw;
}
export function validateNewPassphrase(passphrase: string): void {
  if (passphrase.normalize('NFC').length < 15 || passphrase.length > 1024)
    throw new Error('Use a passphrase with at least 15 characters.');
}
export async function createVault(
  passphrase: string,
): Promise<{ header: VaultHeader; key: CryptoKey; recovery: string }> {
  validateNewPassphrase(passphrase);
  const vaultId = crypto.randomUUID(),
    keyId = crypto.randomUUID();
  const raw = random(32),
    recovery = random(32);
  const kdf: VaultHeader['kdf'] = {
    name: 'argon2id',
    memory: 65536,
    iterations: 3,
    parallelism: 1,
    salt: encode(random(16)),
  };
  const recoverySalt = encode(random(16));
  try {
    const kek = await passwordKey(passphrase, kdf);
    const rk = await recoveryKey(recovery, recoverySalt, vaultId);
    return {
      key: await importAes(raw),
      recovery: await formatRecovery(recovery),
      header: {
        version: 1,
        kind: 'personal',
        vaultId,
        keyId,
        createdAt: new Date().toISOString(),
        kdf,
        recoverySalt,
        passwordWrap: await seal(kek, vaultId, keyId, 'password-key', raw),
        recoveryWrap: await seal(rk, vaultId, keyId, 'recovery-key', raw),
      },
    };
  } finally {
    raw.fill(0);
    recovery.fill(0);
  }
}
export async function protectVaultKey(
  raw: Uint8Array,
  vaultId: string,
  keyId: string,
  passphrase: string,
  kind: 'personal' | 'shared',
): Promise<{ header: VaultHeader; key: CryptoKey; recovery: string }> {
  validateNewPassphrase(passphrase);
  if (raw.length !== 32) throw new Error('Invalid vault key.');
  const recovery = random(32),
    recoverySalt = encode(random(16));
  const kdf: VaultHeader['kdf'] = {
    name: 'argon2id',
    memory: 65536,
    iterations: 3,
    parallelism: 1,
    salt: encode(random(16)),
  };
  try {
    const kek = await passwordKey(passphrase, kdf),
      rk = await recoveryKey(recovery, recoverySalt, vaultId);
    return {
      header: {
        version: 1,
        kind,
        vaultId,
        keyId,
        createdAt: new Date().toISOString(),
        kdf,
        recoverySalt,
        passwordWrap: await seal(kek, vaultId, keyId, 'password-key', raw),
        recoveryWrap: await seal(rk, vaultId, keyId, 'recovery-key', raw),
      },
      key: await importAes(raw),
      recovery: await formatRecovery(recovery),
    };
  } finally {
    recovery.fill(0);
  }
}
export async function unlockVault(
  input: VaultHeader,
  credential: string,
  method: 'passphrase' | 'recovery' = 'passphrase',
): Promise<CryptoKey> {
  const header = headerSchema.parse(input);
  let raw: Uint8Array | undefined, recovery: Uint8Array | undefined;
  try {
    const kek =
      method === 'passphrase'
        ? await passwordKey(credential, header.kdf)
        : await recoveryKey(
            (recovery = await parseRecovery(credential)),
            header.recoverySalt,
            header.vaultId,
          );
    raw = await open(kek, method === 'passphrase' ? header.passwordWrap : header.recoveryWrap);
    return await importAes(raw);
  } finally {
    raw?.fill(0);
    recovery?.fill(0);
  }
}
export async function changePassphrase(
  input: VaultHeader,
  credential: string,
  method: 'passphrase' | 'recovery',
  next: string,
): Promise<VaultHeader> {
  validateNewPassphrase(next);
  const header = headerSchema.parse(input);
  let recovery: Uint8Array | undefined;
  const previous =
    method === 'passphrase'
      ? await passwordKey(credential, header.kdf)
      : await recoveryKey(
          (recovery = await parseRecovery(credential)),
          header.recoverySalt,
          header.vaultId,
        );
  let raw: Uint8Array | undefined;
  try {
    raw = await open(previous, method === 'passphrase' ? header.passwordWrap : header.recoveryWrap);
    const kdf = { ...header.kdf, memory: 65536, iterations: 3, salt: encode(random(16)) };
    const key = await passwordKey(next, kdf);
    return {
      ...header,
      kdf,
      passwordWrap: await seal(key, header.vaultId, header.keyId, 'password-key', raw),
    };
  } finally {
    recovery?.fill(0);
    raw?.fill(0);
  }
}
export async function digestJson(value: unknown): Promise<string> {
  // Object insertion order must not change backup authentication after schema parsing.
  function canonical(input: unknown): string {
    if (input === null || typeof input === 'string' || typeof input === 'boolean')
      return JSON.stringify(input);
    if (typeof input === 'number' && Number.isFinite(input)) return JSON.stringify(input);
    if (Array.isArray(input)) return `[${input.map(canonical).join(',')}]`;
    if (typeof input === 'object' && input)
      return `{${Object.keys(input)
        .sort()
        .map(
          (key) => `${JSON.stringify(key)}:${canonical((input as Record<string, unknown>)[key])}`,
        )
        .join(',')}}`;
    throw new Error('Unsupported authenticated JSON value.');
  }
  return encode(
    new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(canonical(value)))),
  );
}
export async function makeBackup(
  key: CryptoKey,
  header: VaultHeader,
  records: Envelope[],
): Promise<Backup> {
  const exportedAt = new Date().toISOString();
  const digest = await digestJson({ header, records, exportedAt });
  return {
    format: 'still.otpvault',
    version: 1,
    header,
    records,
    exportedAt,
    manifest: await sealJson(key, header.vaultId, header.keyId, 'backup-manifest', { digest }),
  };
}
export async function validateBackup(
  input: unknown,
  credential: string,
  method: 'passphrase' | 'recovery',
): Promise<{ backup: Backup; key: CryptoKey }> {
  const backup = backupSchema.parse(input);
  const key = await unlockVault(backup.header, credential, method);
  const manifest = (await openJson(key, backup.manifest)) as { digest?: unknown };
  if (
    manifest.digest !==
    (await digestJson({
      header: backup.header,
      records: backup.records,
      exportedAt: backup.exportedAt,
    }))
  )
    throw new Error('Backup integrity check failed.');
  // Verify every record before allowing a transactional restore.
  for (const e of backup.records) await openJson(key, e);
  return { backup, key };
}
