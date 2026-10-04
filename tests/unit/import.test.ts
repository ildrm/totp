import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { previewImport } from '../../packages/core/src/import';
const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
describe('bounded local imports', () => {
  it('parses quoted CSV without dropping metadata into execution', () => {
    const result = previewImport(
      `issuer,account,secret,algorithm,digits,period\n"Service, Inc",public,${secret},SHA256,8,30`,
      'test.csv',
    );
    expect(result.accounts[0]).toMatchObject({
      issuer: 'Service, Inc',
      algorithm: 'SHA-256',
      digits: 8,
    });
    expect(result.errors).toEqual([]);
  });
  it('previews supported Aegis entries and reports unsupported entries', () => {
    const result = previewImport(
      JSON.stringify({
        version: 1,
        header: {},
        db: {
          version: 3,
          entries: [
            {
              type: 'totp',
              issuer: 'Fixture',
              name: 'public',
              info: { secret, algo: 'SHA1', digits: 6, period: 30 },
            },
            { type: 'steam', info: { secret } },
          ],
        },
      }),
    );
    expect(result.accounts).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.row).toBe(2);
  });
  it('accepts JSON and multiline provisioning URIs', () => {
    expect(
      previewImport(JSON.stringify([{ issuer: 'Fixture', account: 'public', secret }])).accounts,
    ).toHaveLength(1);
    const uri = `otpauth://totp/Fixture:public?secret=${secret}&issuer=Fixture`;
    expect(previewImport(`${uri}\n${uri}`).accounts).toHaveLength(2);
  });
  it('rejects oversized, encrypted, future, and malformed imports', () => {
    for (const input of [
      'x'.repeat(5 * 1024 * 1024 + 1),
      '{"version":1,"db":"encrypted"}',
      '{"version":99,"db":{}}',
      'issuer,account,secret\n"broken',
      '[]',
      '{"format":"still.otpvault"}',
    ])
      expect(() => previewImport(input)).toThrow();
    const result = previewImport(
      JSON.stringify([
        {
          issuer: 'Fixture',
          account: 'public',
          secret,
          type: 'hotp',
          counter: Number('18446744073709551615'),
        },
      ]),
    );
    expect(result.accounts).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
  });
  it('handles hostile payloads without accepting malformed accounts', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 5000 }), (text) => {
        try {
          const result = previewImport(text);
          expect(result.accounts.length).toBeLessThanOrEqual(1000);
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
        }
      }),
      { numRuns: 500 },
    );
  });
});
