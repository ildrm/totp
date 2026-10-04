'use client';
import { useEffect, useState } from 'react';
import { KeyRound, QrCode, Upload } from 'lucide-react';
import { z, pairingSchema, pairingFingerprint, type Pairing, type Envelope } from '@still/core';
import { api, cloudPasskey } from '../lib/cloud';
import { download } from '../lib/download';
import type { VaultController } from '../lib/use-vault';
import { Dialog } from './dialog';
const proposalSchema = pairingSchema
  .omit({ senderId: true, epoch: true })
  .extend({ format: z.literal('still.pairing.v1') })
  .strict();
type Proposal = z.infer<typeof proposalSchema>;
type RemoteVault = { id: string; shared: boolean; epoch: number; key_id: string; role: string };
type Relay = {
  approved_at: string | null;
  context: (Pairing & { senderPublicKey: JsonWebKey }) | null;
  envelope: Envelope | null;
};
export function DevicePairing({
  vault,
  deviceId,
  notify,
}: {
  vault: VaultController;
  deviceId: string;
  notify: (message: string) => void;
}) {
  const [mode, setMode] = useState<'request' | 'approve' | null>(null),
    [remote, setRemote] = useState<RemoteVault[]>([]),
    [selected, setSelected] = useState(''),
    [proposal, setProposal] = useState<Proposal | null>(null),
    [qr, setQr] = useState(''),
    [payload, setPayload] = useState(''),
    [passphrase, setPassphrase] = useState(''),
    [fingerprint, setFingerprint] = useState(''),
    [relay, setRelay] = useState<Relay | null>(null),
    [approved, setApproved] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [recovery, setRecovery] = useState(''),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    void api<RemoteVault[]>('vaults')
      .then((v) => {
        setRemote(v);
        if (v[0]) setSelected(v[0].id);
      })
      .catch(() => {});
  }, []);
  useEffect(() => () => setPassphrase(''), []);
  function close() {
    setMode(null);
    setProposal(null);
    setQr('');
    setPayload('');
    setPassphrase('');
    setFingerprint('');
    setRelay(null);
    setApproved(false);
    setConfirmed(false);
    setError('');
  }
  async function request() {
    setBusy(true);
    setError('');
    try {
      await cloudPasskey('reauth');
      const data = await vault.command({ type: 'pairBegin' });
      const p = await api<Omit<Proposal, 'format'>>('pairings', {
        vaultId: selected,
        publicKey: { kty: 'EC', crv: 'P-256', x: data.publicKey!.x, y: data.publicKey!.y },
      });
      const proposal = proposalSchema.parse({ ...p, format: 'still.pairing.v1' });
      setProposal(proposal);
      const QR = await import('qrcode');
      setQr(await QR.toDataURL(JSON.stringify(proposal), { width: 280, margin: 2 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not request pairing.');
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      setError('Choose a QR image smaller than 5 MB.');
      return;
    }
    let url: string | undefined;
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width * bitmap.height > 16000000) {
        bitmap.close();
        throw new Error();
      }
      bitmap.close();
      url = URL.createObjectURL(file);
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      const result = await new BrowserQRCodeReader().decodeFromImageUrl(url);
      setPayload(result.getText());
    } catch {
      setError('No readable pairing QR found.');
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }
  async function approve(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (payload.length > 4096) throw new Error('Pairing request too large.');
      const p = proposalSchema.parse(JSON.parse(payload));
      const target = remote.find((v) => v.id === p.vaultId);
      if (!target) throw new Error('Your account cannot access this vault.');
      if (p.recipientId === deviceId) throw new Error('Use a different trusted device to approve.');
      await cloudPasskey('reauth');
      const { format: _format, ...fields } = p;
      const context: Pairing = { ...fields, senderId: deviceId, epoch: target.epoch };
      const data = await vault.command({ type: 'pairApprove', context, passphrase });
      setPassphrase('');
      await api(`pairings/${p.transactionId}/approve`, {
        context,
        envelope: data.envelope,
        senderPublicKey: { kty: 'EC', crv: 'P-256', x: data.publicKey!.x, y: data.publicKey!.y },
      });
      setFingerprint(data.fingerprint!);
      setApproved(true);
    } catch (e) {
      setError(
        e instanceof Error && e.name !== 'ZodError' ? e.message : 'Invalid pairing request.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function check() {
    if (!proposal) return;
    setBusy(true);
    setError('');
    try {
      const r = await api<Relay>(`pairings/${proposal.transactionId}`);
      if (!r.approved_at || !r.context || !r.envelope) {
        notify('Waiting for the trusted device to approve.');
        return;
      }
      const { senderPublicKey, ...context } = r.context;
      const parsed = pairingSchema.parse(context);
      if (
        parsed.transactionId !== proposal.transactionId ||
        parsed.recipientId !== deviceId ||
        parsed.vaultId !== proposal.vaultId ||
        parsed.expiresAt !== proposal.expiresAt ||
        parsed.publicKey.x !== proposal.publicKey.x ||
        parsed.publicKey.y !== proposal.publicKey.y
      )
        throw new Error('Pairing response does not match this request.');
      setRelay(r);
      setFingerprint(await pairingFingerprint(senderPublicKey, proposal.publicKey, parsed));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pairing failed.');
    } finally {
      setBusy(false);
    }
  }
  async function receive(e: React.FormEvent) {
    e.preventDefault();
    if (!relay?.context || !relay.envelope || !confirmed) return;
    setBusy(true);
    setError('');
    try {
      const { senderPublicKey, ...context } = relay.context;
      const target = remote.find((v) => v.id === context.vaultId);
      if (!target) throw new Error('Vault no longer authorized.');
      const data = await vault.command({
        type: 'pairReceive',
        context,
        senderPublicKey,
        envelope: relay.envelope,
        keyId: target.key_id,
        passphrase,
        kind: target.shared ? 'shared' : 'personal',
        fingerprint,
      });
      setRecovery(data.recovery!);
      setPassphrase('');
      setMode(null);
      setProposal(null);
      notify('Vault key received locally. Save recovery material and sync encrypted records.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not authenticate pairing.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="settings-card">
        <h3>
          <QrCode size={18} />
          Pair a trusted device
        </h3>
        <p>
          Transfer a vault key through an authenticated local handshake. The server relays an
          encrypted envelope. Compare the verification fingerprint on both devices.
        </p>
        <div className="cloud-actions">
          <button
            className="button secondary"
            onClick={() => {
              close();
              setMode('request');
            }}
          >
            Receive a vault on this device
          </button>
          <button
            className="button secondary"
            onClick={() => {
              close();
              setMode('approve');
            }}
          >
            Approve another device
          </button>
        </div>
      </div>
      {mode && (
        <Dialog
          title={mode === 'request' ? 'Receive a vault securely' : 'Approve a trusted device'}
          onClose={close}
        >
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {mode === 'request' ? (
            <>
              {!proposal ? (
                <>
                  <p className="muted">
                    Choose a vault your cloud account is authorized to access. Your other local
                    vaults are preserved.
                  </p>
                  <label>
                    Vault
                    <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                      {remote.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.shared ? 'Shared' : 'Personal'} vault · {v.id.slice(0, 8)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="button primary full"
                    disabled={busy || !selected}
                    onClick={() => void request()}
                  >
                    Generate pairing QR
                  </button>
                </>
              ) : (
                <>
                  <p className="muted">
                    On your trusted device, select this vault and scan or upload this QR. This
                    request expires after 3 minutes.
                  </p>
                  {qr && (
                    <img
                      className="generated-qr"
                      src={qr}
                      width={280}
                      height={280}
                      alt="Public device pairing request QR"
                    />
                  )}
                  <button
                    className="button secondary full"
                    onClick={() => download('still-pairing.json', JSON.stringify(proposal))}
                  >
                    Download public pairing request
                  </button>
                  <button
                    className="button primary full"
                    disabled={busy}
                    onClick={() => void check()}
                  >
                    Check for approval
                  </button>
                  {relay && (
                    <form onSubmit={receive}>
                      <p className="warning">
                        Compare this fingerprint with the trusted device. Continue only if every
                        group matches.
                      </p>
                      <code className="recovery-key" dir="ltr">
                        {fingerprint}
                      </code>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          required
                          checked={confirmed}
                          onChange={(e) => setConfirmed(e.target.checked)}
                        />
                        The fingerprints match on both devices.
                      </label>
                      <label>
                        New local vault passphrase
                        <input
                          type="password"
                          required
                          minLength={15}
                          maxLength={1024}
                          autoComplete="new-password"
                          value={passphrase}
                          onChange={(e) => setPassphrase(e.target.value)}
                        />
                      </label>
                      <button className="button primary full" disabled={busy || !confirmed}>
                        Receive & protect vault key
                      </button>
                    </form>
                  )}
                </>
              )}
            </>
          ) : approved ? (
            <>
              <p className="inline-notice">
                Encrypted key sent. The receiving device must verify this fingerprint.
              </p>
              <code className="recovery-key" dir="ltr">
                {fingerprint}
              </code>
              <button className="button primary full" onClick={close}>
                Done
              </button>
            </>
          ) : (
            <form onSubmit={approve}>
              <p className="muted">
                Select the requested vault before approving. Obtain the QR directly from the new
                device, then compare fingerprints.
              </p>
              <label>
                Public pairing request
                <textarea
                  required
                  value={payload}
                  onChange={(e) => setPayload(e.target.value)}
                  maxLength={4096}
                  spellCheck={false}
                />
              </label>
              <label className="button secondary upload-label">
                <Upload size={15} />
                Upload pairing QR
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/json,.json"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.type === 'application/json' || file.name.endsWith('.json')) {
                      if (file.size > 4096) {
                        setError('Pairing file too large.');
                        return;
                      }
                      void file.text().then(setPayload);
                    } else void upload(file);
                  }}
                />
              </label>
              <label>
                Confirm this vault’s passphrase
                <input
                  required
                  type="password"
                  autoComplete="current-password"
                  maxLength={1024}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                />
              </label>
              <button className="button primary full" disabled={busy}>
                Approve encrypted key transfer
              </button>
            </form>
          )}
        </Dialog>
      )}
      {recovery && (
        <Dialog
          title="Save your new recovery key"
          onClose={() => {
            if (saved) setRecovery('');
          }}
        >
          <KeyRound size={26} className="violet-text" />
          <p className="warning">
            This key unlocks the paired vault on this device. Save it separately from encrypted
            backups.
          </p>
          <code className="recovery-key" dir="ltr">
            {recovery}
          </code>
          <button
            className="button secondary full"
            onClick={() =>
              download(
                'still-paired-recovery.txt',
                `STILL RECOVERY KIT\nVault: ${vault.header?.vaultId}\nRecovery: ${recovery}\n`,
                'text/plain',
              )
            }
          >
            Download recovery kit
          </button>
          <label className="checkbox-label">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />I
            saved this key safely.
          </label>
          <button className="button primary full" disabled={!saved} onClick={() => setRecovery('')}>
            Continue to encrypted sync
          </button>
        </Dialog>
      )}
    </>
  );
}
