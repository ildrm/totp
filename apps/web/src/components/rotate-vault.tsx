'use client';
import { useState } from 'react';
import type { VaultController } from '../lib/use-vault';
import { api, cloudPasskey, syncVault } from '../lib/cloud';
import { exclusive } from '../lib/vault-client';
import { download } from '../lib/download';
import { Dialog } from './dialog';
export function RotateVault({
  vault,
  memberId,
  onClose,
  onDone,
}: {
  vault: VaultController;
  memberId: string | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const [passphrase, setPassphrase] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [recovery, setRecovery] = useState(''),
    [saved, setSaved] = useState(false);
  async function rotate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await cloudPasskey('reauth');
      const remote = (await api<{ id: string; key_id: string }[]>('vaults')).find(
        (v) => v.id === vault.header!.vaultId,
      );
      if (remote && remote.key_id !== vault.header!.keyId) {
        const resumed = await vault.command({
          type: 'commitRotation',
          passphrase,
          expectedKeyId: remote.key_id,
        });
        setRecovery(resumed.recovery!);
        setPassphrase('');
        return;
      }
      const result = await exclusive(() => syncVault());
      if (result.conflicts.length) throw new Error('Resolve sync conflicts before rotating keys.');
      await vault.command({ type: 'reload' });
      const data = await vault.command({ type: 'prepareRotation', passphrase });
      await api(`vaults/${vault.header!.vaultId}/rotate`, {
        ...(memberId ? { removeUserId: memberId } : {}),
        newKeyId: data.preparedHeader!.keyId,
        operations: data.encryptedOperations!,
        envelopes: [],
      });
      const committed = await vault.command({
        type: 'commitRotation',
        passphrase,
        expectedKeyId: data.preparedHeader!.keyId,
      });
      setRecovery(committed.recovery!);
      setPassphrase('');
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Rotation failed. Your encrypted preparation remains recoverable locally.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={
        recovery
          ? 'Save the rotated recovery key'
          : memberId
            ? 'Remove member & rotate keys'
            : 'Rotate this vault key'
      }
      onClose={() => {
        if (!busy && (!recovery || saved)) onClose();
      }}
    >
      {recovery ? (
        <>
          <p className="warning">
            Future vault state uses a new key. Remaining devices must pair again. Previously copied
            seeds and old backups remain decryptable with their old keys.
          </p>
          <code className="recovery-key" dir="ltr">
            {recovery}
          </code>
          <button
            className="button secondary full"
            onClick={() =>
              download(
                'still-rotated-recovery.txt',
                `STILL ROTATED RECOVERY KIT\nVault: ${vault.header?.vaultId}\nRecovery: ${recovery}\n`,
                'text/plain',
              )
            }
          >
            Download new recovery kit
          </button>
          <label className="checkbox-label">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />I
            saved the new recovery key.
          </label>
          <button className="button primary full" disabled={!saved} onClick={onDone}>
            Finish & make a new backup
          </button>
        </>
      ) : (
        <form onSubmit={rotate}>
          <p className="warning">
            Make an encrypted backup first. This re-encrypts future state and removes old device
            envelopes. Remaining trusted devices need fresh pairing. Rotate OTP setup keys at their
            services to revoke previously copied seeds.
          </p>
          <label>
            Confirm vault passphrase
            <input
              required
              type="password"
              maxLength={1024}
              autoComplete="current-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="button danger full" disabled={busy || vault.busy}>
            {busy
              ? 'Rotating encrypted state…'
              : memberId
                ? 'Remove member & rotate'
                : 'Rotate key'}
          </button>
        </form>
      )}
    </Dialog>
  );
}
