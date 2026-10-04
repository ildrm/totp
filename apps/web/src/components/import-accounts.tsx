'use client';
import { useState } from 'react';
import { previewImport, type ImportPreview } from '@still/core';
import type { VaultController } from '../lib/use-vault';
export function ImportAccounts({
  vault,
  onSaved,
}: {
  vault: VaultController;
  onSaved: () => void;
}) {
  const [preview, setPreview] = useState<ImportPreview | null>(null),
    [duplicates, setDuplicates] = useState<number[]>([]),
    [policy, setPolicy] = useState<'skip' | 'keep' | 'replace'>('skip'),
    [error, setError] = useState(''),
    [confirmed, setConfirmed] = useState(false);
  async function load(file: File) {
    setPreview(null);
    setConfirmed(false);
    setError('');
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Import exceeds 5 MB.');
      const result = previewImport(await file.text(), file.name);
      const data = result.accounts.length
        ? await vault.command({ type: 'previewImport', accounts: result.accounts })
        : {};
      setDuplicates(data.duplicates ?? []);
      setPreview(result);
    } catch (e) {
      setError(
        e instanceof Error && e.name !== 'ZodError' && e.name !== 'SyntaxError'
          ? e.message
          : 'Unsupported or malformed import.',
      );
    }
  }
  async function save() {
    if (!preview || !confirmed) return;
    try {
      await vault.command({ type: 'importBatch', accounts: preview.accounts, duplicates: policy });
      setPreview(null);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    }
  }
  return (
    <section className="batch-import">
      <p className="warning">
        Plaintext exports contain setup keys. Keep the file private and delete it after confirming
        your encrypted backup. Files are processed only on this device.
      </p>
      <label>
        Import accounts file
        <input
          type="file"
          accept=".json,.csv,.txt,application/json,text/csv,text/plain"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void load(file);
            e.target.value = '';
          }}
        />
      </label>
      <p className="field-hint">
        CSV: issuer, account, secret, algorithm, digits, period, type, counter. JSON arrays of OTP
        accounts, plaintext Aegis v1, or one otpauth URI per line. Encrypted native backups use
        Restore in Settings.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <>
          <p>
            {preview.format} · {preview.accounts.length} valid · {duplicates.length} duplicates ·{' '}
            {preview.errors.length} unsupported
          </p>
          <div className="import-preview-list">
            {preview.accounts.map((r, i) => (
              <div className="device-row" key={i}>
                <div>
                  <strong>{r.issuer}</strong>
                  <p>{r.account}</p>
                </div>
                <span className="pill">
                  {duplicates.includes(i) ? 'Duplicate' : r.type.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
          {preview.errors.map((e) => (
            <p className="field-hint" key={e.row}>
              Row {e.row}: {e.message}
            </p>
          ))}
          <label>
            Duplicate accounts
            <select value={policy} onChange={(e) => setPolicy(e.target.value as typeof policy)}>
              <option value="skip">Skip duplicates</option>
              <option value="keep">Keep both</option>
              <option value="replace">Replace matching accounts</option>
            </select>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I reviewed the preview and want to save the supported accounts.
          </label>
          <button
            className="button primary full"
            disabled={!confirmed || !preview.accounts.length || vault.busy}
            onClick={() => void save()}
          >
            Import reviewed accounts
          </button>
        </>
      )}
    </section>
  );
}
