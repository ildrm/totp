'use client';
import {
  Check,
  Clock,
  Download,
  HardDrive,
  KeyRound,
  ShieldCheck,
  WifiOff,
  ArrowUpRight,
  LockKeyhole,
} from 'lucide-react';
import type { VaultController } from '../lib/use-vault';
export function Security({
  vault,
  onBackup,
  onCloud,
}: {
  vault: VaultController;
  onBackup: () => void;
  onCloud: () => void;
}) {
  const last = vault.settings.lastBackup,
    stale = !last || Date.now() - Date.parse(last) > 30 * 86400000;
  return (
    <section className="feature-page">
      <div className="section-heading">
        <span className="eyebrow">A CLEARER PICTURE</span>
        <h2>Your security, at a glance.</h2>
        <p className="muted">A few small habits make a meaningful difference.</p>
      </div>
      <div className="security-banner">
        <div className="symbol">
          <ShieldCheck size={29} />
        </div>
        <div>
          <h3>Your vault is protected</h3>
          <p>Encrypted on this device. Unlocking and code generation happen locally.</p>
        </div>
        <span className="pill green-pill">
          <Check size={13} />
          Active
        </span>
      </div>
      <div className="security-grid">
        <div className="settings-card">
          <ShieldCheck className="violet-text" size={24} />
          <h3>Vault encryption</h3>
          <p>AES-256-GCM authenticated encryption, with a separate random 256-bit vault key.</p>
          <span className="status-line">
            <Check size={14} />
            Enabled
          </span>
        </div>
        <div className="settings-card">
          <KeyRound className="violet-text" size={24} />
          <h3>Passphrase protection</h3>
          <p>
            Argon2id · {Math.round((vault.header?.kdf.memory ?? 65536) / 1024)} MiB memory ·{' '}
            {vault.header?.kdf.iterations ?? 3} iterations. Your passphrase stays on this device.
          </p>
          <span className="status-line">
            <Check size={14} />
            Recovery configured
          </span>
        </div>
        <div className="settings-card">
          <Download className="violet-text" size={24} />
          <h3>Encrypted backups</h3>
          <p>
            {last
              ? `Last backup: ${new Date(last).toLocaleDateString()}`
              : 'Create your first backup so browser storage loss doesn’t mean account loss.'}
          </p>
          <button className="text-button" onClick={onBackup}>
            {stale ? 'Make a backup' : 'Download another backup'}
            <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="settings-card">
          <Clock className="violet-text" size={24} />
          <h3>Device clock</h3>
          <p>
            Codes use your device time. Enable automatic date and time in your operating system.
          </p>
          <time className="clock-display">{new Date(vault.now * 1000).toLocaleTimeString()}</time>
        </div>
      </div>
      <div className="settings-card horizontal-card">
        <div>
          <LockKeyhole size={22} />
          <h3>Cloud account & passkeys</h3>
          <p>
            Optional encrypted sync. A cloud login grants access to ciphertext; it does not unlock
            your vault.
          </p>
        </div>
        <button className="button secondary" onClick={onCloud}>
          Manage cloud account
          <ArrowUpRight size={15} />
        </button>
      </div>
      <div className="security-note">
        <WifiOff size={20} />
        <div>
          <h3>Ready when the internet isn’t.</h3>
          <p>
            Install the app and create an encrypted backup. Your vault works offline after the app
            shell is cached.
          </p>
        </div>
      </div>
      <div className="security-note">
        <HardDrive size={20} />
        <div>
          <h3>A browser is part of your security boundary.</h3>
          <p>
            Malware, malicious extensions, or code running on this origin can access an unlocked
            vault. TOTP can be phished; choose passkeys where your services support them.
          </p>
        </div>
      </div>
    </section>
  );
}
