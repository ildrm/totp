import Papa from 'papaparse';
import { z } from 'zod';
import { otpSchema, parseUri, type OtpInput } from './otp.js';
export type ImportPreview = {
  format: string;
  accounts: OtpInput[];
  errors: { row: number; message: string }[];
};
const object = z.record(z.string(), z.unknown());
const algorithms: Record<string, string> = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' };
function account(value: unknown): OtpInput {
  const data = object.parse(value);
  if (typeof data.counter === 'number' && !Number.isSafeInteger(data.counter))
    throw new Error('Counter must be a safe integer or decimal string.');
  return otpSchema.parse({
    type: typeof data.type === 'string' ? data.type.toLowerCase() : 'totp',
    issuer: data.issuer,
    account: data.account,
    secret: data.secret,
    algorithm:
      typeof data.algorithm === 'string'
        ? (algorithms[data.algorithm.toUpperCase().replaceAll('-', '')] ?? data.algorithm)
        : 'SHA-1',
    digits: data.digits === undefined || data.digits === '' ? 6 : Number(data.digits),
    period: data.period === undefined || data.period === '' ? 30 : Number(data.period),
    counter: data.counter === undefined || data.counter === '' ? '0' : String(data.counter),
  });
}
export function previewImport(text: string, filename = ''): ImportPreview {
  if (new TextEncoder().encode(text).length > 5 * 1024 * 1024)
    throw new Error('Import exceeds 5 MB.');
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  let rows: unknown[],
    format: string,
    convert: (v: unknown) => OtpInput = account;
  if (trimmed.startsWith('otpauth://')) {
    rows = trimmed.split(/\r?\n/).filter((line) => line.trim());
    format = 'Provisioning URIs';
    convert = (v) => parseUri(z.string().parse(v).trim());
  } else if (
    filename.toLowerCase().endsWith('.csv') ||
    (!trimmed.startsWith('{') && !trimmed.startsWith('['))
  ) {
    const parsed = Papa.parse<Record<string, string>>(trimmed, {
      header: true,
      skipEmptyLines: 'greedy',
      dynamicTyping: false,
    });
    if (
      parsed.errors.length ||
      !['issuer', 'account', 'secret'].every((k) => parsed.meta.fields?.includes(k))
    )
      throw new Error('CSV requires issuer, account, and secret columns with valid quoting.');
    rows = parsed.data;
    format = 'CSV';
  } else {
    const value: unknown = JSON.parse(trimmed);
    if (Array.isArray(value)) {
      rows = value;
      format = 'OTP JSON';
    } else {
      const root = object.parse(value);
      if (root.format === 'still.otpvault')
        throw new Error('Use encrypted backup restoration in Settings for .otpvault files.');
      if ('db' in root) {
        if (typeof root.db === 'string')
          throw new Error(
            'Encrypted Aegis files must be unlocked and exported by Aegis first. Keep the plaintext export private.',
          );
        if (root.version !== 1) throw new Error('Unsupported Aegis file version.');
        const db = z
          .object({
            version: z.number().int().min(1).max(3),
            entries: z.array(z.unknown()).max(1000),
          })
          .parse(root.db);
        rows = db.entries;
        format = 'Aegis plaintext v1';
        convert = (v) => {
          const entry = object.parse(v),
            info = object.parse(entry.info);
          return account({
            type: entry.type,
            issuer: entry.issuer,
            account: entry.name,
            secret: info.secret,
            algorithm: info.algo,
            digits: info.digits,
            period: info.period,
            counter: info.counter,
          });
        };
      } else {
        const document = z
          .object({
            format: z.literal('still.plaintext-import'),
            version: z.literal(1),
            accounts: z.array(z.unknown()).max(1000),
          })
          .strict()
          .parse(root);
        rows = document.accounts;
        format = 'Still plaintext import v1';
      }
    }
  }
  if (!rows.length || rows.length > 1000)
    throw new Error('Import between 1 and 1,000 accounts at a time.');
  const accounts: OtpInput[] = [],
    errors: ImportPreview['errors'] = [];
  rows.forEach((row, index) => {
    try {
      accounts.push(convert(row));
    } catch {
      errors.push({
        row: index + 1,
        message: 'Unsupported OTP type, invalid parameters, or malformed setup key.',
      });
    }
  });
  return { format, accounts, errors };
}
