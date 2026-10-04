import { base32 } from '@scure/base';
import { z } from 'zod';

export const algorithmSchema = z.enum(['SHA-1', 'SHA-256', 'SHA-512']);
export const otpSchema = z
  .object({
    type: z.enum(['totp', 'hotp']),
    issuer: z.string().trim().min(1).max(128),
    account: z.string().trim().min(1).max(256),
    secret: z.string().max(1024).transform(normalizeSecret),
    algorithm: algorithmSchema.default('SHA-1'),
    digits: z.union([z.literal(6), z.literal(8)]).default(6),
    period: z.number().int().min(5).max(300).default(30),
    counter: z
      .string()
      .regex(/^(0|[1-9]\d{0,19})$/)
      .refine((v) => BigInt(v) <= 0xffffffffffffffffn)
      .default('0'),
  })
  .strict();
export type OtpInput = z.infer<typeof otpSchema>;

export function normalizeSecret(input: string): string {
  if (input.length > 1024) throw new Error('Setup key is too long.');
  const text = input.replace(/[ \t\r\n]/g, '').toUpperCase();
  if (!/^[A-Z2-7]+={0,6}$/.test(text)) throw new Error('Enter a valid Base32 setup key.');
  const raw = text.replace(/=+$/, '');
  const padded = raw.padEnd(Math.ceil(raw.length / 8) * 8, '=');
  if (text.includes('=') && padded !== text) throw new Error('Setup key has invalid padding.');
  let bytes: Uint8Array;
  try {
    bytes = base32.decode(padded);
  } catch {
    throw new Error('Setup key has invalid encoding.');
  }
  if (base32.encode(bytes).replace(/=+$/, '') !== raw)
    throw new Error('Setup key has noncanonical trailing bits.');
  if (bytes.length < 16 || bytes.length > 128)
    throw new Error('Setup keys must contain 128 to 1024 bits.');
  return raw;
}

export function decodeSecret(secret: string): Uint8Array {
  const canonical = normalizeSecret(secret);
  return base32.decode(canonical.padEnd(Math.ceil(canonical.length / 8) * 8, '='));
}
export function generateSecret(bits = 160): string {
  if (![160, 256, 512].includes(bits)) throw new Error('Unsupported secret size.');
  return base32.encode(crypto.getRandomValues(new Uint8Array(bits / 8))).replace(/=+$/, '');
}

export async function hotp(
  secret: string,
  counter: bigint,
  algorithm: OtpInput['algorithm'] = 'SHA-1',
  digits: 6 | 8 = 6,
): Promise<string> {
  if (counter < 0n || counter > 0xffffffffffffffffn || ![6, 8].includes(digits))
    throw new Error('Invalid OTP parameters.');
  const bytes = decodeSecret(secret);
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(bytes),
      { name: 'HMAC', hash: algorithmSchema.parse(algorithm) },
      false,
      ['sign'],
    );
    const movingFactor = new Uint8Array(8);
    new DataView(movingFactor.buffer).setBigUint64(0, counter, false);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, movingFactor));
    const offset = mac[mac.length - 1]! & 15;
    const binary =
      (mac[offset]! & 127) * 0x1000000 +
      (mac[offset + 1]! << 16) +
      (mac[offset + 2]! << 8) +
      mac[offset + 3]!;
    return (binary % 10 ** digits).toString().padStart(digits, '0');
  } finally {
    bytes.fill(0);
  }
}
export async function totp(
  input: Pick<OtpInput, 'secret' | 'algorithm' | 'digits' | 'period'>,
  timestamp: number = Math.floor(Date.now() / 1000),
  t0 = 0,
): Promise<string> {
  if (
    !Number.isSafeInteger(timestamp) ||
    !Number.isSafeInteger(t0) ||
    timestamp < t0 ||
    !Number.isInteger(input.period) ||
    input.period < 5 ||
    input.period > 300
  )
    throw new Error('Invalid time parameters.');
  return hotp(
    input.secret,
    BigInt(Math.floor((timestamp - t0) / input.period)),
    input.algorithm,
    input.digits,
  );
}

export function parseUri(text: string): OtpInput {
  if (text.length > 4096 || /[\r\n\x00]/.test(text)) throw new Error('Invalid provisioning URI.');
  let uri: URL;
  try {
    uri = new URL(text);
  } catch {
    throw new Error('Enter an otpauth provisioning URI.');
  }
  if (
    uri.protocol !== 'otpauth:' ||
    !['totp', 'hotp'].includes(uri.hostname) ||
    uri.username ||
    uri.password ||
    uri.port ||
    uri.hash
  )
    throw new Error('Unsupported provisioning URI.');
  const allowed = new Set(['secret', 'issuer', 'algorithm', 'digits', 'period', 'counter']);
  for (const key of uri.searchParams.keys()) {
    if (!allowed.has(key) || uri.searchParams.getAll(key).length !== 1)
      throw new Error('Unknown or duplicate provisioning parameter.');
  }
  let label: string;
  try {
    label = decodeURIComponent(uri.pathname.slice(1));
  } catch {
    throw new Error('Invalid account label.');
  }
  if (!label || label.includes('/') || /[\x00-\x1f\x7f]/.test(label))
    throw new Error('Invalid account label.');
  const colon = label.indexOf(':');
  const labelIssuer = colon < 0 ? '' : label.slice(0, colon).trim();
  const issuer = uri.searchParams.get('issuer')?.trim() || labelIssuer || label;
  if (labelIssuer && labelIssuer !== issuer)
    throw new Error('Issuer and account label do not match.');
  const value = (name: string, fallback: string) => uri.searchParams.get(name) ?? fallback;
  const number = (name: string, fallback: string) => {
    const v = value(name, fallback);
    if (!/^\d+$/.test(v)) throw new Error('Invalid numeric parameter.');
    return Number(v);
  };
  if (uri.hostname === 'hotp' && !uri.searchParams.has('counter'))
    throw new Error('HOTP requires a counter.');
  if (uri.hostname === 'totp' && uri.searchParams.has('counter'))
    throw new Error('TOTP cannot have an HOTP counter.');
  if (uri.hostname === 'hotp' && uri.searchParams.has('period'))
    throw new Error('HOTP cannot have a time period.');
  const algorithm = value('algorithm', 'SHA1')
    .toUpperCase()
    .replace(/^SHA(1|256|512)$/, 'SHA-$1');
  return otpSchema.parse({
    type: uri.hostname,
    issuer,
    account: colon < 0 ? label : label.slice(colon + 1).trim(),
    secret: value('secret', ''),
    algorithm,
    digits: number('digits', '6'),
    period: number('period', '30'),
    counter: value('counter', '0'),
  });
}
export function serializeUri(input: OtpInput): string {
  const record = otpSchema.parse(input);
  const params = new URLSearchParams({
    secret: record.secret,
    issuer: record.issuer,
    algorithm: record.algorithm.replace('-', ''),
    digits: String(record.digits),
  });
  params.set(
    record.type === 'totp' ? 'period' : 'counter',
    record.type === 'totp' ? String(record.period) : record.counter,
  );
  return `otpauth://${record.type}/${encodeURIComponent(record.issuer)}:${encodeURIComponent(record.account)}?${params}`;
}
