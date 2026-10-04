'use client';
import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  Cloud,
  KeyRound,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {
  api,
  cloudPasskey,
  syncVault,
  loadSyncConflicts,
  resolveSyncConflict,
  type SyncConflict,
} from '../lib/cloud';
import { exclusive } from '../lib/vault-client';
import { DevicePairing } from './device-pairing';
import type { VaultController } from '../lib/use-vault';
type Account = {
  userId: string;
  deviceId: string;
  devices: { id: string; name: string; revoked_at: string | null; created_at: string }[];
  passkeys: { id: string; name: string; created_at: string }[];
  events: { kind: string; created_at: string }[];
};
export function CloudAccount({
  vault,
  notify,
}: {
  vault: VaultController;
  notify: (message: string) => void;
}) {
  const [account, setAccount] = useState<Account | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const refresh = () => api<Account>('auth/me').then(setAccount);
  useEffect(() => {
    void refresh().catch(() => {});
    void loadSyncConflicts().then(setConflicts);
  }, []);
  async function run(action: () => Promise<unknown>, message: string, refreshAfter = true) {
    setBusy(true);
    setError('');
    try {
      await action();
      if (refreshAfter) await refresh();
      notify(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cloud operation failed.');
    } finally {
      setBusy(false);
    }
  }
  async function sync() {
    setBusy(true);
    setError('');
    try {
      await cloudPasskey('reauth');
      const result = await exclusive(() => syncVault());
      setConflicts(result.conflicts);
      vault.lock();
      notify(
        `${result.uploaded} uploaded, ${result.downloaded} downloaded. Unlock to authenticate synced records.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="feature-page">
      <div className="section-heading">
        <span className="eyebrow">OPTIONAL, ALWAYS</span>
        <h2>Private, wherever you are.</h2>
        <p className="muted">
          Passkeys protect your cloud account. Your vault has its own, separate encryption.
        </p>
      </div>
      <div className="inline-notice">
        <ShieldCheck size={17} />
        Cloud login never provides your vault key or passphrase. Sync sends ciphertext only.
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!account ? (
        <div className="settings-card">
          <Cloud size={28} className="violet-text" />
          <h3>Bring your own peace of mind.</h3>
          <p>
            Keep using Still locally, or create a passkey account to store encrypted records on your
            configured server. Restore an encrypted backup on another device to begin syncing the
            same vault.
          </p>
          <div className="cloud-actions">
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                void run(
                  () => cloudPasskey('register'),
                  'Cloud account created. Your vault remains locally encrypted.',
                )
              }
            >
              <KeyRound size={17} />
              Create with a passkey
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void run(() => cloudPasskey('login'), 'Signed in to your cloud account.')
              }
            >
              <ArrowUpRight size={16} />
              Sign in
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="settings-card">
            <h3>
              <Cloud size={19} />
              Encrypted synchronization
            </h3>
            <p>
              Sync this vault with your cloud account. Conflicting encrypted versions are retained
              rather than overwritten. Make a local backup first.
            </p>
            <div className="cloud-actions">
              <button className="button primary" disabled={busy} onClick={() => void sync()}>
                <RefreshCw size={16} />
                {busy ? 'Working…' : 'Sync encrypted vault'}
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void run(() => cloudPasskey('reauth'), 'Recent passkey verification confirmed.')
                }
              >
                Reauthenticate
              </button>
            </div>
            {conflicts.length > 0 && (
              <p className="warning">
                {conflicts.length} encrypted conflicts retained. Make a backup, then choose the
                version you want to keep.
              </p>
            )}
            {conflicts.map((conflict) => (
              <div className="settings-card" key={conflict.operationId}>
                <p>
                  Conflicting {conflict.id === 'settings' ? 'settings' : 'account'} · revision{' '}
                  {conflict.revision}
                </p>
                <div className="cloud-actions">
                  {(['local', 'remote', 'both'] as const).map((choice) => (
                    <button
                      key={choice}
                      className="button secondary"
                      disabled={
                        busy ||
                        (choice === 'both' && (!conflict.envelope || conflict.id === 'settings'))
                      }
                      onClick={() =>
                        void run(async () => {
                          await exclusive(() => resolveSyncConflict(conflict, choice));
                          setConflicts(await loadSyncConflicts());
                          vault.lock();
                        }, 'Conflict resolved. Unlock to view the authenticated result.')
                      }
                    >
                      {choice === 'local'
                        ? 'Keep local'
                        : choice === 'remote'
                          ? 'Use incoming'
                          : 'Keep both'}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="settings-card">
            <h3>
              <KeyRound size={18} />
              Your passkeys
            </h3>
            {account.passkeys.map((p) => (
              <div className="device-row" key={p.id}>
                <div>
                  <strong>{p.name}</strong>
                  <p>Added {new Date(p.created_at).toLocaleDateString()}</p>
                </div>
                <button
                  className="button danger-outline"
                  disabled={busy || account.passkeys.length <= 1}
                  onClick={() =>
                    void run(async () => {
                      await cloudPasskey('reauth');
                      await api(`auth/passkeys/${encodeURIComponent(p.id)}`, undefined, 'DELETE');
                    }, 'Passkey removed.')
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await cloudPasskey('reauth');
                  await cloudPasskey('add');
                }, 'Passkey added.')
              }
            >
              Add another passkey
              <ArrowUpRight size={14} />
            </button>
          </div>
          <DevicePairing vault={vault} deviceId={account.deviceId} notify={notify} />
          <div className="settings-card">
            <h3>Your devices</h3>
            <p className="cloud-device-id">Account ID: {account.userId}</p>
            {account.devices.map((d) => (
              <div className="device-row" key={d.id}>
                <div>
                  <strong>
                    {d.name}
                    {d.id === account.deviceId ? ' · current' : ''}
                  </strong>
                  <p>
                    {d.revoked_at
                      ? 'Revoked'
                      : `Added ${new Date(d.created_at).toLocaleDateString()}`}
                  </p>
                </div>
                <button
                  className="button danger-outline"
                  disabled={busy || !!d.revoked_at || d.id === account.deviceId}
                  onClick={() =>
                    void run(async () => {
                      await cloudPasskey('reauth');
                      await api(`auth/devices/${d.id}/revoke`, {});
                    }, 'Device revoked. Previously copied secrets cannot be erased.')
                  }
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
          <div className="settings-card">
            <h3>Recent security events</h3>
            {account.events.map((event, i) => (
              <div className="device-row" key={i}>
                <span>{event.kind.replaceAll('.', ' ')}</span>
                <p>{new Date(event.created_at).toLocaleString()}</p>
              </div>
            ))}
          </div>
          <div className="cloud-actions">
            <button
              className="button secondary"
              onClick={() =>
                void api('auth/logout', {})
                  .then(() => {
                    setAccount(null);
                    vault.lock();
                    notify('Cloud session ended.');
                  })
                  .catch(() => {})
              }
            >
              <LogOut size={16} />
              Sign out
            </button>
            <button
              className="button danger-outline"
              disabled={busy}
              onClick={() =>
                void run(
                  async () => {
                    await cloudPasskey('reauth');
                    if (
                      !window.confirm(
                        'Delete your cloud account, passkeys, and cloud ciphertext? Local vault data stays on this device.',
                      )
                    )
                      throw new Error('Cloud account deletion canceled.');
                    await api('auth/account', undefined, 'DELETE');
                    setAccount(null);
                    vault.lock();
                  },
                  'Cloud account deleted.',
                  false,
                )
              }
            >
              <Trash2 size={16} />
              Delete cloud account
            </button>
          </div>
        </>
      )}
    </section>
  );
}
