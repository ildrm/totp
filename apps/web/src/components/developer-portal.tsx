'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, cloudPasskey } from '../lib/cloud';
import { download } from '../lib/download';
import { Dialog } from './dialog';
type Application = { id: string; name: string };
type Key = {
  id: string;
  scopes: string[];
  expires_at: string;
  revoked_at: string | null;
  last_used: string | null;
};
type Credential = { id: string; type: string; algorithm: string; active: boolean };
export function DeveloperPortal({ onCloud }: { onCloud: () => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null),
    [applications, setApplications] = useState<Application[]>([]),
    [selected, setSelected] = useState(''),
    [name, setName] = useState(''),
    [keys, setKeys] = useState<Key[]>([]),
    [credentials, setCredentials] = useState<Credential[]>([]),
    [days, setDays] = useState(30),
    [scope, setScope] = useState('verify'),
    [material, setMaterial] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const status = await api<{ enabled: boolean }>('developer/status');
    setEnabled(status.enabled);
    if (status.enabled) {
      const apps = await api<Application[]>('developer/applications');
      setApplications(apps);
      setSelected((previous) => previous || apps[0]?.id || '');
    }
  }, []);
  useEffect(() => {
    void refresh().catch(() => setEnabled(null));
  }, [refresh]);
  useEffect(() => {
    if (selected) {
      void api<Key[]>(`developer/applications/${selected}/keys`)
        .then(setKeys)
        .catch(() => {});
      void api<Credential[]>(`developer/applications/${selected}/credentials`)
        .then(setCredentials)
        .catch(() => {});
    }
  }, [selected, busy]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await cloudPasskey('reauth');
      await action();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verifier administration failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-card">
      <h3>Developer MFA platform</h3>
      <p>
        The optional verifier stores its own encrypted seeds under separate server key management.
        Consumer vault data never enters this service. Use scoped API keys only on your application
        server.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {enabled === null ? (
        <button className="button secondary" onClick={onCloud}>
          Sign in to manage verifier applications
        </button>
      ) : enabled === false ? (
        <p className="inline-notice">
          The server verifier is disabled. Local developer tools remain available.
        </p>
      ) : (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const result = await api<{ id: string }>('developer/applications', { name });
                setSelected(result.id);
                setName('');
              });
            }}
          >
            <label>
              Application name
              <input
                required
                maxLength={64}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button className="button secondary" disabled={busy}>
              Create verifier application
            </button>
          </form>
          {applications.length > 0 && (
            <>
              <label>
                Application
                <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                  {applications.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-grid">
                <label>
                  Key permission
                  <select value={scope} onChange={(e) => setScope(e.target.value)}>
                    <option value="verify">Verify only</option>
                    <option value="enroll">Enroll and confirm only</option>
                    <option value="both">Enroll and verify</option>
                  </select>
                </label>
                <label>
                  Expires in days
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                  />
                </label>
              </div>
              <button
                className="button primary"
                disabled={busy || !selected}
                onClick={() =>
                  void run(async () => {
                    const result = await api<{ id: string; key: string }>(
                      `developer/applications/${selected}/keys`,
                      { days, scopes: scope === 'both' ? ['enroll', 'verify'] : [scope] },
                    );
                    setMaterial(
                      `STILL VERIFIER API KEY\nApplication: ${selected}\nKey ID: ${result.id}\nKey: ${result.key}\nStore only in server secret management. Shown once.\n`,
                    );
                  })
                }
              >
                Create scoped API key
              </button>
              {keys.map((k) => (
                <div className="device-row" key={k.id}>
                  <div>
                    <strong>
                      {k.scopes.join(', ')} · {k.id.slice(0, 8)}
                    </strong>
                    <p>
                      Expires {new Date(k.expires_at).toLocaleDateString()} ·{' '}
                      {k.revoked_at
                        ? 'Revoked'
                        : k.last_used
                          ? `Last used ${new Date(k.last_used).toLocaleDateString()}`
                          : 'Unused'}
                    </p>
                  </div>
                  {!k.revoked_at && (
                    <button
                      className="button danger-outline"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api(`developer/keys/${k.id}`, undefined, 'DELETE');
                        })
                      }
                    >
                      Revoke
                    </button>
                  )}
                </div>
              ))}
              <h4>Enrolled credentials</h4>
              {credentials.length === 0 && (
                <p className="muted">
                  Create enrollments through the authenticated developer API, then prove possession
                  before activation.
                </p>
              )}
              {credentials.map((c) => (
                <div className="settings-card" key={c.id}>
                  <p className="cloud-device-id">{c.id}</p>
                  <p>
                    {c.type.toUpperCase()} · {c.algorithm} ·{' '}
                    {c.active ? 'Active' : 'Awaiting confirmation'}
                  </p>
                  <div className="cloud-actions">
                    <button
                      className="button secondary"
                      disabled={busy || !c.active}
                      onClick={() =>
                        void run(async () => {
                          const result = await api<{ codes: string[] }>(
                            `developer/credentials/${c.id}/recovery-codes`,
                            {},
                          );
                          setMaterial(
                            `STILL VERIFIER RECOVERY CODES\nCredential: ${c.id}\n${result.codes.join('\n')}\nEach code is single-use. Previous codes are invalidated.\n`,
                          );
                        })
                      }
                    >
                      Regenerate recovery codes
                    </button>
                    <button
                      className="button danger-outline"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            'Disable this verifier credential? Ensure another sign-in method exists.',
                          )
                        )
                          void run(async () => {
                            await api(`developer/credentials/${c.id}`, undefined, 'DELETE');
                          });
                      }}
                    >
                      Disable credential
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}
      {material && (
        <Dialog title="Save this secret now" onClose={() => setMaterial('')}>
          <p className="warning">
            This material is displayed once. Keep it private and separate from your consumer vault
            recovery key.
          </p>
          <pre className="recovery-key">{material}</pre>
          <button
            className="button secondary full"
            onClick={() => download('still-verifier-secret.txt', material, 'text/plain')}
          >
            Download securely
          </button>
          <button className="button primary full" onClick={() => setMaterial('')}>
            I saved it · hide now
          </button>
        </Dialog>
      )}
    </div>
  );
}
