import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms';
import { z } from 'zod';
import { Database } from './database.js';
const cipherSchema = z.discriminatedUnion('suite', [
  z
    .object({
      version: z.literal(1),
      suite: z.literal('aws-kms'),
      keyId: z.string().min(1).max(1024),
      ciphertext: z.string().max(8192),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      suite: z.literal('development-aes-gcm'),
      keyId: z.literal('development-only'),
      nonce: z.string().max(32),
      tag: z.string().max(32),
      ciphertext: z.string().max(1024),
    })
    .strict(),
]);
type ServerEnvelope = z.infer<typeof cipherSchema>;
@Injectable()
export class VerifierKeys {
  private readonly kms: KMSClient | null;
  constructor(@Inject(Database) private readonly db: Database) {
    this.kms =
      db.config.NODE_ENV === 'production' && db.config.MFA_ENABLED === 'true'
        ? new KMSClient({ region: db.config.AWS_REGION })
        : null;
  }
  private context(applicationId: string, credentialId: string) {
    return { purpose: 'still-mfa-verifier-v1', applicationId, credentialId };
  }
  async encrypt(
    secret: string,
    applicationId: string,
    credentialId: string,
  ): Promise<ServerEnvelope> {
    const plaintext = Buffer.from(secret, 'utf8');
    try {
      if (this.kms) {
        const result = await this.kms.send(
          new EncryptCommand({
            KeyId: this.db.config.KMS_KEY_ID,
            Plaintext: plaintext,
            EncryptionContext: this.context(applicationId, credentialId),
          }),
        );
        if (!result.CiphertextBlob || !result.KeyId) throw new Error('KMS encryption failed.');
        return {
          version: 1,
          suite: 'aws-kms',
          keyId: result.KeyId,
          ciphertext: Buffer.from(result.CiphertextBlob).toString('base64url'),
        };
      }
      if (this.db.config.NODE_ENV === 'production' || !this.db.config.MFA_DEV_KEY)
        throw new Error('Verifier key management unavailable.');
      const key = Buffer.from(this.db.config.MFA_DEV_KEY, 'hex'),
        nonce = randomBytes(12);
      try {
        const cipher = createCipheriv('aes-256-gcm', key, nonce);
        cipher.setAAD(Buffer.from(JSON.stringify(this.context(applicationId, credentialId))));
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        return {
          version: 1,
          suite: 'development-aes-gcm',
          keyId: 'development-only',
          nonce: nonce.toString('base64url'),
          tag: cipher.getAuthTag().toString('base64url'),
          ciphertext: ciphertext.toString('base64url'),
        };
      } finally {
        key.fill(0);
      }
    } finally {
      plaintext.fill(0);
    }
  }
  async decrypt(input: unknown, applicationId: string, credentialId: string): Promise<string> {
    const e = cipherSchema.parse(input);
    if (e.suite === 'aws-kms') {
      if (!this.kms) throw new Error('KMS unavailable.');
      const result = await this.kms.send(
        new DecryptCommand({
          KeyId: e.keyId,
          CiphertextBlob: Buffer.from(e.ciphertext, 'base64url'),
          EncryptionContext: this.context(applicationId, credentialId),
        }),
      );
      if (!result.Plaintext) throw new Error('KMS decryption failed.');
      const bytes = Buffer.from(result.Plaintext);
      try {
        return bytes.toString('utf8');
      } finally {
        bytes.fill(0);
        result.Plaintext.fill(0);
      }
    }
    if (this.db.config.NODE_ENV === 'production' || !this.db.config.MFA_DEV_KEY)
      throw new Error('Development verifier key rejected.');
    const key = Buffer.from(this.db.config.MFA_DEV_KEY, 'hex');
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(e.nonce, 'base64url'));
      decipher.setAAD(Buffer.from(JSON.stringify(this.context(applicationId, credentialId))));
      decipher.setAuthTag(Buffer.from(e.tag, 'base64url'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(e.ciphertext, 'base64url')),
        decipher.final(),
      ]);
      try {
        return plaintext.toString('utf8');
      } finally {
        plaintext.fill(0);
      }
    } finally {
      key.fill(0);
    }
  }
}
