import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { z } from '@still/core';
import {
  envelopeSchema,
  checkRevision,
  headerSchema,
  type Envelope,
  type SyncOperation,
  type SyncInput,
} from '@still/core';
import { readSnapshot, setSyncValue, syncValue, writeRecord, deleteRecord } from './storage';
import { vaultCommand } from './vault-client';
export async function api<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const verb = method ?? (body ? 'POST' : 'GET');
  const response = await fetch(`/api/${path}`, {
    method: verb,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: ['GET', 'HEAD'].includes(verb) ? {} : { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? 'Sign in with a passkey first.'
        : response.status === 403
          ? 'Access denied. Reauthenticate with your passkey.'
          : response.status === 429
            ? 'Too many requests. Try again shortly.'
            : response.status === 409
              ? 'A conflicting change needs your attention.'
              : 'Cloud service unavailable. Your local vault still works.',
    );
  return response.json() as Promise<T>;
}
export async function cloudPasskey(kind: 'register' | 'login' | 'add' | 'reauth') {
  if (!window.PublicKeyCredential)
    throw new Error(
      'Passkeys are unavailable in this browser. Your local vault works with a passphrase.',
    );
  const path = kind === 'add' ? 'passkeys' : kind;
  if (kind === 'register' || kind === 'add') {
    const options = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>(
      `auth/${path}/options`,
      {},
    );
    const response = await startRegistration({ optionsJSON: options });
    return api(`auth/${kind === 'add' ? 'protected/' : ''}verify`, {
      response,
      name: 'My passkey',
      deviceName: 'This browser',
    });
  }
  const options = await api<Parameters<typeof startAuthentication>[0]['optionsJSON']>(
    `auth/${path}/options`,
    {},
  );
  const response = await startAuthentication({ optionsJSON: options });
  return api(`auth/${kind === 'reauth' ? 'protected/' : ''}verify`, {
    response,
    deviceName: 'This browser',
  });
}
const operationSchema = z
  .object({
    operation_id: z.uuid(),
    record_id: z.string().max(80),
    revision: z.number().int().nonnegative(),
    base_revision: z.number().int().nonnegative(),
    envelope: envelopeSchema.nullable(),
    tombstone: z.boolean(),
    conflict: z.boolean(),
    proof: envelopeSchema,
  })
  .strict();
const pullSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    epoch: z.number().int().positive(),
    keyId: z.uuid(),
    operations: z.array(operationSchema).max(500),
    hasMore: z.boolean(),
  })
  .strict();
