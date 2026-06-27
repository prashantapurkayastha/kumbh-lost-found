// ─────────────────────────────────────────────────────────────────────────────
// Offline Queue — localStorage-backed queue for operations when offline
// Syncs automatically when connectivity is restored
// ─────────────────────────────────────────────────────────────────────────────

const QUEUE_KEY = "kumbh_offline_queue";

export interface QueuedOperation {
  id: string;
  type: "register_missing" | "register_found" | "sms" | "notify_desk";
  payload: Record<string, unknown>;
  createdAt: number;
  retries: number;
}

function loadQueue(): QueuedOperation[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveQueue(q: QueuedOperation[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {}
}

export function enqueue(op: Omit<QueuedOperation, "id" | "createdAt" | "retries">) {
  const queue = loadQueue();
  queue.push({ ...op, id: `q-${Date.now()}`, createdAt: Date.now(), retries: 0 });
  saveQueue(queue);
  console.log(`[offline] queued ${op.type}`);
}

export function getQueue(): QueuedOperation[] {
  return loadQueue();
}

export function dequeue(id: string) {
  const queue = loadQueue().filter((op) => op.id !== id);
  saveQueue(queue);
}

export function clearQueue() {
  localStorage.removeItem(QUEUE_KEY);
}

export function queueSize(): number {
  return loadQueue().length;
}

// ── Auto-sync when online ─────────────────────────────────────────────────────
// Call this once on app init. Each queued op gets retried in order.
type SyncHandler = (op: QueuedOperation) => Promise<boolean>;

export function startQueueSync(handler: SyncHandler) {
  async function attempt() {
    if (!navigator.onLine) return;
    const queue = loadQueue();
    if (queue.length === 0) return;

    console.log(`[offline] syncing ${queue.length} queued operations`);
    for (const op of queue) {
      try {
        const ok = await handler(op);
        if (ok) {
          dequeue(op.id);
          console.log(`[offline] synced ${op.type} ${op.id}`);
        } else {
          op.retries++;
          const q = loadQueue().map((x) => (x.id === op.id ? { ...x, retries: op.retries } : x));
          saveQueue(q);
        }
      } catch (err) {
        console.warn(`[offline] sync failed for ${op.id}:`, err);
      }
    }
  }

  window.addEventListener("online", attempt);
  // Also try on startup
  if (navigator.onLine) attempt();
}
