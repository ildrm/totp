import type {
  Backup,
  Envelope,
  OtpInput,
  PublicRecord,
  VaultHeader,
  VaultSettings,
  Pairing,
  SyncInput,
  SyncOperation,
} from '@still/core';
export type WorkerCommand =
  | { type: 'create'; passphrase: string }
  | { type: 'createShared'; passphrase: string }
  | {
      type: 'unlock';
      header: VaultHeader;
      credential: string;
      method: 'passphrase' | 'recovery';
      records: Envelope[];
      corrupt?: string[];
    }
  | { type: 'list' }
  | { type: 'reload' }
  | { type: 'previewImport'; accounts: OtpInput[] }
  | { type: 'importBatch'; accounts: OtpInput[]; duplicates: 'skip' | 'keep' | 'replace' }
  | { type: 'activity' }
  | { type: 'codes'; ids: string[]; timestamp: number }
  | {
      type: 'add';
      input: OtpInput;
      folder: string;
      color: PublicRecord['color'];
      tags: string[];
      notes: string;
    }
  | {
      type: 'update';
      id: string;
      changes: Partial<
        Pick<
          PublicRecord,
          'favorite' | 'archived' | 'folder' | 'notes' | 'color' | 'tags' | 'aliases' | 'order'
        >
      >;
    }
  | { type: 'delete'; id: string; passphrase: string }
  | { type: 'use'; id: string; timestamp: number; advance: boolean }
  | { type: 'backup'; passphrase: string; ids?: string[] }
  | { type: 'quarantineExport'; passphrase: string }
  | { type: 'restore'; backup: Backup; credential: string; method: 'passphrase' | 'recovery' }
  | { type: 'changePassword'; credential: string; method: 'passphrase' | 'recovery'; next: string }
  | { type: 'reveal'; id: string; passphrase: string }
  | { type: 'settings'; settings: VaultSettings }
  | { type: 'reauth'; passphrase: string }
  | { type: 'validateSync'; envelope: Envelope }
  | { type: 'signSync'; input: SyncInput }
  | { type: 'validateOperation'; operation: SyncOperation }
  | { type: 'acceptSync'; envelope: Envelope }
  | { type: 'keepBoth'; envelope: Envelope }
  | { type: 'pairBegin' }
  | { type: 'pairApprove'; context: Pairing; passphrase: string }
  | {
      type: 'pairReceive';
      context: Pairing;
      senderPublicKey: JsonWebKey;
      envelope: Envelope;
      keyId: string;
      passphrase: string;
      kind: 'personal' | 'shared';
      fingerprint: string;
    }
  | { type: 'prepareRotation'; passphrase: string }
  | { type: 'commitRotation'; passphrase: string; expectedKeyId: string }
  | { type: 'lock' };
export type WorkerData = {
  records?: PublicRecord[];
  header?: VaultHeader;
  recovery?: string;
  envelope?: Envelope;
  deleted?: string;
  codes?: Record<string, string>;
  code?: string;
  backup?: Backup;
  settings?: VaultSettings;
  corrupt?: string[];
  secret?: string;
  uri?: string;
  publicKey?: JsonWebKey;
  fingerprint?: string;
  encryptedRecords?: Envelope[];
  operation?: SyncOperation;
  encryptedOperations?: SyncOperation[];
  preparedHeader?: VaultHeader;
  duplicates?: number[];
  imported?: number;
  quarantine?: unknown;
};
export type WorkerResponse =
  { id: number; ok: true; data: WorkerData } | { id: number; ok: false; error: string };
