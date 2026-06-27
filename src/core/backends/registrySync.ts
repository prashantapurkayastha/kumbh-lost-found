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

  if (!data) return false; // server unreachable — local state stands

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
