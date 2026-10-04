/// <reference lib="webworker" />
import {
  createVault,
  unlockVault,
  changePassphrase,
  openJson,
  sealJson,
  recordSchema,
  otpSchema,
  publicRecord,
  totp,
  hotp,
  makeBackup,
  validateBackup,
  settingsSchema,
  defaultSettings,
  serializeUri,
  deviceKeys,
  publicDeviceKey,
  pairingKey,
  pairingFingerprint,
  pairingSchema,
  passwordKey,
  open,
  wrapForDevice,
  protectVaultKey,
  random,
  authenticateOperation,
  verifyOperation,
  type SyncOperation,
  type VaultHeader,
  type VaultRecord,
  type Envelope,
  type VaultSettings,
} from '@still/core';
import { z } from '@still/core';
import {
  readSnapshot,
  saveHeader,
  writeRecord,
  writeRecords,
  deleteRecord,
  restoreSnapshot,
  setSyncValue,
  syncValue,
  rawEncryptedSnapshot,
} from './storage';
import type { WorkerCommand, WorkerData, WorkerResponse } from './worker-protocol';

let key: CryptoKey | null = null,
  header: VaultHeader | null = null;
const records = new Map<string, VaultRecord>();
let settings: VaultSettings = { ...defaultSettings },
  lastActivity = Date.now();
