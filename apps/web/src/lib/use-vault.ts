'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  defaultSettings,
  type VaultHeader,
  type PublicRecord,
  type VaultSettings,
} from '@still/core';
import { readSnapshot, eraseVault, vaultHeaders, selectVault } from './storage';
import { exclusive, terminate, vaultCommand } from './vault-client';
import type { WorkerCommand, WorkerData } from './worker-protocol';
export function useVault() {
  const [header, setHeader] = useState<VaultHeader | null>(null),
    [headers, setHeaders] = useState<VaultHeader[]>([]),
    [records, setRecords] = useState<PublicRecord[]>([]),
    [settings, setSettings] = useState<VaultSettings>(defaultSettings);
  const [status, setStatus] = useState<'loading' | 'new' | 'locked' | 'unlocked'>('loading'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [codes, setCodes] = useState<Record<string, string>>({}),
    [corrupt, setCorrupt] = useState<string[]>([]),
    [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const channel = useRef<BroadcastChannel | null>(null),
    lockEpoch = useRef(0),
    activity = useRef(Date.now()),
    settingsRef = useRef(settings),
    statusRef = useRef(status);
  settingsRef.current = settings;
  statusRef.current = status;
  const lock = useCallback(
    (broadcast = true) => {
      const wasUnlocked = statusRef.current === 'unlocked';
      const nextStatus = header ? 'locked' : 'new';
      statusRef.current = nextStatus;
      lockEpoch.current++;
      terminate();
      setRecords([]);
      setCodes({});
      setSettings(defaultSettings);
      setStatus(nextStatus);
      if (broadcast && wasUnlocked) channel.current?.postMessage('lock');
    },
    [header],
  );
  const lockRef = useRef(lock);
  lockRef.current = lock;
  useEffect(() => {
    let active = true;
    readSnapshot()
      .then((s) => {
        if (active) {
          setHeader(s.header);
          void vaultHeaders().then(setHeaders);
          setStatus(s.header ? 'locked' : 'new');
        }
      })
      .catch(() => {
        if (active) {
          setError('Encrypted storage is unavailable. Use a current browser with storage enabled.');
          setStatus('new');
        }
      });
    return () => {
      active = false;
      terminate();
    };
  }, []);
  useEffect(() => {
    if (!('BroadcastChannel' in window)) return;
    const c = new BroadcastChannel('still-vault-state');
    channel.current = c;
    c.onmessage = () => lockRef.current(false);
    return () => {
      c.close();
      channel.current = null;
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
      if (
        statusRef.current === 'unlocked' &&
        Date.now() - activity.current > settingsRef.current.autoLockMinutes * 60000
      )
        lock();
    }, 1000);
    return () => clearInterval(timer);
  }, [lock]);
  useEffect(() => {
    let last = 0;
    const touch = () => {
      activity.current = Date.now();
      if (statusRef.current === 'unlocked' && Date.now() - last > 10000) {
        last = Date.now();
        void vaultCommand({ type: 'activity' }).catch(() => lock());
      }
    };
    const hidden = () => {
      if (document.hidden && settingsRef.current.lockOnHide && statusRef.current === 'unlocked')
        lock();
    };
    const pagehide = () => lock();
    for (const event of ['pointerdown', 'keydown', 'touchstart'])
      window.addEventListener(event, touch, { passive: true });
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', pagehide);
    return () => {
      for (const event of ['pointerdown', 'keydown', 'touchstart'])
        window.removeEventListener(event, touch);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', pagehide);
    };
  }, [lock]);
  const apply = useCallback((data: WorkerData) => {
    if (data.header) {
      setHeader(data.header);
      void vaultHeaders().then(setHeaders);
    }
    if (data.records) setRecords(data.records);
    if (data.settings) setSettings(data.settings);
    if (data.corrupt) setCorrupt(data.corrupt);
  }, []);
  const command = useCallback(
    async (cmd: WorkerCommand): Promise<WorkerData> => {
      setBusy(true);
      setError('');
      activity.current = Date.now();
      try {
        return await exclusive(async () => {
          const epoch = lockEpoch.current;
          channel.current?.postMessage('lock');
          const data = await vaultCommand(cmd);
          if (epoch !== lockEpoch.current) throw new Error('Vault is locked.');
          apply(data);
          if (['create', 'createShared', 'unlock', 'restore'].includes(cmd.type)) {
            statusRef.current = 'unlocked';
            setStatus('unlocked');
          }
          return data;
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Unable to complete this operation.';
        setError(message);
        if (message === 'Vault is locked.') lock();
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [apply, lock],
  );
  const unlock = useCallback(
    async (credential: string, method: 'passphrase' | 'recovery') => {
      return command({
        type: 'unlock',
        ...(await readSnapshot()),
        header: header!,
        credential,
        method,
      });
    },
    [command, header],
  );
  const refreshCodes = useCallback(
    async (ids: string[]) => {
      if (statusRef.current !== 'unlocked') return;
      const epoch = lockEpoch.current;
      try {
        const result = await vaultCommand({
          type: 'codes',
          ids: ids.slice(0, 100),
          timestamp: Math.floor(Date.now() / 1000),
        });
        if (result.codes && epoch === lockEpoch.current && statusRef.current === 'unlocked')
          setCodes(result.codes);
      } catch {
        lock();
      }
    },
    [lock],
  );
  const erase = useCallback(
    async (passphrase: string) => {
      await command({ type: 'reauth', passphrase });
      await exclusive(() => eraseVault());
      setHeader(null);
      void vaultHeaders().then(setHeaders);
      lock();
      setStatus('new');
    },
    [command, lock],
  );
  const switchVault = useCallback(
    async (id: string) => {
      lock();
      await exclusive(() => selectVault(id));
      const snapshot = await readSnapshot();
      setHeader(snapshot.header);
      setStatus('locked');
      setCorrupt([]);
      setError('');
    },
    [lock],
  );
  return {
    header,
    headers,
    records,
    settings,
    status,
    busy,
    error,
    setError,
    codes,
    corrupt,
    now,
    command,
    unlock,
    lock,
    refreshCodes,
    erase,
    switchVault,
  };
}
export type VaultController = ReturnType<typeof useVault>;
