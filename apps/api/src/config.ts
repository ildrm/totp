import { z } from 'zod';
import { isIP } from 'node:net';
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(2).default(0),
  DATABASE_URL: z.string().min(1),
  APP_ORIGIN: z.url().default('http://localhost:3000'),
  RP_ID: z.string().min(1).default('localhost'),
  RATE_LIMIT_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  MFA_ENABLED: z.enum(['true', 'false']).default('false'),
  MFA_DEV_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  KMS_KEY_ID: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
  AWS_REGION: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
});
export type Config = z.infer<typeof schema>;
export function parseConfig(environment: Record<string, string | undefined>): Config {
  const c = schema.parse(environment),
    url = new URL(c.APP_ORIGIN);
  if (url.origin !== c.APP_ORIGIN || url.hostname !== c.RP_ID)
    throw new Error('APP_ORIGIN and RP_ID must match exactly.');
  if (isIP(c.RP_ID) || !['http:', 'https:'].includes(url.protocol))
    throw new Error('WebAuthn requires a domain RP ID. Use localhost for development.');
  if (
    c.NODE_ENV === 'production' &&
    (url.protocol !== 'https:' || !c.RATE_LIMIT_KEY || c.MFA_DEV_KEY)
  )
    throw new Error(
      'Production requires HTTPS, a dedicated rate-limit key, and no development encryption key.',
    );
  if (c.MFA_ENABLED === 'true' && c.NODE_ENV === 'production' && (!c.KMS_KEY_ID || !c.AWS_REGION))
    throw new Error('Production MFA requires an AWS KMS key and region.');
  if (c.MFA_ENABLED === 'true' && c.NODE_ENV !== 'production' && !c.MFA_DEV_KEY)
    throw new Error('Development MFA requires an explicit development-only key.');
  return c;
}
