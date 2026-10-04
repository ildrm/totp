'use client';
import { useState } from 'react';
import { Download, EyeOff, Globe, HardDrive, LockKeyhole, Sun, Trash2 } from 'lucide-react';
import type { VaultController } from '../lib/use-vault';
import { localeNames, type Locale } from '../lib/i18n';
import { Dialog } from './dialog';
export type Theme = 'system' | 'light' | 'dark';
export function Settings({
  vault,
  locale,
  setLocale,
  theme,
  setTheme,
  onBackup,
  onRestore,
}: {
  vault: VaultController;
  locale: Locale;
  setLocale: (l: Locale) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  onBackup: () => void;
  onRestore: () => void;
}) {
  const [changing, setChanging] = useState(false),
    [deleting, setDeleting] = useState(false),
    [current, setCurrent] = useState(''),
    [next, setNext] = useState(''),
    [confirm, setConfirm] = useState(''),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [protectionMethod, setProtectionMethod] = useState<'passphrase' | 'recovery'>('passphrase');
  const update = (partial: Partial<typeof vault.settings>) =>
    void vault
      .command({ type: 'settings', settings: { ...vault.settings, ...partial } })
      .catch(() => {});
  async function change(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (next !== confirm) throw new Error('New passphrases do not match.');
      await vault.command({
        type: 'changePassword',
        credential: current,
        method: protectionMethod,
        next,
      });
      setCurrent('');
      setNext('');
      setConfirm('');
      setChanging(false);
      setMessage(
        'Passphrase updated. Make a new encrypted backup. Older backups still use the old passphrase.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change passphrase.');
    }
  }
  async function erase(e: React.FormEvent) {
    e.preventDefault();
    try {
      await vault.erase(current);
      setDeleting(false);
      setCurrent('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete vault.');
    }
  }
  return (
    <section className="feature-page">
      <div className="section-heading">
        <span className="eyebrow">MAKE YOURSELF AT HOME</span>
        <h2>A vault that fits you.</h2>
        <p className="muted">Choose how Still looks and how your vault stays protected.</p>
      </div>
      {message && (
        <p className="inline-notice" role="status">
          {message}
        </p>
      )}
      <div className="settings-card">
        <h3>
          <LockKeyhole size={19} />
          Lock & protection
        </h3>
        <div className="setting-row">
          <div>
            <strong>Auto-lock</strong>
            <p>Lock after this much inactivity.</p>
          </div>
          <select
            aria-label="Auto-lock timeout"
            value={vault.settings.autoLockMinutes}
            onChange={(e) =>
              update({
                autoLockMinutes: Number(e.target.value) as typeof vault.settings.autoLockMinutes,
              })
            }
          >
            <option value={1}>1 minute</option>
            <option value={5}>5 minutes</option>
            <option value={15}>15 minutes</option>
            <option value={60}>1 hour</option>
          </select>
        </div>
        <div className="setting-row">
          <div>
            <strong>Lock when backgrounded</strong>
            <p>Clear codes when you leave this tab.</p>
          </div>
          <input
            type="checkbox"
            aria-label="Lock when backgrounded"
            checked={vault.settings.lockOnHide}
            onChange={(e) => update({ lockOnHide: e.target.checked })}
          />
        </div>
        <div className="setting-row">
          <div>
            <strong>Vault passphrase</strong>
            <p>Update your unlock phrase without re-encrypting every account.</p>
          </div>
          <button
            className="button secondary"
            onClick={() => {
              setError('');
              setChanging(true);
            }}
          >
            Change passphrase
          </button>
        </div>
      </div>
      <div className="settings-card">
        <h3>
          <EyeOff size={19} />
          Privacy & clipboard
        </h3>
        <div className="setting-row">
          <div>
            <strong>Privacy mode</strong>
            <p>Hide codes and account identities.</p>
          </div>
          <input
            type="checkbox"
            aria-label="Privacy mode"
            checked={vault.settings.privacy}
            onChange={(e) => update({ privacy: e.target.checked })}
          />
        </div>
        <div className="setting-row">
          <div>
            <strong>Remember account usage</strong>
            <p>Store usage locally in encrypted records for sorting.</p>
          </div>
          <input
            type="checkbox"
            aria-label="Remember account usage"
            checked={vault.settings.recordUsage}
            onChange={(e) => update({ recordUsage: e.target.checked })}
          />
        </div>
        <div className="setting-row">
          <div>
            <strong>Wait before copying expiring codes</strong>
            <p>Get the next code when less than this time remains.</p>
          </div>
          <select
            aria-label="Copy expiration threshold"
            value={vault.settings.copyThreshold}
            onChange={(e) => update({ copyThreshold: Number(e.target.value) })}
          >
            {[0, 3, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'Never wait' : `${n} seconds`}
              </option>
            ))}
          </select>
        </div>
        <p className="field-hint">
          Clipboard clearing cannot be safely guaranteed by browsers. Still avoids overwriting other
          content. Operating systems may sync clipboard content to other devices.
        </p>
      </div>
      <div className="settings-card">
        <h3>
          <Sun size={19} />
          Appearance & language
        </h3>
        <div className="setting-row">
          <div>
            <strong>Theme</strong>
            <p>Comfortable in every light.</p>
          </div>
          <select
            aria-label="Theme"
            value={theme}
            onChange={(e) => setTheme(e.target.value as Theme)}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        <div className="setting-row">
          <div>
            <strong>
              <Globe size={16} />
              Language
            </strong>
            <p>Core account flows support 12 languages, including RTL.</p>
          </div>
          <select
            aria-label="Language"
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            {Object.entries(localeNames).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="settings-card">
        <h3>
          <Download size={19} />
          Backup & storage
        </h3>
        <div className="setting-row">
          <div>
            <strong>Encrypted backup</strong>
            <p>Your way out of browser storage loss.</p>
          </div>
          <button className="button secondary" onClick={onBackup}>
            Download backup
          </button>
        </div>
        <div className="setting-row">
          <div>
            <strong>Restore a backup</strong>
            <p>Locks the vault before replacing encrypted state.</p>
          </div>
          <button className="button secondary" onClick={onRestore}>
            Restore
          </button>
        </div>
        <div className="setting-row">
          <div>
            <strong>Persistent browser storage</strong>
            <p>Ask the browser to reduce automatic storage eviction.</p>
          </div>
          <button
            className="button secondary"
            onClick={() =>
              void navigator.storage
                ?.persist?.()
                .then((granted) =>
                  setMessage(
                    granted
                      ? 'Persistent storage granted. Backups are still essential.'
                      : 'Browser declined persistent storage. Keep backups current.',
                  ),
                )
            }
          >
            <HardDrive size={16} />
            Request
          </button>
        </div>
      </div>
      <div className="settings-card danger-zone">
        <h3>
          <Trash2 size={19} />
          Delete local vault
        </h3>
        <p>
          Removes encrypted accounts and wrapped keys from this browser. Your external encrypted
          backups remain recoverable.
        </p>
        <button
          className="button danger-outline"
          onClick={() => {
            setError('');
            setCurrent('');
            setDeleting(true);
          }}
        >
          Delete this vault
        </button>
      </div>
      {changing && (
        <Dialog
          title="Change vault passphrase"
          onClose={() => {
            setChanging(false);
            setCurrent('');
            setNext('');
            setConfirm('');
          }}
        >
          <form onSubmit={change}>
            <label>
              Verify with
              <select
                value={protectionMethod}
                onChange={(e) => {
                  setProtectionMethod(e.target.value as typeof protectionMethod);
                  setCurrent('');
                }}
              >
                <option value="passphrase">Current passphrase</option>
                <option value="recovery">Recovery key</option>
              </select>
            </label>
            <label>
              {protectionMethod === 'recovery' ? 'Recovery key' : 'Current passphrase'}
              <input
                required
                type="password"
                autoComplete={protectionMethod === 'recovery' ? 'off' : 'current-password'}
                maxLength={1024}
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </label>
            <label>
              New passphrase
              <input
                required
                type="password"
                autoComplete="new-password"
                minLength={15}
                maxLength={1024}
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </label>
            <label>
              Confirm new passphrase
              <input
                required
                type="password"
                autoComplete="new-password"
                maxLength={1024}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary full" disabled={vault.busy}>
              Update passphrase
            </button>
          </form>
        </Dialog>
      )}
      {deleting && (
        <Dialog
          title="Delete this device’s vault?"
          onClose={() => {
            setDeleting(false);
            setCurrent('');
          }}
        >
          <p className="warning">
            This cannot be undone. Make an encrypted backup and save your recovery kit first.
          </p>
          <form onSubmit={erase}>
            <label>
              Confirm vault passphrase
              <input
                type="password"
                required
                autoComplete="current-password"
                maxLength={1024}
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="button danger full" disabled={vault.busy}>
              Permanently delete local vault
            </button>
          </form>
        </Dialog>
      )}
    </section>
  );
}