export type SyncConflict = {
  id: string;
  revision: number;
  envelope: Envelope | null;
  operationId: string;
};
type SyncState = {
  revision: number;
  heads: Record<string, { revision: number; ciphertext: string | null }>;
  pending: SyncOperation[];
  conflicts: SyncConflict[];
  seen?: Record<string, number>;
};
async function signed(input: SyncInput): Promise<SyncOperation> {
  return (await vaultCommand({ type: 'signSync', input })).operation!;
}
export async function syncVault(): Promise<{
  downloaded: number;
  uploaded: number;
  conflicts: SyncConflict[];
}> {
  const snapshot = await readSnapshot();
  if (!snapshot.header) throw new Error('Create or restore a local vault first.');
  const h = headerSchema.parse(snapshot.header),
    state = (await syncValue<SyncState>(`state:${h.vaultId}`)) ?? {
      revision: 0,
      heads: {},
      pending: [],
      conflicts: [],
    };
  const available =
    await api<{ id: string; shared: boolean; key_id: string; role: string }[]>('vaults');
  const existing = available.find((v) => v.id === h.vaultId);
  if (!existing)
    await api('vaults', { id: h.vaultId, keyId: h.keyId, shared: h.kind === 'shared' });
  else if (existing.key_id !== h.keyId)
    throw new Error('Vault key changed. Pair with a trusted device.');
  const current = new Map(
    snapshot.records
      .filter((e) => e.recordId !== 'settings' && e.keyId === h.keyId)
      .map((e) => [e.recordId, e]),
  );
  state.seen ??= {};
  // Persist idempotent operations before any network write; interrupted retries keep their IDs.
  for (const [id, e] of current) {
    if (existing?.role === 'viewer') continue;
    const head = state.heads[id];
    if (
      head?.ciphertext === e.ciphertext ||
      state.pending.some((p) => p.recordId === id && p.envelope?.ciphertext === e.ciphertext)
    )
      continue;
    state.pending.push(
      await signed({
        operationId: crypto.randomUUID(),
        vaultId: h.vaultId,
        recordId: id,
        baseRevision: head?.revision ?? 0,
        envelope: e,
        tombstone: false,
      }),
    );
  }
  for (const [id, head] of Object.entries(state.heads)) {
    if (id === 'settings' || existing?.role === 'viewer') continue;
    if (
      head.ciphertext !== null &&
      !current.has(id) &&
      !state.pending.some((p) => p.recordId === id && p.tombstone)
    )
      state.pending.push(
        await signed({
          operationId: crypto.randomUUID(),
          vaultId: h.vaultId,
          recordId: id,
          baseRevision: head.revision,
          envelope: null,
          tombstone: true,
        }),
      );
  }
  await setSyncValue(`state:${h.vaultId}`, state);
  let uploaded = 0,
    downloaded = 0;
  while (state.pending.length) {
    const op = state.pending[0]!;
    const result = await api<{ revision: number; conflict: boolean }>('vaults/operations', op);
    if (!result.conflict)
      state.heads[op.recordId] = {
        revision: result.revision,
        ciphertext: op.envelope?.ciphertext ?? null,
      };
    state.pending.shift();
    uploaded++;
    await setSyncValue(`state:${h.vaultId}`, state);
  }
  let more = true;
  while (more) {
    const response = pullSchema.parse(
      await api(`vaults/${h.vaultId}/operations?after=${state.revision}`),
    );
    checkRevision(state.revision, response.revision);
    if (response.keyId !== h.keyId)
      throw new Error('Vault key changed. Pair with a trusted device before syncing.');
    for (const op of response.operations) {
      checkRevision(state.revision, op.revision);
      if (op.revision <= state.revision) throw new Error('Sync operation replay.');
      await vaultCommand({
        type: 'validateOperation',
        operation: {
          operationId: op.operation_id,
          vaultId: h.vaultId,
          recordId: op.record_id,
          baseRevision: op.base_revision,
          envelope: op.envelope,
          tombstone: op.tombstone,
          proof: op.proof,
        },
      });
      if (state.seen[op.operation_id] !== undefined && state.seen[op.operation_id] !== op.revision)
        throw new Error('Sync operation was replayed with a different revision.');
      const known = state.heads[op.record_id];
      if (
        !op.conflict &&
        op.revision > (known?.revision ?? 0) &&
        op.base_revision !== (known?.revision ?? 0)
      )
        throw new Error('Sync record history authentication failed.');
      if (
        op.envelope &&
        (op.envelope.vaultId !== h.vaultId ||
          op.envelope.keyId !== h.keyId ||
          op.envelope.recordId !== op.record_id)
      )
        throw new Error('Invalid sync envelope context.');
      if (op.conflict) {
        if (!state.conflicts.some((c) => c.operationId === op.operation_id))
          state.conflicts.push({
            id: op.record_id,
            revision: op.revision,
            envelope: op.envelope,
            operationId: op.operation_id,
          });
      } else {
        const local = current.get(op.record_id),
          remembered = state.heads[op.record_id];
        const unsynced =
          existing?.role !== 'viewer' && local && remembered?.ciphertext !== local.ciphertext;
        if (unsynced && local?.ciphertext !== op.envelope?.ciphertext) {
          state.conflicts.push({
            id: op.record_id,
            revision: op.revision,
            envelope: op.envelope,
            operationId: op.operation_id,
          });
        } else if (op.revision <= (remembered?.revision ?? 0)) {
          // The acknowledged local operation is newer; never replay its older state.
        } else if (op.tombstone) {
          await deleteRecord(op.record_id);
          current.delete(op.record_id);
        } else if (op.envelope) {
          await vaultCommand({ type: 'validateSync', envelope: op.envelope });
          await writeRecord(op.envelope);
          current.set(op.record_id, op.envelope);
          downloaded++;
        }
        if (op.revision > (remembered?.revision ?? 0))
          state.heads[op.record_id] = {
            revision: op.revision,
            ciphertext: op.envelope?.ciphertext ?? null,
          };
      }
      state.revision = op.revision;
      state.seen[op.operation_id] = op.revision;
      await setSyncValue(`state:${h.vaultId}`, state);
    }
    if (
      !response.operations.length &&
      response.revision > state.revision &&
      Object.keys(state.heads).length
    )
      throw new Error('Sync history has an unexpected gap.');
    if (!response.operations.length && !Object.keys(state.heads).length)
      state.revision = response.revision;
    more = response.hasMore;
  }
  return { downloaded, uploaded, conflicts: state.conflicts };
}
export async function loadSyncConflicts(): Promise<SyncConflict[]> {
  const { header } = await readSnapshot();
  if (!header) return [];
  return (await syncValue<SyncState>(`state:${header.vaultId}`))?.conflicts ?? [];
}
export async function resolveSyncConflict(
  conflict: SyncConflict,
  choice: 'local' | 'remote' | 'both',
): Promise<void> {
  const snapshot = await readSnapshot();
  if (!snapshot.header) throw new Error('Vault unavailable.');
  const state = await syncValue<SyncState>(`state:${snapshot.header.vaultId}`);
  if (!state || !state.conflicts.some((c) => c.operationId === conflict.operationId))
    throw new Error('Conflict no longer exists.');
  let selected = snapshot.records.find((e) => e.recordId === conflict.id) ?? null;
  if (choice === 'remote') {
    if (conflict.envelope)
      await vaultCommand({ type: 'validateSync', envelope: conflict.envelope });
    selected = conflict.envelope;
  }
  if (choice === 'both') {
    if (!conflict.envelope || conflict.id === 'settings')
      throw new Error('Only account conflicts can keep both versions.');
    await vaultCommand({ type: 'keepBoth', envelope: conflict.envelope });
  }
  const head = state.heads[conflict.id]?.revision ?? 0;
  const operation: SyncOperation = await signed({
    operationId: crypto.randomUUID(),
    vaultId: snapshot.header.vaultId,
    recordId: conflict.id,
    baseRevision: head,
    envelope: selected,
    tombstone: selected === null,
  });
  state.pending.push(operation);
  await setSyncValue(`state:${snapshot.header.vaultId}`, state);
  const result = await api<{ revision: number; conflict: boolean }>('vaults/operations', operation);
  if (result.conflict) throw new Error('Another change arrived. Sync again before resolving.');
  if (choice === 'remote') {
    if (selected) await vaultCommand({ type: 'acceptSync', envelope: selected });
    else await deleteRecord(conflict.id);
  }
  state.pending = state.pending.filter((p) => p.operationId !== operation.operationId);
  state.conflicts = state.conflicts.filter((c) => c.operationId !== conflict.operationId);
  state.heads[conflict.id] = {
    revision: result.revision,
    ciphertext: selected?.ciphertext ?? null,
  };
  await setSyncValue(`state:${snapshot.header.vaultId}`, state);
}
