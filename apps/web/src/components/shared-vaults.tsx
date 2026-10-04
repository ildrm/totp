'use client';
import { useEffect, useState } from 'react';
import { ArrowUpRight, KeyRound, Plus, Users } from 'lucide-react';
import type { VaultController } from '../lib/use-vault';
import { api, cloudPasskey } from '../lib/cloud';
import { download } from '../lib/download';
import { Dialog } from './dialog';
import { RotateVault } from './rotate-vault';
type RemoteVault = {
  id: string;
  shared: boolean;
  epoch: number;
  key_id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
};
export function SharedVaults({
  vault,
  onOpenCloud,
  onOpenVault,
  notify,
}: {
  vault: VaultController;
  onOpenCloud: () => void;
  onOpenVault: () => void;
  notify: (message: string) => void;
}) {
  const [remote, setRemote] = useState<RemoteVault[]>([]),
    [creating, setCreating] = useState(false),
    [passphrase, setPassphrase] = useState(''),
    [confirm, setConfirm] = useState(''),
    [recovery, setRecovery] = useState(''),
    [saved, setSaved] = useState(false),
    [error, setError] = useState(''),
    [members, setMembers] = useState<{ user_id: string; role: string }[]>([]),
    [user, setUser] = useState(''),
    [role, setRole] = useState<'admin' | 'member' | 'viewer'>('member'),
    [busy, setBusy] = useState(false);
  const current = remote.find((r) => r.id === vault.header?.vaultId),
    localShared = vault.headers.filter((h) => h.kind === 'shared');
  const [rotateMember, setRotateMember] = useState<string | null>(null);
  useEffect(() => {
    void api<RemoteVault[]>('vaults')
      .then(setRemote)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (current?.shared)
      void api<typeof members>(`vaults/${current.id}/members`)
        .then(setMembers)
        .catch(() => {});
  }, [current?.id, current?.shared]);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (passphrase !== confirm) {
      setError('Passphrases do not match.');
      return;
    }
    setBusy(true);
    try {
      await cloudPasskey('reauth');
      const data = await vault.command({ type: 'createShared', passphrase });
      setRecovery(data.recovery!);
      setPassphrase('');
      setConfirm('');
      setCreating(false);
      await api('vaults', { id: data.header!.vaultId, keyId: data.header!.keyId, shared: true });
      setRemote(await api<RemoteVault[]>('vaults'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create shared vault.');
    } finally {
      setBusy(false);
    }
  }
  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!current) return;
    setError('');
    setBusy(true);
    try {
      await cloudPasskey('reauth');
      await api(`vaults/${current.id}/members`, { userId: user, role });
      setUser('');
      setMembers(await api(`vaults/${current.id}/members`));
      notify('Member added. Pair their device to deliver the vault key securely.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not invite member.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="feature-page">
      <div className="section-heading">
        <span className="eyebrow">A LITTLE MORE TOGETHER</span>
        <h2>A shared space, with its own protection.</h2>
        <p className="muted">
          Every shared vault has an independent key. Your personal vault remains separate.
        </p>
      </div>
      <div className="inline-notice">
        <Users size={17} />
        People who can generate shared codes can access the underlying seeds on their device. Prefer
        individual passkeys when services support them.
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="settings-card">
        <h3>
          <Users size={20} />
          Shared vaults on this device
        </h3>
        {localShared.length ? (
          localShared.map((h) => (
            <div className="device-row" key={h.vaultId}>
              <div>
                <strong>Shared vault · {h.vaultId.slice(0, 8)}</strong>
                <p>Independent passphrase and recovery key</p>
              </div>
              <button
                className="button secondary"
                onClick={() =>
                  void vault
                    .switchVault(h.vaultId)
                    .then(onOpenVault)
                    .catch((e) => setError(e.message))
                }
              >
                Open
                <ArrowUpRight size={14} />
              </button>
            </div>
          ))
        ) : (
          <p>No shared vaults yet. Sign in to a cloud account to create one.</p>
        )}
        <div className="cloud-actions">
          <button className="button primary" onClick={() => setCreating(true)}>
            <Plus size={16} />
            Create shared vault
          </button>
          <button className="button secondary" onClick={onOpenCloud}>
            Cloud account & pairing
          </button>
        </div>
      </div>
      {current?.shared && (
        <div className="settings-card">
          <h3>Members · {current.role}</h3>
          {members.map((m) => (
            <div className="device-row" key={m.user_id}>
              <span className="cloud-device-id">{m.user_id}</span>
              <span className="pill">{m.role}</span>
              {m.role !== 'owner' &&
                (current.role === 'owner' || (current.role === 'admin' && m.role !== 'admin')) && (
                  <button
                    className="button danger-outline"
                    onClick={() => setRotateMember(m.user_id)}
                  >
                    Remove & rotate
                  </button>
                )}
            </div>
          ))}
          {['owner', 'admin'].includes(current.role) && (
            <form onSubmit={invite}>
              <label>
                Member cloud account ID
                <input
                  required
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  maxLength={36}
                  placeholder="UUID from their cloud account screen"
                />
              </label>
              <label>
                Role
                <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                  {current.role === 'owner' && (
                    <option value="admin">Admin · manage members</option>
                  )}
                  <option value="member">Member · read and write</option>
                  <option value="viewer">Viewer · read only</option>
                </select>
              </label>
              <button className="button primary full" disabled={busy}>
                Add member
              </button>
            </form>
          )}
          <p className="field-hint">
            Membership grants access to ciphertext. Transfer the independent key using device
            pairing. Removing access rotates the encryption key. Keep an encrypted backup first.
          </p>
          {['owner', 'admin'].includes(current.role) && (
            <button className="button secondary" onClick={() => setRotateMember('')}>
              Rotate vault key
            </button>
          )}
        </div>
      )}
      {creating && (
        <Dialog
          title="Create a shared vault"
          onClose={() => {
            if (busy) return;
            setCreating(false);
            setPassphrase('');
            setConfirm('');
          }}
        >
          <p className="muted">
            Choose a separate passphrase. A new 256-bit key will be generated on this device.
          </p>
          <form onSubmit={create}>
            <label>
              Shared vault passphrase
              <input
                required
                type="password"
                minLength={15}
                maxLength={1024}
                autoComplete="new-password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
              />
            </label>
            <label>
              Confirm passphrase
              <input
                required
                type="password"
                maxLength={1024}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary full" disabled={busy || vault.busy}>
              Create independent vault
            </button>
          </form>
        </Dialog>
      )}
      {rotateMember !== null && (
        <RotateVault
          vault={vault}
          memberId={rotateMember || undefined}
          onClose={() => setRotateMember(null)}
          onDone={() => {
            setRotateMember(null);
            notify('Vault key rotated. Save a new encrypted backup and pair remaining devices.');
            void api<typeof members>(`vaults/${current!.id}/members`)
              .then(setMembers)
              .catch(() => {});
          }}
        />
      )}
      {recovery && (
        <Dialog
          title="Save the shared vault recovery key"
          onClose={() => {
            if (saved) setRecovery('');
          }}
        >
          <div className="symbol">
            <KeyRound size={24} />
          </div>
          <p className="warning">
            Keep this separate from the encrypted backup. Anyone with the key and vault data can
            decrypt it.
          </p>
          <code className="recovery-key" dir="ltr">
            {recovery}
          </code>
          <button
            className="button secondary full"
            onClick={() =>
              download(
                'still-shared-recovery.txt',
                `STILL SHARED VAULT RECOVERY\nVault: ${vault.header?.vaultId}\nRecovery: ${recovery}\n`,
                'text/plain',
              )
            }
          >
            Download recovery kit
          </button>
          <label className="checkbox-label">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />I
            saved the recovery key separately.
          </label>
          <button
            className="button primary full"
            disabled={!saved}
            onClick={() => {
              setRecovery('');
              onOpenVault();
            }}
          >
            Open shared vault
          </button>
        </Dialog>
      )}
    </section>
  );
}
