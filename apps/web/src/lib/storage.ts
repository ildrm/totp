import { envelopeSchema, headerSchema, type Envelope, type VaultHeader } from '@still/core';
const DB_NAME = 'still-encrypted-vault';
export type Snapshot = { header: VaultHeader | null; records: Envelope[]; corrupt: string[] };
let opening: Promise<IDBDatabase> | null = null;
function database(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion === 0) {
        db.createObjectStore('header');
        db.createObjectStore('sync');
        db.createObjectStore('records', { keyPath: ['vaultId', 'recordId'] });
      } else if (event.oldVersion === 1) {
        const old = request.transaction!.objectStore('records');
        const read = old.getAll();
        read.onsuccess = () => {
          db.deleteObjectStore('records');
          const target = db.createObjectStore('records', { keyPath: ['vaultId', 'recordId'] });
          // AAD binds recordId: preserve every original envelope byte during structural migration.
          for (const record of read.result) target.put(record);
          const headers = request.transaction!.objectStore('header');
          const header = headers.get('vault');
          header.onsuccess = () => {
            if (header.result) headers.put(header.result, header.result.vaultId);
          };
        };
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        opening = null;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      opening = null;
      reject(new Error('Encrypted storage is unavailable.'));
    };
    request.onblocked = () => {
      opening = null;
      reject(new Error('Close other Still tabs to upgrade storage.'));
    };
  });
  return opening;
}
function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Encrypted storage could not be read.'));
  });
}
function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () =>
      reject(new Error('Could not save. Check browser storage space.'));
  });
}
export async function readSnapshot(): Promise<Snapshot> {
  const db = await database();
  const tx = db.transaction(['header', 'records'], 'readonly');
  const [h, records] = await Promise.all([
    result(tx.objectStore('header').get('vault')),
    result(tx.objectStore('records').getAll()),
  ]);
  return {
    header: h ? headerSchema.parse(h) : null,
    records: records
      .filter((r) => h && r.vaultId === h.vaultId)
      .flatMap((r) => {
        const parsed = envelopeSchema.safeParse(r);
        return parsed.success ? [parsed.data] : [];
      }),
    corrupt: records
      .filter((r) => h && r.vaultId === h.vaultId && !envelopeSchema.safeParse(r).success)
      .map((r) => (typeof r.recordId === 'string' ? r.recordId.slice(0, 80) : 'unknown-record')),
  };
}
export async function rawEncryptedSnapshot(): Promise<unknown> {
  const db = await database(),
    tx = db.transaction(['header', 'records']);
  const [header, records] = await Promise.all([
    result(tx.objectStore('header').get('vault')),
    result(tx.objectStore('records').getAll()),
  ]);
  return {
    format: 'still.encrypted-quarantine',
    version: 1,
    header,
    records: records.filter((r) => header && r.vaultId === header.vaultId),
  };
}
export async function saveHeader(header: VaultHeader): Promise<void> {
  const db = await database();
  const tx = db.transaction('header', 'readwrite');
  const done = completed(tx);
  const parsed = headerSchema.parse(header);
  tx.objectStore('header').put(parsed, 'vault');
  tx.objectStore('header').put(parsed, parsed.vaultId);
  await done;
}
export async function writeRecord(envelope: Envelope): Promise<void> {
  const db = await database();
  const tx = db.transaction('records', 'readwrite');
  const done = completed(tx);
  tx.objectStore('records').put(envelopeSchema.parse(envelope));
  await done;
}
export async function deleteRecord(id: string): Promise<void> {
  const { header } = await readSnapshot();
  if (!header) throw new Error('Vault not found.');
  const db = await database();
  const tx = db.transaction('records', 'readwrite');
  const done = completed(tx);
  tx.objectStore('records').delete([header.vaultId, id]);
  await done;
}
export async function writeRecords(envelopes: Envelope[]): Promise<void> {
  const parsed = envelopes.map((e) => envelopeSchema.parse(e)),
    db = await database();
  const tx = db.transaction('records', 'readwrite'),
    done = completed(tx);
  for (const e of parsed) tx.objectStore('records').put(e);
  await done;
}
export async function restoreSnapshot(header: VaultHeader, records: Envelope[]): Promise<void> {
  const db = await database();
  const previous = await result(db.transaction('records').objectStore('records').getAll());
  const tx = db.transaction(['header', 'records', 'sync'], 'readwrite');
  const done = completed(tx);
  for (const old of previous)
    if (old.vaultId === header.vaultId)
      tx.objectStore('records').delete([old.vaultId, old.recordId]);
  tx.objectStore('header').put(headerSchema.parse(header), 'vault');
  tx.objectStore('header').put(headerSchema.parse(header), header.vaultId);
  tx.objectStore('sync').delete(`state:${header.vaultId}`);
  for (const e of records) tx.objectStore('records').put(envelopeSchema.parse(e));
  await done;
}
export async function eraseVault(): Promise<void> {
  const { header } = await readSnapshot();
  if (!header) return;
  const db = await database();
  const previous = await result(db.transaction('records').objectStore('records').getAll());
  const tx = db.transaction(['header', 'records', 'sync'], 'readwrite');
  const done = completed(tx);
  tx.objectStore('header').delete(header.vaultId);
  tx.objectStore('header').delete('vault');
  tx.objectStore('sync').delete(`state:${header.vaultId}`);
  for (const old of previous)
    if (old.vaultId === header.vaultId)
      tx.objectStore('records').delete([old.vaultId, old.recordId]);
  await done;
}
export async function syncValue<T>(id: string): Promise<T | undefined> {
  const db = await database();
  return result(db.transaction('sync').objectStore('sync').get(id)) as Promise<T | undefined>;
}
export async function setSyncValue(id: string, value: unknown): Promise<void> {
  const db = await database();
  const tx = db.transaction('sync', 'readwrite');
  const done = completed(tx);
  tx.objectStore('sync').put(value, id);
  await done;
}
export async function vaultHeaders(): Promise<VaultHeader[]> {
  const db = await database();
  const all = await result(db.transaction('header').objectStore('header').getAll());
  const parsed = all.map((v) => headerSchema.parse(v));
  return [...new Map(parsed.map((v) => [v.vaultId, v])).values()];
}
export async function selectVault(id: string): Promise<void> {
  const db = await database();
  const header = await result(db.transaction('header').objectStore('header').get(id));
  if (!header) throw new Error('Vault not found.');
  await saveHeader(headerSchema.parse(header));
}
