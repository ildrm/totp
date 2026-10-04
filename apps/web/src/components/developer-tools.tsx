'use client';
import { useEffect, useState } from 'react';
import { Braces, FlaskConical, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  generateSecret,
  normalizeSecret,
  parseUri,
  serializeUri,
  totp,
  hotp,
  type OtpInput,
} from '@still/core';
import { DeveloperPortal } from './developer-portal';
export function DeveloperTools({ onCloud }: { onCloud: () => void }) {
  const [secret, setSecret] = useState(''),
    [algorithm, setAlgorithm] = useState<OtpInput['algorithm']>('SHA-256'),
    [type, setType] = useState<'totp' | 'hotp'>('totp'),
    [digits, setDigits] = useState<6 | 8>(8),
    [period, setPeriod] = useState(30),
    [timestamp, setTimestamp] = useState(String(Math.floor(Date.now() / 1000))),
    [counter, setCounter] = useState('0'),
    [uri, setUri] = useState(''),
    [result, setResult] = useState<{ previous: string; current: string; next: string } | null>(
      null,
    ),
    [error, setError] = useState(''),
    [parsed, setParsed] = useState<OtpInput | null>(null),
    [qr, setQr] = useState('');
  useEffect(
    () => () => {
      setSecret('');
      setUri('');
    },
    [],
  );
  async function calculate(e: React.FormEvent) {
    e.preventDefault();
    try {
      const normalized = normalizeSecret(secret);
      const time = Number(timestamp);
      const input = { secret: normalized, algorithm, digits, period };
      if (type === 'totp') {
        setResult({
          previous: await totp(input, Math.max(0, time - period)),
          current: await totp(input, time),
          next: await totp(input, time + period),
        });
      } else {
        const c = BigInt(counter);
        setResult({
          previous: await hotp(normalized, c > 0n ? c - 1n : 0n, algorithm, digits),
          current: await hotp(normalized, c, algorithm, digits),
          next: await hotp(normalized, c + 1n, algorithm, digits),
        });
      }
      setError('');
    } catch {
      setError('Check the Base32 key, time, period, and counter.');
      setResult(null);
    }
  }
  async function inspect() {
    try {
      const record = parseUri(uri);
      setParsed(record);
      const QR = await import('qrcode');
      setQr(await QR.toDataURL(serializeUri(record), { width: 240, margin: 2 }));
      setError('');
    } catch {
      setError('Invalid or unsupported provisioning URI.');
      setParsed(null);
      setQr('');
    }
  }
  return (
    <section className="feature-page">
      <div className="section-heading">
        <span className="eyebrow">BUILT FOR THE CURIOUS</span>
        <h2>A little authentication laboratory.</h2>
        <p className="muted">
          Local tools for exploring the standards. Nothing here is saved or sent to a server.
        </p>
      </div>
      <div className="inline-notice">
        <ShieldCheck size={17} />
        Use test secrets here. Generated keys and provisioning QR codes grant access to any account
        using them.
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="tools-grid">
        <div className="settings-card">
          <h3>
            <FlaskConical size={20} />
            OTP playground
          </h3>
          <form onSubmit={calculate}>
            <label>
              Base32 test secret
              <div className="input-action">
                <input
                  type="password"
                  required
                  maxLength={1024}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Generate random test secret"
                  onClick={() => setSecret(generateSecret(algorithm === 'SHA-512' ? 512 : 256))}
                >
                  <RefreshCw size={17} />
                </button>
              </div>
            </label>
            <div className="form-grid">
              <label>
                Type
                <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                  <option value="totp">TOTP</option>
                  <option value="hotp">HOTP</option>
                </select>
              </label>
              <label>
                Algorithm
                <select
                  value={algorithm}
                  onChange={(e) => setAlgorithm(e.target.value as typeof algorithm)}
                >
                  <option>SHA-1</option>
                  <option>SHA-256</option>
                  <option>SHA-512</option>
                </select>
              </label>
              <label>
                Digits
                <select value={digits} onChange={(e) => setDigits(Number(e.target.value) as 6 | 8)}>
                  <option value={6}>6</option>
                  <option value={8}>8</option>
                </select>
              </label>
              {type === 'totp' ? (
                <label>
                  Period
                  <input
                    type="number"
                    value={period}
                    min={5}
                    max={300}
                    onChange={(e) => setPeriod(Number(e.target.value))}
                  />
                </label>
              ) : (
                <label>
                  Counter
                  <input
                    inputMode="numeric"
                    value={counter}
                    onChange={(e) => setCounter(e.target.value)}
                    maxLength={20}
                  />
                </label>
              )}
            </div>
            {type === 'totp' && (
              <label>
                Unix time (seconds)
                <input
                  value={timestamp}
                  inputMode="numeric"
                  onChange={(e) => setTimestamp(e.target.value)}
                  maxLength={16}
                />
              </label>
            )}
            <button className="button primary full">Calculate codes</button>
          </form>
          {result && (
            <div className="test-results">
              {Object.entries(result).map(([name, code]) => (
                <div key={name} className={name === 'current' ? 'current-result' : ''}>
                  <span>{name}</span>
                  <code dir="ltr">{code}</code>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="settings-card">
          <h3>
            <Braces size={20} />
            Provisioning URI inspector
          </h3>
          <label>
            otpauth URI
            <textarea
              value={uri}
              onChange={(e) => setUri(e.target.value)}
              maxLength={4096}
              spellCheck={false}
              autoComplete="off"
              placeholder="otpauth://totp/…"
            />
          </label>
          <button className="button secondary full" onClick={() => void inspect()}>
            Validate & generate QR
          </button>
          {parsed && (
            <>
              <dl className="details-grid">
                <div>
                  <dt>Service</dt>
                  <dd>{parsed.issuer}</dd>
                </div>
                <div>
                  <dt>Account</dt>
                  <dd>{parsed.account}</dd>
                </div>
                <div>
                  <dt>Algorithm</dt>
                  <dd>{parsed.algorithm}</dd>
                </div>
                <div>
                  <dt>Type</dt>
                  <dd>{parsed.type.toUpperCase()}</dd>
                </div>
              </dl>
              {qr && (
                <img
                  className="generated-qr"
                  src={qr}
                  alt="Sensitive provisioning QR generated locally"
                  width={240}
                  height={240}
                />
              )}
            </>
          )}
        </div>
      </div>
      <div className="settings-card">
        <h3>RFC 6238 reference vector</h3>
        <p>
          Public test fixture, never use for a real account. SHA-1 · 8 digits · 30 seconds · Unix
          time 59.
        </p>
        <button
          className="button secondary"
          onClick={() => {
            setSecret('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
            setAlgorithm('SHA-1');
            setDigits(8);
            setPeriod(30);
            setTimestamp('59');
            setType('totp');
          }}
        >
          Load reference vector · expected 94287082
        </button>
      </div>
      <DeveloperPortal onCloud={onCloud} />
    </section>
  );
}
