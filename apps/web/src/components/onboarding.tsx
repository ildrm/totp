'use client';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  Download,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  WifiOff,
} from 'lucide-react';
import type { VaultController } from '../lib/use-vault';
import { messages, type Locale } from '../lib/i18n';
import { download } from '../lib/download';
export function Onboarding({
  vault,
  locale,
  onRestore,
}: {
  vault: VaultController;
  locale: Locale;
  onRestore: () => void;
}) {
  const t = messages(locale),
    [passphrase, setPassphrase] = useState(''),
    [confirm, setConfirm] = useState(''),
    [method, setMethod] = useState<'passphrase' | 'recovery'>('passphrase'),
    [recovery, setRecovery] = useState(''),
    [saved, setSaved] = useState(false);
  const isNew = vault.status === 'new';
  useEffect(() => {
    if (vault.status === 'locked') {
      setRecovery('');
      setPassphrase('');
      setConfirm('');
    }
  }, [vault.status]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (isNew && passphrase !== confirm) {
      vault.setError('Passphrases do not match.');
      return;
    }
    try {
      if (isNew) {
        const data = await vault.command({ type: 'create', passphrase });
        setRecovery(data.recovery ?? '');
      } else await vault.unlock(passphrase, method);
      setPassphrase('');
      setConfirm('');
    } catch {
      /* The controller owns safe user errors. */
    }
  }
  if (recovery)
    return (
      <section className="recovery-panel">
        <div className="symbol">
          <KeyRound size={28} />
        </div>
        <span className="eyebrow">ONE LAST THING</span>
        <h2>{t.recoveryTitle}</h2>
        <p>{t.recoveryText}</p>
        <div className="recovery-key" dir="ltr">
          {recovery}
        </div>
        <p className="small muted">
          Your passphrase or this key can open a matching encrypted backup. Neither can restore data
          that has been deleted without a backup.
        </p>
        <button
          className="button secondary"
          onClick={() =>
            download(
              'still-recovery-kit.txt',
              `STILL — PRIVATE RECOVERY KIT\n\nVault: ${vault.header?.vaultId}\nRecovery key: ${recovery}\n\nKeep this offline, separate from your encrypted .otpvault backup.\nAnyone with this key and your vault data can decrypt your vault.\n`,
              'text/plain',
            )
          }
        >
          <Download size={17} />
          {t.download}
        </button>
        <label className="checkbox-label">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          {t.saved}
        </label>
        <button className="button primary" disabled={!saved} onClick={() => setRecovery('')}>
          {t.ready}
          <ArrowRight size={17} />
        </button>
      </section>
    );
  if (vault.status === 'unlocked') return null;
  return (
    <section className="onboarding">
      <div className="welcome-panel">
        <span className="eyebrow">
          <Sparkles size={14} /> SIMPLE. SECURE. YOURS.
        </span>
        <h2>{t.welcome}</h2>
        <p>{t.welcomeText}</p>
        <div className="vault-illustration" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="floating-dot dot-one" />
          <div className="floating-dot dot-two" />
          <div className="shield-tile">
            <ShieldCheck size={65} strokeWidth={1.35} />
          </div>
          <div className="mini-code">
            <div className="mini-service">
              <span className="mini-logo">S</span>
              <span>
                Secure account<small>Always close at hand</small>
              </span>
              <Check size={15} />
            </div>
            <div className="mini-digits">
              ••• <span>•••</span>
            </div>
            <div className="mini-progress" />
          </div>
          <div className="privacy-seal">
            <LockKeyhole size={13} /> End-to-end local encryption
          </div>
        </div>
        <div className="welcome-features">
          <span>
            <WifiOff size={17} />
            {t.offline}
          </span>
          <span>
            <ShieldCheck size={17} />
            {t.private}
          </span>
          <span>
            <Check size={17} />
            {t.noAccount}
          </span>
        </div>
      </div>
      <div className="unlock-panel">
        <div className="symbol">
          <LockKeyhole size={24} />
        </div>
        <h2>{isNew ? t.create : t.unlock}</h2>
        <p className="muted">
          {isNew ? t.protection : 'Welcome back. Everything is right where you left it.'}
        </p>
        <form onSubmit={submit}>
          <label>
            {method === 'recovery' ? t.recovery : t.passphrase}
            <input
              autoFocus
              type={method === 'recovery' ? 'text' : 'password'}
              autoComplete={isNew ? 'new-password' : 'current-password'}
              spellCheck={false}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              minLength={isNew ? 15 : 1}
              maxLength={1024}
              required
              placeholder={isNew ? 'A few words only you know' : 'Enter your vault passphrase'}
            />
          </label>
          {isNew && (
            <>
              <p className="field-hint">{t.passHint}</p>
              <label>
                {t.confirm}
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  maxLength={1024}
                  required
                />
              </label>
            </>
          )}
          {vault.error && (
            <p className="error" role="alert">
              {vault.error}
            </p>
          )}
          <button
            className="button primary full"
            disabled={vault.busy || vault.status === 'loading'}
          >
            {vault.busy ? t.unlocking : isNew ? t.continue : t.unlock}
            <ArrowRight size={17} />
          </button>
        </form>
        {!isNew && (
          <button
            className="text-button"
            onClick={() => {
              setMethod(method === 'passphrase' ? 'recovery' : 'passphrase');
              setPassphrase('');
              vault.setError('');
            }}
          >
            {method === 'passphrase' ? 'Use a recovery key' : 'Use your passphrase'}
          </button>
        )}
        <div className="onboarding-divider">
          <span>or</span>
        </div>
        <button className="text-button" onClick={onRestore}>
          {t.restore}
        </button>
        <p className="unlock-footnote">
          <LockKeyhole size={13} /> Your passphrase never leaves this device.
        </p>
      </div>
    </section>
  );
}