let queue = Promise.resolve();
let pendingPair: CryptoKeyPair | null = null;
function lock() {
  pendingPair = null;
  key = null;
  header = null;
  records.clear();
  settings = { ...defaultSettings };
}
function authorize() {
  if (!key || !header) throw new Error('Vault is locked.');
  if (Date.now() - lastActivity > settings.autoLockMinutes * 60000) {
    lock();
    throw new Error('Vault is locked.');
  }
  return { key, header };
}
async function reauth(passphrase: string) {
  const { header } = authorize();
  await unlockVault(header, passphrase);
  lastActivity = Date.now();
}
function list(): WorkerData {
  return { records: [...records.values()].map(publicRecord), settings };
}
async function store(record: VaultRecord): Promise<Envelope> {
  const { key, header } = authorize();
  const parsed = recordSchema.parse(record);
  const e = await sealJson(key, header.vaultId, header.keyId, parsed.id, parsed);
  await writeRecord(e);
  records.set(parsed.id, parsed);
  return e;
}
async function load(envelopes: Envelope[]): Promise<WorkerData> {
  const { key, header } = authorize();
  const corrupt: string[] = [];
  records.clear();
  for (const e of envelopes) {
    try {
      if (e.vaultId !== header.vaultId || e.keyId !== header.keyId) throw new Error('Wrong vault.');
      if (e.recordId === 'settings' || e.recordId === `settings:${header.vaultId}`) {
        settings = settingsSchema.parse(await openJson(key, e));
        if (e.recordId !== 'settings') {
          await writeRecord(
            await sealJson(key, header.vaultId, header.keyId, 'settings', settings),
          );
          await deleteRecord(e.recordId);
        }
        continue;
      }
      const record = recordSchema.parse(await openJson(key, e));
      if (record.id !== e.recordId || record.vaultId !== header.vaultId)
        throw new Error('Invalid context.');
      records.set(record.id, record);
    } catch {
      corrupt.push(e.recordId);
    }
  }
  return { ...list(), corrupt };
}
async function execute(command: WorkerCommand): Promise<WorkerData> {
  if (command.type === 'lock') {
    lock();
    return {};
  }
  if (command.type === 'create') {
    if ((await readSnapshot()).header) throw new Error('A vault already exists.');
    const created = await createVault(command.passphrase);
    await saveHeader(created.header);
    key = created.key;
    header = created.header;
    lastActivity = Date.now();
    return { ...list(), header, recovery: created.recovery };
  }
  if (command.type === 'createShared') {
    authorize();
    const created = await createVault(command.passphrase);
    created.header.kind = 'shared';
    await saveHeader(created.header);
    lock();
    key = created.key;
    header = created.header;
    lastActivity = Date.now();
    return { ...list(), header, recovery: created.recovery };
  }
  if (command.type === 'unlock') {
    lock();
    header = command.header;
    try {
      key = await unlockVault(header, command.credential, command.method);
      lastActivity = Date.now();
      const loaded = await load(command.records);
      return {
        header,
        ...loaded,
        corrupt: [...(loaded.corrupt ?? []), ...(command.corrupt ?? [])],
      };
    } catch {
      lock();
      throw new Error('Could not unlock. Check your passphrase or recovery key.');
    }
  }
  if (command.type === 'restore') {
    if (header) throw new Error('Lock the vault before restoring a backup.');
    const restored = await validateBackup(command.backup, command.credential, command.method);
    // Validate domain schemas before replacing any existing local data.
    for (const e of restored.backup.records) {
      const data = await openJson(restored.key, e);
      if (e.recordId === 'settings') settingsSchema.parse(data);
      else {
        const r = recordSchema.parse(data);
        if (r.id !== e.recordId || r.vaultId !== restored.backup.header.vaultId)
          throw new Error('Invalid backup record.');
      }
    }
    await restoreSnapshot(restored.backup.header, restored.backup.records);
    key = restored.key;
    header = restored.backup.header;
    lastActivity = Date.now();
    return { header, ...(await load(restored.backup.records)) };
  }
  const state = authorize();
  if (command.type === 'previewImport' || command.type === 'importBatch') {
    const incoming = z.array(otpSchema).min(1).max(1000).parse(command.accounts);
    const same = (
      a: Omit<VaultRecord, 'id'> | import('@still/core').OtpInput,
      b: import('@still/core').OtpInput,
    ) =>
      a.secret === b.secret &&
      a.issuer.toLowerCase() === b.issuer.toLowerCase() &&
      a.account.toLowerCase() === b.account.toLowerCase();
    const duplicates = incoming.flatMap((r, i) =>
      [...records.values()].some((v) => same(v, r)) || incoming.slice(0, i).some((v) => same(v, r))
        ? [i]
        : [],
    );
    if (command.type === 'previewImport') return { duplicates };
    z.enum(['skip', 'keep', 'replace']).parse(command.duplicates);
    const next = new Map(records),
      changed: VaultRecord[] = [],
      now = new Date().toISOString();
    for (const r of incoming) {
      const duplicate = [...next.values()].find((v) => same(v, r));
      if (duplicate && command.duplicates === 'skip') continue;
      const value = recordSchema.parse({
        ...(duplicate && command.duplicates === 'replace' ? duplicate : {}),
        ...r,
        id: duplicate && command.duplicates === 'replace' ? duplicate.id : crypto.randomUUID(),
        vaultId: state.header.vaultId,
        schemaVersion: 1,
        createdAt: duplicate && command.duplicates === 'replace' ? duplicate.createdAt : now,
        modifiedAt: now,
        order: duplicate && command.duplicates === 'replace' ? duplicate.order : next.size,
        account:
          duplicate && command.duplicates === 'keep'
            ? `${r.account.slice(0, 230)} (import copy)`
            : r.account,
      });
      next.set(value.id, value);
      changed.push(value);
    }
    if (next.size > 9999) throw new Error('Vault record limit reached.');
    const envelopes: Envelope[] = [];
    for (const r of changed)
      envelopes.push(await sealJson(state.key, state.header.vaultId, state.header.keyId, r.id, r));
    await writeRecords(envelopes);
    records.clear();
    for (const r of next.values()) records.set(r.id, r);
    return { ...list(), imported: changed.length };
  }
  if (command.type === 'reload') return load((await readSnapshot()).records);
  if (command.type === 'signSync') {
    if (command.input.vaultId !== state.header.vaultId) throw new Error('Invalid sync vault.');
    return { operation: await authenticateOperation(state.key, state.header.keyId, command.input) };
  }
  if (command.type === 'validateOperation') {
    if (command.operation.vaultId !== state.header.vaultId) throw new Error('Invalid sync vault.');
    await verifyOperation(state.key, state.header.keyId, command.operation);
    return {};
  }
  if (command.type === 'prepareRotation') {
    await reauth(command.passphrase);
    const syncState = await syncValue<{ pending: unknown[]; conflicts: unknown[] }>(
      `state:${state.header.vaultId}`,
    );
    if (syncState?.pending.length || syncState?.conflicts.length)
      throw new Error('Sync and resolve all conflicts before rotating keys.');
    const snapshot = await readSnapshot();
    if (
      snapshot.corrupt.length ||
      snapshot.records.filter((e) => e.recordId !== 'settings').length !== records.size
    )
      throw new Error('Restore corrupt records before rotating this vault.');
    const raw = random(32);
    try {
      const next = await protectVaultKey(
        raw,
        state.header.vaultId,
        crypto.randomUUID(),
        command.passphrase,
        state.header.kind ?? 'personal',
      );
      const encryptedRecords: Envelope[] = [];
      for (const r of records.values())
        encryptedRecords.push(
          await sealJson(next.key, next.header.vaultId, next.header.keyId, r.id, r),
        );
      encryptedRecords.push(
        await sealJson(next.key, next.header.vaultId, next.header.keyId, 'settings', settings),
      );
      const encryptedOperations: SyncOperation[] = [];
      for (const e of encryptedRecords.filter((e) => e.recordId !== 'settings'))
        encryptedOperations.push(
          await authenticateOperation(next.key, next.header.keyId, {
            operationId: crypto.randomUUID(),
            vaultId: next.header.vaultId,
            recordId: e.recordId,
            baseRevision: 0,
            envelope: e,
            tombstone: false,
          }),
        );
      await setSyncValue(`rotation:${state.header.vaultId}`, {
        header: next.header,
        records: encryptedRecords,
        recovery: await sealJson(
          next.key,
          next.header.vaultId,
          next.header.keyId,
          'rotation-recovery',
          { recovery: next.recovery },
        ),
      });
      return {
        preparedHeader: next.header,
        encryptedRecords,
        encryptedOperations,
        recovery: next.recovery,
      };
    } finally {
      raw.fill(0);
    }
  }
  if (command.type === 'commitRotation') {
    const pending = await syncValue<{
      header: VaultHeader;
      records: Envelope[];
      recovery: Envelope;
    }>(`rotation:${state.header.vaultId}`);
    if (!pending) throw new Error('No prepared rotation exists.');
    if (pending.header.keyId !== command.expectedKeyId)
      throw new Error(
        'Remote key differs from the local rotation preparation. Pair with a trusted device.',
      );
    const nextKey = await unlockVault(pending.header, command.passphrase);
    const recovery = z
      .object({ recovery: z.string() })
      .parse(await openJson(nextKey, pending.recovery)).recovery;
    await restoreSnapshot(pending.header, pending.records);
    key = nextKey;
    header = pending.header;
    lastActivity = Date.now();
    return { header, recovery, ...(await load(pending.records)) };
  }
  if (command.type === 'pairBegin') {
    pendingPair = await deviceKeys();
    return { publicKey: await publicDeviceKey(pendingPair) };
  }
  if (command.type === 'pairApprove') {
    await reauth(command.passphrase);
    const context = pairingSchema.parse(command.context);
    if (context.vaultId !== state.header.vaultId)
      throw new Error('Select the requested vault before approving.');
    const keys = await deviceKeys(),
      publicKey = await publicDeviceKey(keys),
      peer = context.publicKey;
    const kek = await pairingKey(keys.privateKey, peer, context),
      passwordKek = await passwordKey(command.passphrase, state.header.kdf),
      raw = await open(passwordKek, state.header.passwordWrap);
    try {
      return {
        envelope: await wrapForDevice(kek, raw, context),
        publicKey,
        fingerprint: await pairingFingerprint(publicKey, peer, context),
      };
    } finally {
      raw.fill(0);
    }
  }
  if (command.type === 'pairReceive') {
    if (!pendingPair) throw new Error('Pairing expired. Start a new request.');
    const context = pairingSchema.parse(command.context),
      own = await publicDeviceKey(pendingPair);
    if (
      own.x !== context.publicKey.x ||
      own.y !== context.publicKey.y ||
      command.fingerprint !== (await pairingFingerprint(command.senderPublicKey, own, context))
    )
      throw new Error('Pairing fingerprint does not match.');
    const kek = await pairingKey(pendingPair.privateKey, command.senderPublicKey, context),
      e = command.envelope;
    if (
      e.vaultId !== context.vaultId ||
      e.keyId !== context.transactionId ||
      e.recordId !== `${context.senderId}:${context.recipientId}:${context.epoch}`
    )
      throw new Error('Invalid pairing envelope.');
    const raw = await open(kek, e);
    try {
      const protection = await protectVaultKey(
        raw,
        context.vaultId,
        z.uuid().parse(command.keyId),
        command.passphrase,
        command.kind,
      );
      await saveHeader(protection.header);
      pendingPair = null;
      records.clear();
      key = protection.key;
      header = protection.header;
      lastActivity = Date.now();
      const snapshot = await readSnapshot();
      return { header, recovery: protection.recovery, ...(await load(snapshot.records)) };
    } finally {
      raw.fill(0);
    }
  }
  if (
    command.type === 'validateSync' ||
    command.type === 'acceptSync' ||
    command.type === 'keepBoth'
  ) {
    const incoming = command.envelope;
    if (incoming.vaultId !== state.header.vaultId || incoming.keyId !== state.header.keyId)
      throw new Error('Invalid sync context.');
    const plaintext = await openJson(state.key, incoming);
    if (incoming.recordId === 'settings') {
      const parsed = settingsSchema.parse(plaintext);
      if (command.type === 'acceptSync') {
        await writeRecord(incoming);
        settings = parsed;
      }
      return { settings: command.type === 'acceptSync' ? parsed : settings };
    }
    const record = recordSchema.parse(plaintext);
    if (record.id !== incoming.recordId || record.vaultId !== state.header.vaultId)
      throw new Error('Invalid synced record.');
    if (command.type === 'acceptSync') {
      await writeRecord(incoming);
      records.set(record.id, record);
      return list();
    }
    if (command.type === 'keepBoth')
      return {
        envelope: await store({
          ...record,
          id: crypto.randomUUID(),
          account: `${record.account.slice(0, 230)} (conflict copy)`,
          createdAt: new Date().toISOString(),
          modifiedAt: new Date().toISOString(),
        }),
        ...list(),
      };
    return {};
  }
  if (command.type !== 'codes' && command.type !== 'list') lastActivity = Date.now();
  if (command.type === 'list') return list();
  if (command.type === 'activity') return {};
  if (command.type === 'reauth') {
    await reauth(command.passphrase);
    return {};
  }
  if (command.type === 'codes') {
    const ids = z.array(z.uuid()).max(100).parse(command.ids);
    const timestamp = z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .parse(command.timestamp);
    const codes: Record<string, string> = {};
    for (const id of ids) {
      const r = records.get(id);
      if (r)
        codes[id] =
          r.type === 'totp'
            ? await totp(r, timestamp)
            : await hotp(r.secret, BigInt(r.counter), r.algorithm, r.digits);
    }
    return { codes };
  }
  if (command.type === 'add') {
    const input = otpSchema.parse(command.input);
    if (records.size >= 9999) throw new Error('Vault record limit reached.');
    if (
      [...records.values()].some(
        (r) =>
          r.secret === input.secret &&
          r.issuer.toLowerCase() === input.issuer.toLowerCase() &&
          r.account.toLowerCase() === input.account.toLowerCase(),
      )
    )
      throw new Error('This account is already in your vault.');
    const now = new Date().toISOString();
    const record = recordSchema.parse({
      ...input,
      id: crypto.randomUUID(),
      vaultId: state.header.vaultId,
      schemaVersion: 1,
      folder: command.folder,
      color: command.color,
      tags: command.tags,
      notes: command.notes,
      createdAt: now,
      modifiedAt: now,
      order: records.size,
    });
    return { envelope: await store(record), ...list() };
  }
  if (command.type === 'update') {
    const r = records.get(command.id);
    if (!r) throw new Error('Account not found.');
    const changes = z
      .object({
        favorite: z.boolean().optional(),
        archived: z.boolean().optional(),
        folder: z.string().max(64).optional(),
        notes: z.string().max(2000).optional(),
        color: recordSchema.shape.color.optional(),
        tags: recordSchema.shape.tags.optional(),
        aliases: recordSchema.shape.aliases.optional(),
        order: z.number().int().nonnegative().optional(),
      })
      .strict()
      .parse(command.changes);
    return {
      envelope: await store({ ...r, ...changes, modifiedAt: new Date().toISOString() }),
      ...list(),
    };
  }
  if (command.type === 'delete') {
    await reauth(command.passphrase);
    if (!records.has(command.id)) throw new Error('Account not found.');
    await deleteRecord(command.id);
    records.delete(command.id);
    return { deleted: command.id, ...list() };
  }
  if (command.type === 'use') {
    const r = records.get(command.id);
    if (!r) throw new Error('Account not found.');
    const timestamp = z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .parse(command.timestamp);
    const code =
      r.type === 'totp'
        ? await totp(r, timestamp)
        : await hotp(r.secret, BigInt(r.counter), r.algorithm, r.digits);
    let next = r;
    if (command.advance) {
      if (r.type !== 'hotp' || BigInt(r.counter) >= 0xffffffffffffffffn)
        throw new Error('Counter cannot advance.');
      next = { ...next, counter: (BigInt(r.counter) + 1n).toString() };
    }
    if (settings.recordUsage)
      next = {
        ...next,
        lastUsedAt: new Date().toISOString(),
        usageCount: Math.min(next.usageCount + 1, Number.MAX_SAFE_INTEGER),
      };
    if (next !== r) await store({ ...next, modifiedAt: new Date().toISOString() });
    return { code, ...list() };
  }
  if (command.type === 'backup') {
    await reauth(command.passphrase);
    const snapshot = await readSnapshot();
    if (snapshot.corrupt.length)
      throw new Error(
        'Damaged records are retained. Export the encrypted recovery archive before replacing storage.',
      );
    const selected = command.ids ? new Set(z.array(z.uuid()).max(10000).parse(command.ids)) : null;
    return {
      backup: await makeBackup(
        state.key,
        state.header,
        snapshot.records.filter((e) => !selected || selected.has(e.recordId)),
      ),
      ...list(),
    };
  }
  if (command.type === 'quarantineExport') {
    await reauth(command.passphrase);
    return { quarantine: await rawEncryptedSnapshot() };
  }
  if (command.type === 'changePassword') {
    const next = await changePassphrase(
      state.header,
      command.credential,
      command.method,
      command.next,
    );
    await saveHeader(next);
    header = next;
    return { header };
  }
  if (command.type === 'reveal') {
    await reauth(command.passphrase);
    const r = records.get(command.id);
    if (!r) throw new Error('Account not found.');
    const { type, issuer, account, secret, algorithm, digits, period, counter } = r;
    return {
      secret,
      uri: serializeUri({ type, issuer, account, secret, algorithm, digits, period, counter }),
    };
  }
  if (command.type === 'settings') {
    const next = settingsSchema.parse(command.settings);
    const e = await sealJson(state.key, state.header.vaultId, state.header.keyId, 'settings', next);
    await writeRecord(e);
    settings = next;
    return { settings, envelope: e };
  }
  throw new Error('Unsupported vault operation.');
}
self.onmessage = (event: MessageEvent<{ id: number; command: WorkerCommand }>) => {
  const { id, command } = event.data;
  queue = queue.then(async () => {
    try {
      const data = await execute(command);
      self.postMessage({ id, ok: true, data } satisfies WorkerResponse);
    } catch (error) {
      const allowed =
        error instanceof Error && !['ZodError', 'OperationError', 'DataError'].includes(error.name)
          ? error.message
          : 'The operation could not be completed safely.';
      self.postMessage({ id, ok: false, error: allowed } satisfies WorkerResponse);
    }
  });
};
