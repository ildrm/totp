import { describe, it, expect } from 'vitest';
import { parseConfig } from '../../apps/api/src/config';
const base = { DATABASE_URL: 'postgres://test:test@localhost/test' };
describe('production configuration guards', () => {
  it('uses a valid localhost relying party for development', () =>
    expect(parseConfig(base).RP_ID).toBe('localhost'));
  it('rejects IP-based WebAuthn relying parties and mismatched origins', () => {
    for (const values of [
      { APP_ORIGIN: 'http://127.0.0.1:3000', RP_ID: '127.0.0.1' },
      { APP_ORIGIN: 'https://example.com', RP_ID: 'other.example.com' },
      { APP_ORIGIN: 'https://example.com/path', RP_ID: 'example.com' },
    ])
      expect(() => parseConfig({ ...base, ...values })).toThrow();
  });
  it('rejects insecure production origins, development keys, and missing verifier KMS', () => {
    const production = {
      ...base,
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://auth.example.com',
      RP_ID: 'auth.example.com',
      RATE_LIMIT_KEY: 'f'.repeat(64),
    };
    for (const values of [
      { APP_ORIGIN: 'http://auth.example.com' },
      { RATE_LIMIT_KEY: undefined },
      { MFA_DEV_KEY: 'a'.repeat(64) },
      { MFA_ENABLED: 'true' },
    ])
      expect(() => parseConfig({ ...production, ...values })).toThrow();
    expect(
      parseConfig({ ...production, MFA_ENABLED: 'false', KMS_KEY_ID: '', AWS_REGION: '' })
        .KMS_KEY_ID,
    ).toBeUndefined();
    expect(
      parseConfig({
        ...production,
        MFA_ENABLED: 'true',
        KMS_KEY_ID: 'configured-key-id',
        AWS_REGION: 'eu-west-1',
      }).MFA_ENABLED,
    ).toBe('true');
  });
});
