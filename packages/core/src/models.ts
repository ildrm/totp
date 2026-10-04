import { z } from 'zod';
import { otpSchema } from './otp.js';

export const recordSchema = otpSchema
  .extend({
    id: z.uuid(),
    vaultId: z.uuid(),
    schemaVersion: z.literal(1),
    color: z.enum(['violet', 'blue', 'green', 'orange', 'rose', 'slate']).default('violet'),
    favorite: z.boolean().default(false),
    tags: z.array(z.string().max(32)).max(20).default([]),
    folder: z.string().max(64).default('Personal'),
    notes: z.string().max(2000).default(''),
    aliases: z.array(z.string().max(128)).max(10).default([]),
    createdAt: z.iso.datetime(),
    modifiedAt: z.iso.datetime(),
    lastUsedAt: z.iso.datetime().nullable().default(null),
    usageCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    archived: z.boolean().default(false),
    order: z.number().int().min(0).default(0),
  })
  .strict();
export type VaultRecord = z.infer<typeof recordSchema>;
export type PublicRecord = Omit<VaultRecord, 'secret'>;
export function publicRecord(record: VaultRecord): PublicRecord {
  const { secret: _secret, ...metadata } = record;
  return metadata;
}

export const envelopeSchema = z
  .object({
    version: z.literal(1),
    suite: z.literal('A256GCM'),
    vaultId: z.uuid(),
    recordId: z.string().min(1).max(80),
    keyId: z.uuid(),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
    ciphertext: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .min(22)
      .max(16384),
  })
  .strict();
export type Envelope = z.infer<typeof envelopeSchema>;
export const kdfSchema = z
  .object({
    name: z.literal('argon2id'),
    memory: z.number().int().min(19456).max(262144),
    iterations: z.number().int().min(2).max(10),
    parallelism: z.literal(1),
    salt: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  })
  .strict();
export const headerSchema = z
  .object({
    version: z.literal(1),
    kind: z.enum(['personal', 'shared']).optional(),
    vaultId: z.uuid(),
    keyId: z.uuid(),
    createdAt: z.iso.datetime(),
    kdf: kdfSchema,
    passwordWrap: envelopeSchema,
    recoveryWrap: envelopeSchema,
    recoverySalt: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  })
  .strict()
  .superRefine((h, ctx) => {
    for (const [purpose, e] of [
      ['password-key', h.passwordWrap],
      ['recovery-key', h.recoveryWrap],
    ] as const) {
      if (e.vaultId !== h.vaultId || e.keyId !== h.keyId || e.recordId !== purpose)
        ctx.addIssue({ code: 'custom', message: 'Inconsistent key context.' });
    }
  });
export type VaultHeader = z.infer<typeof headerSchema>;
export const backupSchema = z
  .object({
    format: z.literal('still.otpvault'),
    version: z.literal(1),
    header: headerSchema,
    records: z.array(envelopeSchema).max(10000),
    manifest: envelopeSchema,
    exportedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((b, ctx) => {
    const ids = new Set<string>();
    for (const e of b.records) {
      if (ids.has(e.recordId) || e.vaultId !== b.header.vaultId || e.keyId !== b.header.keyId)
        ctx.addIssue({ code: 'custom', message: 'Invalid backup record context.' });
      ids.add(e.recordId);
    }
    if (
      b.manifest.recordId !== 'backup-manifest' ||
      b.manifest.vaultId !== b.header.vaultId ||
      b.manifest.keyId !== b.header.keyId
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid backup manifest.' });
  });
export type Backup = z.infer<typeof backupSchema>;

export const settingsSchema = z
  .object({
    autoLockMinutes: z.union([z.literal(1), z.literal(5), z.literal(15), z.literal(60)]).default(5),
    privacy: z.boolean().default(false),
    lockOnHide: z.boolean().default(true),
    recordUsage: z.boolean().default(true),
    copyThreshold: z.number().int().min(0).max(10).default(3),
    lastBackup: z.iso.datetime().nullable().default(null),
  })
  .strict();
export type VaultSettings = z.infer<typeof settingsSchema>;
export const defaultSettings = settingsSchema.parse({});
