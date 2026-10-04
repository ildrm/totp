import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  hotp,
  totp,
  parseUri,
  serializeUri,
  normalizeSecret,
  generateSecret,
} from '../../packages/core/src/index';
import { base32 } from '../../packages/core/node_modules/@scure/base';
const secret = (text: string) => base32.encode(new TextEncoder().encode(text)).replace(/=+$/, '');
const sha1 = secret('12345678901234567890');
describe('RFC 4226', () => {
  const codes = [
    '755224',
    '287082',
    '359152',
    '969429',
    '338314',
    '254676',
    '287922',
    '162583',
    '399871',
    '520489',
  ];
  codes.forEach((code, counter) =>
    it(`counter ${counter}`, async () => expect(await hotp(sha1, BigInt(counter))).toBe(code)),
  );
  it('supports unsigned 64-bit counters', async () =>
    expect(await hotp(sha1, 0xffffffffffffffffn)).toMatch(/^\d{6}$/));
  it('rejects counter overflow', async () =>
    expect(hotp(sha1, 0x10000000000000000n)).rejects.toThrow());
  it('rejects a negative counter', async () => expect(hotp(sha1, -1n)).rejects.toThrow());
});
describe('RFC 6238 Appendix B with erratum 2866 secret lengths', () => {
  const fixtures = [
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
    [1111111111, '14050471', '67062674', '99943326'],
    [1234567890, '89005924', '91819424', '93441116'],
    [2000000000, '69279037', '90698825', '38618901'],
    [20000000000, '65353130', '77737706', '47863826'],
  ] as const;
  const keys = [
    sha1,
    secret('12345678901234567890123456789012'),
    secret('1234567890123456789012345678901234567890123456789012345678901234'),
  ];
  fixtures.forEach(([timestamp, ...codes]) => {
    (['SHA-1', 'SHA-256', 'SHA-512'] as const).forEach((algorithm, i) =>
      it(`${algorithm} at ${timestamp}`, async () =>
        expect(await totp({ secret: keys[i]!, algorithm, digits: 8, period: 30 }, timestamp)).toBe(
          codes[i],
        )),
    );
  });
  it('switches exactly at 60 seconds', async () => {
    const input = { secret: sha1, algorithm: 'SHA-1' as const, digits: 6 as const, period: 30 };
    expect(await totp(input, 59)).toBe(await hotp(sha1, 1n));
    expect(await totp(input, 60)).toBe(await hotp(sha1, 2n));
  });
  it('rejects unsafe timestamps', async () =>
    expect(
      totp(
        { secret: sha1, algorithm: 'SHA-1', digits: 6, period: 30 },
        Number.MAX_SAFE_INTEGER + 1,
      ),
    ).rejects.toThrow());
  it('supports provisioned T0', async () =>
    expect(await totp({ secret: sha1, algorithm: 'SHA-1', digits: 6, period: 30 }, 90, 60)).toBe(
      '287082',
    ));
});
describe('provisioning validation', () => {
  const valid = {
    type: 'totp' as const,
    issuer: 'Example',
    account: 'a+é@example.com',
    secret: sha1,
    algorithm: 'SHA-256' as const,
    digits: 8 as const,
    period: 30,
    counter: '0',
  };
  it('round-trips Unicode labels safely', () =>
    expect(parseUri(serializeUri(valid))).toEqual(valid));
  it('normalizes whitespace and lowercase', () =>
    expect(normalizeSecret(` ${sha1.toLowerCase()}\n`)).toBe(sha1));
  it.each([
    'secret=' + sha1 + '&secret=' + sha1,
    'secret=' + sha1 + '&algorithm=SHA3-256',
    'secret=' + sha1 + '&issuer=Other',
    'secret=' + sha1 + '&digits=6e0',
    'secret=' + sha1 + '&period=999999999',
    'secret=' + sha1 + '&redirect=https://evil.example',
  ])('rejects ambiguous or unsupported parameters: %s', (parameters) =>
    expect(() => parseUri(`otpauth://totp/Example:a?${parameters}`)).toThrow(),
  );
  it.each([
    '',
    'A',
    'AAAAAAAA',
    'GEZDGNBVGY3TQOJQGEZDGNBVGZ',
    'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ=',
    '0'.repeat(32),
    'A'.repeat(2000),
  ])('rejects malformed Base32', (value) => expect(() => normalizeSecret(value)).toThrow());
  it('requires HOTP counters', () =>
    expect(() => parseUri(`otpauth://hotp/Example:a?secret=${sha1}`)).toThrow());
  it('never interprets arbitrary QR URLs', () =>
    expect(() => parseUri('https://example.com')).toThrow());
  it('preserves leading zeros', async () =>
    expect(
      await totp({ secret: sha1, algorithm: 'SHA-1', digits: 8, period: 30 }, 1111111109),
    ).toBe('07081804'));
  it('fuzzes the URI parser without unbounded work', () =>
    fc.assert(
      fc.property(fc.string({ maxLength: 5000 }), (input) => {
        try {
          const parsed = parseUri(input);
          expect(parseUri(serializeUri(parsed))).toEqual(parsed);
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
        }
      }),
      { numRuns: 500 },
    ));
  it('generates at least 160 bits with canonical round-trips', () => {
    for (const bits of [160, 256, 512]) {
      const value = generateSecret(bits);
      expect(normalizeSecret(value)).toBe(value);
      expect(value.length).toBe(Math.ceil(bits / 5));
    }
  });
});
