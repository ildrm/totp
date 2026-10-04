import type { WorkerCommand, WorkerData, WorkerResponse } from './worker-protocol';
let worker: Worker | null = null,
  sequence = 0;
const pending = new Map<
  number,
  {
    resolve: (data: WorkerData) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
function instance(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./vault.worker.ts', import.meta.url), {
      name: 'still-vault',
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      const item = pending.get(response.id);
      if (!item) return;
      clearTimeout(item.timer);
      pending.delete(response.id);
      if (response.ok) item.resolve(response.data);
      else item.reject(new Error(response.error));
    };
    worker.onerror = () => terminate();
  }
  return worker;
}
export function vaultCommand(command: WorkerCommand): Promise<WorkerData> {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      terminate();
      reject(new Error('Vault operation timed out. Unlock and try again.'));
    }, 120000);
    pending.set(id, { resolve, reject, timer });
    instance().postMessage({ id, command });
  });
}
export function terminate(): void {
  worker?.terminate();
  worker = null;
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(new Error('Vault is locked.'));
  }
  pending.clear();
}
export async function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  // Cross-tab mutations require Web Locks; BroadcastChannel also locks peer workers.
  if (!navigator.locks)
    throw new Error('This browser lacks safe multi-tab storage locking. Use a current browser.');
  return navigator.locks.request('still-vault-mutation', { mode: 'exclusive' }, operation);
}
