'use client';
import { useState } from 'react';
import { Download, FileLock2, Upload } from 'lucide-react';
import { backupSchema, type Backup } from '@still/core';
import type { VaultController } from '../lib/use-vault';
import { download } from '../lib/download';
import { Dialog } from './dialog';
export function BackupDialog({
  vault,
  mode,
  onClose,
  onDone,
}: {
  vault: VaultController;
  mode: 'export' | 'restore';
  onClose: () => void;
  onDone: () => void;
}) {
  const [passphrase, setPassphrase] = useState(''),
    [method, setMethod] = useState<'passphrase' | 'recovery'>('passphrase'),
    [backup, setBackup] = useState<Backup | null>(null),
    [error, setError] = useState(''),
    [confirmed, setConfirmed] = useState(false);
  const [scope, setScope] = useState('all'),
    [selected, setSelected] = useState<string[]>([]);
  async function load(file: File) {
    if (file.size > 24 * 1024 * 1024) {
      setError('Backup exceeds the 24 MB limit.');
      return;
    }
    try {
      setBackup(backupSchema.parse(JSON.parse(await file.text())));
      setError('');
    } catch {
      setError('This file is not a supported encrypted Still backup.');
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (mode === 'export') {
        const ids =
          scope === 'all'
            ? undefined
            : scope === 'selected'
              ? selected
              : vault.records.filter((r) => `folder:${r.folder}` === scope).map((r) => r.id);
        if (ids && !ids.length) throw new Error('Select at least one account.');
        const data = await vault.command({ type: 'backup', passphrase, ids });
        if (data.backup) {
          download(
            `still-${new Date().toISOString().slice(0, 10)}.otpvault`,
            JSON.stringify(data.backup),
          );
          if (scope === 'all')
            await vault.command({
              type: 'settings',
              settings: { ...vault.settings, lastBackup: new Date().toISOString() },
            });
        }
      } else {
        if (!backup) throw new Error('Choose an encrypted backup first.');
        await vault.command({ type: 'restore', backup, credential: passphrase, method });
      }
      setPassphrase('');
      onDone();
      onClose();
    } catch (e) {
      setError(
        e instanceof Error && e.name !== 'ZodError'
          ? e.message
          : 'The backup could not be authenticated. Check your credentials and file.',
      );
    }
  }
  async function exportQuarantine() {
    try {
      const data = await vault.command({ type: 'quarantineExport', passphrase });
      download('still-encrypted-recovery-archive.json', JSON.stringify(data.quarantine));
    } catch {
      setError('Confirm your passphrase to export the encrypted recovery archive.');
    }
  }
  return (
    <Dialog
      title={mode === 'export' ? 'Back up your peace of mind.' : 'Restore your encrypted vault'}
      onClose={() => {
        if (!vault.busy) onClose();
      }}
    >
      <div className="symbol">
        <FileLock2 size={25} />
      </div>
      <p className="muted">
        {mode === 'export'
          ? 'Your accounts and their metadata remain encrypted. Store this backup somewhere safe, along with your recovery kit in a separate place.'
          : 'Restoration happens entirely on this device. Every record is authenticated before the existing vault is replaced.'}
      </p>
      <form onSubmit={submit}>
        {mode === 'export' && vault.corrupt.length > 0 && (
          <div className="warning">
            <p>
              Unreadable records stay on this device. Preserve the encrypted recovery archive before
              restoring a known-good backup. This archive is for expert recovery; it is not a
              verified .otpvault backup.
            </p>
            <button
              className="button secondary"
              type="button"
              disabled={vault.busy || !passphrase}
              onClick={() => void exportQuarantine()}
            >
              Export encrypted recovery archive
            </button>
          </div>
        )}
        {mode === 'export' && (
          <>
            <label>
              Backup scope
              <select value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="all">Whole vault</option>
                <option value="selected">Selected accounts</option>
                {[...new Set(vault.records.map((r) => r.folder))].map((f) => (
                  <option key={f} value={`folder:${f}`}>
                    Folder: {f}
                  </option>
                ))}
              </select>
            </label>
            {scope === 'selected' && (
              <label>
                Accounts to include
                <select
                  multiple
                  size={6}
                  value={selected}
                  onChange={(e) => setSelected([...e.target.selectedOptions].map((o) => o.value))}
                >
                  {vault.records.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.issuer} · {r.account}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {scope !== 'all' && (
              <p className="warning">
                This backup contains only the selected accounts. Restoring it replaces that vault’s
                local contents; keep a complete backup too.
              </p>
            )}
          </>
        )}
        {mode === 'restore' && (
          <>
            <label className="file-drop">
              <Upload size={24} />
              <span>
                {backup
                  ? `${backup.records.filter((r) => r.recordId !== 'settings').length} encrypted accounts · ${new Date(backup.exportedAt).toLocaleDateString()}`
                  : 'Choose a .otpvault backup'}
              </span>
              <input
                required={!backup}
                type="file"
                accept=".otpvault,application/json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void load(f);
                }}
              />
            </label>
            <label>
              Unlock with
              <select
                value={method}
                onChange={(e) => {
                  setMethod(e.target.value as typeof method);
                  setPassphrase('');
                }}
              >
                <option value="passphrase">Backup passphrase</option>
                <option value="recovery">Recovery key</option>
              </select>
            </label>
          </>
        )}
        <label>
          {method === 'recovery' ? 'Recovery key' : 'Confirm vault passphrase'}
          <input
            required
            type={method === 'recovery' ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            maxLength={1024}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </label>
        {mode === 'restore' && vault.header && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              required
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I understand this replaces the encrypted vault on this device.
          </label>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            className="button secondary"
            type="button"
            disabled={vault.busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={vault.busy || (mode === 'restore' && !backup)}
          >
            {mode === 'export' ? <Download size={16} /> : <Upload size={16} />}{' '}
            {vault.busy
              ? 'Authenticating…'
              : mode === 'export'
                ? 'Download encrypted backup'
                : 'Authenticate & restore'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
