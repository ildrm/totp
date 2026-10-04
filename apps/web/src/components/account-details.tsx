'use client';
import { useEffect, useState } from 'react';
import { Archive, Eye, Trash2 } from 'lucide-react';
import type { PublicRecord } from '@still/core';
import type { VaultController } from '../lib/use-vault';
import { Dialog } from './dialog';
export function AccountDetails({
  record,
  vault,
  onClose,
}: {
  record: PublicRecord;
  vault: VaultController;
  onClose: () => void;
}) {
  const [passphrase, setPassphrase] = useState(''),
    [secret, setSecret] = useState(''),
    [qr, setQr] = useState(''),
    [action, setAction] = useState<'reveal' | 'delete' | null>(null),
    [error, setError] = useState('');
  const [folder, setFolder] = useState(record.folder),
    [tags, setTags] = useState(record.tags.join(', ')),
    [aliases, setAliases] = useState(record.aliases.join(', ')),
    [notes, setNotes] = useState(record.notes),
    [order, setOrder] = useState(record.order);
  async function saveMetadata(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await vault.command({
        type: 'update',
        id: record.id,
        changes: {
          folder,
          notes,
          order,
          tags: tags
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean),
          aliases: aliases
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean),
        },
      });
      onClose();
    } catch {
      setError('Check folder, tags, aliases, and ordering limits.');
    }
  }
  useEffect(() => {
    if (!secret) return;
    const timer = setTimeout(() => {
      setSecret('');
      setQr('');
    }, 30000);
    return () => clearTimeout(timer);
  }, [secret]);
  async function perform(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (action === 'delete') {
        await vault.command({ type: 'delete', id: record.id, passphrase });
        onClose();
      } else {
        const data = await vault.command({ type: 'reveal', id: record.id, passphrase });
        setSecret(data.secret ?? '');
        if (data.uri) {
          const QR = await import('qrcode');
          setQr(await QR.toDataURL(data.uri, { width: 240, margin: 2 }));
        }
      }
      setPassphrase('');
      setAction(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not verify passphrase.');
    }
  }
  return (
    <Dialog title={record.issuer} onClose={onClose}>
      <p className="muted">{record.account}</p>
      <dl className="details-grid">
        <div>
          <dt>Type</dt>
          <dd>{record.type.toUpperCase()}</dd>
        </div>
        <div>
          <dt>Algorithm</dt>
          <dd>HMAC-{record.algorithm}</dd>
        </div>
        <div>
          <dt>Code length</dt>
          <dd>{record.digits} digits</dd>
        </div>
        <div>
          <dt>{record.type === 'totp' ? 'Period' : 'Counter'}</dt>
          <dd>{record.type === 'totp' ? `${record.period} seconds` : record.counter}</dd>
        </div>
      </dl>
      {!action && !secret && (
        <form onSubmit={saveMetadata}>
          <label>
            Folder
            <input
              maxLength={64}
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              list="known-folders"
            />
            <datalist id="known-folders">
              <option value="Personal" />
              <option value="Work" />
            </datalist>
          </label>
          <label>
            Tags, separated by commas
            <input maxLength={640} value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
          <label>
            Search aliases, separated by commas
            <input maxLength={1280} value={aliases} onChange={(e) => setAliases(e.target.value)} />
          </label>
          <label>
            Notes
            <textarea maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <label>
            Manual order
            <input
              type="number"
              min={0}
              max={9999}
              value={order}
              onChange={(e) => setOrder(Number(e.target.value))}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary full" disabled={vault.busy}>
            Save account details
          </button>
        </form>
      )}
      {secret && (
        <div className="secret-reveal">
          <p className="warning">
            Anyone with this key can generate your codes. Hides after 30 seconds.
          </p>
          <code dir="ltr">{secret}</code>
          {qr && <img src={qr} width={240} height={240} alt="Sensitive provisioning QR code" />}
          <button
            className="button secondary"
            onClick={() => {
              setSecret('');
              setQr('');
            }}
          >
            Hide now
          </button>
        </div>
      )}
      {action ? (
        <form onSubmit={perform}>
          <p className="warning">
            {action === 'delete'
              ? 'Deleting this account removes it from this vault. Keep a backup or another way to sign in.'
              : 'Revealing a setup key exposes access to this account. Keep it private.'}
          </p>
          <label>
            Confirm vault passphrase
            <input
              autoFocus
              required
              type="password"
              autoComplete="current-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              maxLength={1024}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="button secondary"
              type="button"
              onClick={() => {
                setAction(null);
                setPassphrase('');
              }}
            >
              Cancel
            </button>
            <button
              className={`button ${action === 'delete' ? 'danger' : 'primary'}`}
              disabled={vault.busy}
            >
              {action === 'delete' ? 'Delete account' : 'Reveal for 30 seconds'}
            </button>
          </div>
        </form>
      ) : (
        <div className="details-actions">
          <button
            className="button secondary"
            onClick={() =>
              void vault
                .command({ type: 'update', id: record.id, changes: { archived: !record.archived } })
                .then(onClose)
                .catch(() => {})
            }
          >
            <Archive size={16} />
            {record.archived ? 'Move out of archive' : 'Archive account'}
          </button>
          <button className="button secondary" onClick={() => setAction('reveal')}>
            <Eye size={16} />
            Reveal setup key
          </button>
          <button className="button danger-outline" onClick={() => setAction('delete')}>
            <Trash2 size={16} />
            Delete account
          </button>
        </div>
      )}
    </Dialog>
  );
}
