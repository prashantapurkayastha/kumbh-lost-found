// ─────────────────────────────────────────────────────────────────────────────
// registrySync.ts — bridges the client-side in-memory registry to the
// server-side file-backed store.
//
// Strategy:
//  • Reads: poll GET /api/registry/state every 3 s → reload local registry
//  • Writes: intercept addFoundPerson / addMissingReport / logHandover and
//    mirror the call to the server so data is persisted and visible to all
//    browser tabs / connected clients.
//
// Graceful degradation: if the server is unreachable, the in-memory registry
// continues to work as before (offline-first).
// ─────────────────────────────────────────────────────────────────────────────

import { registry } from "./registry";
import type {
  FoundPerson,
  MissingReport,
  HelpCenter,
  PoliceStation,
  ReunionPoint,
  CompletedReunion,
} from "../../types";

const API = "/api/registry";

// ── Offline cache ─────────────────────────────────────────────────────────────
const CACHE_KEY = "kumbh_registry_cache";
const CACHE_TS_KEY = "kumbh_registry_cache_ts";

export type SyncStatus = "online" | "offline" | "unknown";
let _syncStatus: SyncStatus = "unknown";
let _lastSyncTime: number | null = null;

/** Current connectivity status as seen by the registry sync */
export function getSyncStatus(): SyncStatus { return _syncStatus; }
export function getLastSyncTime(): number | null { return _lastSyncTime; }

function saveToCache(data: unknown) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    localStorage.setItem(CACHE_TS_KEY, String(Date.now()));
  } catch { /* storage full — silently ignore */ }
}

function loadFromCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const ts = localStorage.getItem(CACHE_TS_KEY);
    if (!raw) return null;
    return { data: JSON.parse(raw), ts: ts ? Number(ts) : null };
  } catch {
    return null;
  }
}

function emitSyncStatus(status: SyncStatus) {
  if (_syncStatus !== status) {
    _syncStatus = status;
    window.dispatchEvent(new CustomEvent("registry:sync-status", { detail: { status, lastSyncTime: _lastSyncTime } }));
  }
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function post<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ── Pull: load server state into local registry ───────────────────────────────

export async function syncFromServer(): Promise<boolean> {
  const data = await get<{
    foundPersons: FoundPerson[];
    missingReports: MissingReport[];
    helpCenters: HelpCenter[];
    policeStations: PoliceStation[];
    reunionPoints: ReunionPoint[];
    completedReunions: CompletedReunion[];
  }>("/state");

  if (!data) {
    // Server unreachable — try localStorage cache
    const cached = loadFromCache();
    if (cached?.data) {
      registry.loadFoundPersons(cached.data.foundPersons ?? []);
      registry.loadMissingReports(cached.data.missingReports ?? []);
      registry.loadHelpCenters(cached.data.helpCenters ?? []);
      registry.loadPoliceStations(cached.data.policeStations ?? []);
      registry.loadReunionPoints(cached.data.reunionPoints ?? []);
      registry.loadCompletedReunions(cached.data.completedReunions ?? []);
    }
    emitSyncStatus("offline");
    return false;
  }

  // Successful sync — save to cache for offline fallback
  saveToCache(data);
  _lastSyncTime = Date.now();
  emitSyncStatus("online");

  registry.loadFoundPersons(data.foundPersons ?? []);
  registry.loadMissingReports(data.missingReports ?? []);
  registry.loadHelpCenters(data.helpCenters ?? []);
  registry.loadPoliceStations(data.policeStations ?? []);
  registry.loadReunionPoints(data.reunionPoints ?? []);
  registry.loadCompletedReunions(data.completedReunions ?? []);
  return true;
}

// ── Push: write-through wrappers ──────────────────────────────────────────────

/** Wraps registry.addFoundPerson — persists to server, falls back to local */
export async function addFoundPersonSync(
  input: Parameters<typeof registry.addFoundPerson>[0]
): Promise<FoundPerson> {
  // Optimistic local update for instant UI feedback
  const local = registry.addFoundPerson(input);

  // Fire-and-forget to server; on success the next poll will reconcile
  const remote = await post<FoundPerson>("/found-persons", input);

  if (remote) {
    // Replace the optimistic record with the server's canonical one (has TTL, server ID)
    // Reload full state so the ID is consistent
    await syncFromServer();
    return remote;
  }

  return local;
}

/** Wraps registry.addMissingReport — persists to server, falls back to local */
export async function addMissingReportSync(
  input: Parameters<typeof registry.addMissingReport>[0] & { reportingCenter?: string }
): Promise<MissingReport> {
  const local = registry.addMissingReport(input);

  const remote = await post<MissingReport>("/missing-reports", input);

  if (remote) {
    await syncFromServer();
    return remote;
  }

  return local;
}

/** Persists a handover to the server */
export async function logHandoverSync(
  reportId: string,
  fpId: string,
  centerId: string,
  operatorId: string,
  opts: {
    code?: string;
    minorEscort?: boolean;
    reunionPointId?: string;
    witnessVolunteerId?: string;
  } = {}
): Promise<boolean> {
  const result = await post("/handover", {
    reportId,
    foundPersonId: fpId,
    code: opts.code ?? "",
    centerId,
    operatorId,
    minorEscort: opts.minorEscort ?? false,
    reunionPointId: opts.reunionPointId ?? "",
    witnessVolunteerId: opts.witnessVolunteerId,
  });

  if (result) {
    // Also update local registry
    registry.logHandover(reportId, fpId, centerId, operatorId);
    await syncFromServer();
    return true;
  }

  // Fallback: local-only
  registry.logHandover(reportId, fpId, centerId, operatorId);
  return false;
}

/** Flag a suspicious claimant — mirrors to server, falls back to local */
export async function flagSuspicionSync(reportId: string, notes: string): Promise<boolean> {
  registry.flagSuspicion(reportId, notes);
  const result = await post("/flag-suspicion", { reportId, notes });
  return !!result;
}

// ── Start polling ─────────────────────────────────────────────────────────────

let _stopPoll: (() => void) | null = null;

export function startRegistrySync(intervalMs = 3000): () => void {
  if (_stopPoll) _stopPoll(); // cancel any prior interval

  // Initial sync — replace seed data with server state on first load
  syncFromServer();

  const id = window.setInterval(syncFromServer, intervalMs);
  _stopPoll = () => clearInterval(id);
  return _stopPoll;
}
