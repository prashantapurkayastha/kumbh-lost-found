import fs from "fs";
import path from "path";

import type {
  FoundPerson,
  MissingReport,
  HelpCenter,
  PoliceStation,
  ReunionPoint,
  CompletedReunion,
  HandoverLog,
  SearchFoundPersonsInput,
  FoundPersonMatch,
  RegisterFoundPersonInput,
  RegisterMissingPersonInput,
} from "../src/types";

export type {
  FoundPerson,
  MissingReport,
  HelpCenter,
  PoliceStation,
  ReunionPoint,
  CompletedReunion,
  HandoverLog,
  SearchFoundPersonsInput,
  FoundPersonMatch,
  RegisterFoundPersonInput,
  RegisterMissingPersonInput,
};

// ─── Extended HandoverLog stored on server ────────────────────────────────────
export interface ExtendedHandoverLog extends HandoverLog {
  policeEscortArranged: boolean;
  reunionPointId: string;
  witnessVolunteerId?: string;
}

// ─── Persisted state shape ────────────────────────────────────────────────────
interface PersistedState {
  foundPersons: (FoundPerson & { expiresAt: string })[];
  missingReports: (MissingReport & { expiresAt: string })[];
  helpCenters: HelpCenter[];
  policeStations: PoliceStation[];
  reunionPoints: ReunionPoint[];
  completedReunions: CompletedReunion[];
  handoverLogs: ExtendedHandoverLog[];
  fpCounter: number;
  lpCounter: number;
}

// ─── Seed data shape ──────────────────────────────────────────────────────────
interface SeedData {
  helpCenters: HelpCenter[];
  policeStations: PoliceStation[];
  reunionPoints: ReunionPoint[];
  foundPersons: FoundPerson[];
  missingPersonReports: MissingReport[];
  completedReunions: CompletedReunion[];
}

// ─── File paths ───────────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, "../data");
const REGISTRY_FILE = path.join(DATA_DIR, "registry.json");
const REGISTRY_TMP = path.join(DATA_DIR, "registry.json.tmp");
const SEED_FILE = path.join(__dirname, "../SEED_DATA.json");

// ─── TTL: 72 hours in milliseconds ───────────────────────────────────────────
const TTL_MS = 72 * 60 * 60 * 1000;

function gen4PIN(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function makeExpiresAt(): string {
  return new Date(Date.now() + TTL_MS).toISOString();
}

// ─── Load initial state ───────────────────────────────────────────────────────
function loadInitialState(): PersistedState {
  // Try reading existing registry file first
  if (fs.existsSync(REGISTRY_FILE)) {
    try {
      const raw = fs.readFileSync(REGISTRY_FILE, "utf-8");
      const parsed = JSON.parse(raw) as PersistedState;
      console.log("[store] Loaded state from", REGISTRY_FILE);
      return parsed;
    } catch (err) {
      console.warn("[store] Failed to parse registry.json, falling back to seed:", err);
    }
  }

  // Fall back to seed data
  const seed: SeedData = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"));

  // Seed records get a fresh TTL from now
  const expiresAt = makeExpiresAt();

  const foundPersons = seed.foundPersons.map((fp) => ({ ...fp, expiresAt }));
  const missingReports = seed.missingPersonReports.map((r) => ({
    ...r,
    expiresAt,
    // Generate verificationCode if missing
    verificationCode: r.verificationCode ?? gen4PIN(),
  }));

  const state: PersistedState = {
    foundPersons,
    missingReports,
    helpCenters: seed.helpCenters,
    policeStations: seed.policeStations,
    reunionPoints: seed.reunionPoints,
    completedReunions: seed.completedReunions ?? [],
    handoverLogs: [],
    fpCounter: 100 + foundPersons.length,
    lpCounter: 25000 + missingReports.length,
  };

  console.log("[store] Loaded seed data; foundPersons:", foundPersons.length, "missingReports:", missingReports.length);
  return state;
}

// ─── Atomic write ─────────────────────────────────────────────────────────────
function persist(s: PersistedState): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(REGISTRY_TMP, JSON.stringify(s, null, 2), "utf-8");
  fs.renameSync(REGISTRY_TMP, REGISTRY_FILE);
}

// ─── Singleton state ──────────────────────────────────────────────────────────
let state: PersistedState = loadInitialState();

// ─── TTL filter helpers ───────────────────────────────────────────────────────
function notExpired<T extends { expiresAt: string }>(record: T): boolean {
  return new Date(record.expiresAt).getTime() > Date.now();
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper functions (copied from registry.ts)
// ─────────────────────────────────────────────────────────────────────────────

function parseAgeRange(s: string): [number, number] {
  const plusMatch = s.match(/^(\d+)\+$/);
  if (plusMatch) return [parseInt(plusMatch[1]), 120];
  const dashMatch = s.match(/^(\d+)[-–](\d+)$/);
  if (dashMatch) return [parseInt(dashMatch[1]), parseInt(dashMatch[2])];
  const singleMatch = s.match(/^(\d+)s?$/);
  if (singleMatch) {
    const n = parseInt(singleMatch[1]);
    return [n, n + 9];
  }
  const nums = s.match(/\d+/g);
  if (nums && nums.length >= 2) return [parseInt(nums[0]), parseInt(nums[1])];
  if (nums && nums.length === 1) { const n = parseInt(nums[0]); return [n, n + 10]; }
  return [0, 120];
}

function ageRangesOverlap(a: string, b: string): boolean {
  const [aMin, aMax] = parseAgeRange(a);
  const [bMin, bMax] = parseAgeRange(b);
  return aMin <= bMax && bMin <= aMax;
}

const CLOTHING_STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "with", "has", "wearing", "wears",
  "in", "on", "is", "was", "are", "have", "had", "about",
]);

const CLOTHING_SYNONYMS: [string, string][] = [
  ["kurta", "shirt"],
  ["kurta", "top"],
  ["saree", "sari"],
  ["dhoti", "white cloth"],
  ["shawl", "uttariya"],
  ["shawl", "stole"],
  ["dupatta", "scarf"],
  ["lehenga", "skirt"],
  ["frock", "dress"],
  ["trousers", "pants"],
  ["pyjama", "pajama"],
];

function normaliseClothing(text: string): string[] {
  let t = text.toLowerCase();
  for (const [a, b] of CLOTHING_SYNONYMS) {
    t = t.replace(new RegExp(b, "g"), a);
  }
  return t
    .split(/[\s,()]+/)
    .map((w) => w.replace(/[^a-z]/g, ""))
    .filter((w) => w.length > 2 && !CLOTHING_STOP_WORDS.has(w));
}

function clothingOverlapScore(a: string, b: string): number {
  const wa = normaliseClothing(a);
  const wb = normaliseClothing(b);
  if (wa.length === 0 || wb.length === 0) return 0;
  const setA = new Set(wa);
  const matches = wb.filter((w) => setA.has(w)).length;
  return matches / Math.max(wb.length, 1);
}

const ZONE_ALIASES: Record<string, string[]> = {
  ramkund: ["ramkund", "ram kund", "godavari ghat", "dasak ghat"],
  panchavati: ["panchavati", "panchvati", "panchavati circle", "gauri patangan"],
  trimbakeshwar: ["trimbak", "trimbakeshwar", "kushavart", "kushavarta"],
  sadhugram: ["sadhugram", "sadhu gram", "sadhugram gate"],
  tapovan: ["tapovan"],
  "nashik road": ["nashik road", "nashik railway", "bus stand"],
  adgaon: ["adgaon"],
};

function locationOverlap(locationStr: string, zone: string): boolean {
  const loc = locationStr.toLowerCase();
  const z = zone.toLowerCase();
  if (loc.includes(z) || z.includes(loc.split(" ")[0])) return true;
  for (const [key, aliases] of Object.entries(ZONE_ALIASES)) {
    if (z.includes(key) || key.includes(z)) {
      if (aliases.some((alias) => loc.includes(alias))) return true;
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// The store — singleton exported object
// ─────────────────────────────────────────────────────────────────────────────
export const store = {
  // ── Getters (with TTL filter) ─────────────────────────────────────────────
  getAllFoundPersons(): FoundPerson[] {
    return state.foundPersons
      .filter((p) => notExpired(p) && p.status === "waiting");
  },

  getAllMissingReports(): MissingReport[] {
    return state.missingReports
      .filter((r) => notExpired(r) && r.status === "active");
  },

  getHelpCenters(): HelpCenter[] {
    return state.helpCenters;
  },

  getPoliceStations(): PoliceStation[] {
    return state.policeStations;
  },

  getReunionPoints(): ReunionPoint[] {
    return state.reunionPoints;
  },

  getHandoverLogs(): ExtendedHandoverLog[] {
    return state.handoverLogs;
  },

  getStats() {
    const active = state.missingReports.filter((r) => notExpired(r) && r.status === "active");
    const resolved = state.missingReports.filter((r) => r.status === "resolved");
    const duplicates = state.missingReports.filter((r) => r.is_duplicate_report);
    const crossCenter = state.completedReunions.filter((r) => r.cross_center);
    return {
      foundPersonsWaiting: state.foundPersons.filter((p) => notExpired(p) && p.status === "waiting").length,
      missingReportsActive: active.length,
      reunionsCompleted: resolved.length + state.completedReunions.length,
      activeSearches: active.filter((r) => !r.is_duplicate_report).length,
      duplicateReportsCaught: duplicates.length,
      crossCenterMatches: crossCenter.length,
    };
  },

  getMissingReportById(id: string): MissingReport | undefined {
    return state.missingReports.find((r) => r.id === id);
  },

  flagSuspicion(reportId: string, notes: string): boolean {
    const report = state.missingReports.find((r) => r.id === reportId);
    if (!report) return false;
    report.suspicionFlag = true;
    report.suspicionNotes = notes;
    report.held = true;
    persist(state);
    return true;
  },

  // ── Mutations ─────────────────────────────────────────────────────────────
  addFoundPerson(input: RegisterFoundPersonInput): FoundPerson {
    const id = `FP-${String(state.fpCounter++).padStart(3, "0")}`;
    const center = state.helpCenters.find((c) => c.id === input.centerId);

    const fp: FoundPerson & { expiresAt: string } = {
      id,
      ageRange: input.ageRange,
      gender: input.gender,
      name: "Unknown",
      clothing: input.clothingDescription,
      clothing_features: input.clothingDescription.toLowerCase().split(/[\s,]+/),
      foundZone: input.foundZone,
      lastSeenLocation: input.foundZone,
      foundAt: input.foundTime ?? new Date().toISOString(),
      centerId: input.centerId,
      centerName: center?.name ?? input.centerId,
      languageSpoken: input.languageSpoken ?? "Unknown",
      condition: input.condition ?? "calm",
      physicalDescription: "",
      photoMatchConfidence: input.photoProvided ? 0.65 : 0,
      photoBase64: input.photoBase64,
      status: "waiting",
      is_potential_duplicate: false,
      expiresAt: makeExpiresAt(),
      // Care disposition
      disposition: input.disposition ?? "active",
      dispositionNotes: input.dispositionNotes,
      familyExpected: input.familyExpected ?? true,
      // Minor flags
      isMinorUnaccompanied: input.isMinorUnaccompanied ?? false,
      childKnowsName: input.childKnowsName,
      childHometown: input.childHometown,
    };

    state.foundPersons.push(fp);
    persist(state);
    return fp;
  },

  addMissingReport(input: RegisterMissingPersonInput & { reportingCenter?: string }): MissingReport {
    const id = `LP-${String(state.lpCounter++).padStart(5, "0")}`;

    const possibleDuplicate = state.missingReports.find((r) => {
      if (r.status !== "active") return false;
      const mp = r.missingPerson;
      const nameMatch =
        input.name &&
        mp.name &&
        input.name.toLowerCase().trim() === mp.name.toLowerCase().trim();
      const ageMatch = input.ageRange && ageRangesOverlap(mp.ageRange, input.ageRange);
      const clothMatch =
        input.clothingDescription &&
        clothingOverlapScore(mp.clothing, input.clothingDescription) > 0.5;
      return nameMatch || (ageMatch && clothMatch);
    });

    const report: MissingReport & { expiresAt: string } = {
      id,
      reportedBy: input.reporterName ?? "Unknown",
      contactNumber: input.contactNumber,
      reportingCenter: input.reportingCenter ?? "Unknown Center",
      verificationCode: gen4PIN(),
      missingPerson: {
        name: input.name,
        ageRange: input.ageRange,
        gender: input.gender,
        clothing: input.clothingDescription,
        lastSeenLocation: input.lastSeenZone,
        lastSeenTime: input.lastSeenTime ?? new Date().toISOString(),
        languageSpoken: input.languageSpoken ?? "Unknown",
        additionalDetails: input.additionalDetails,
      },
      registeredAt: new Date().toISOString(),
      status: "active",
      matchedFoundPersonId: null,
      is_duplicate_report: !!possibleDuplicate,
      duplicate_of: possibleDuplicate?.id,
      expiresAt: makeExpiresAt(),
    };

    state.missingReports.push(report);
    persist(state);
    return report;
  },

  verifyAndHandover(
    reportId: string,
    fpId: string,
    code: string,
    centerId: string,
    operatorId: string,
    minorEscort: boolean,
    reunionPointId: string,
    witnessVolunteerId?: string,
  ): { ok: true; log: ExtendedHandoverLog } | { ok: false; message: string } {
    const report = state.missingReports.find((r) => r.id === reportId);
    if (!report) return { ok: false, message: `No report found with ID ${reportId}` };
    if (report.status !== "active") return { ok: false, message: `Report ${reportId} is already ${report.status}` };
    if (report.verificationCode !== code.trim()) {
      return { ok: false, message: "Verification code does not match — do not release." };
    }

    const log: ExtendedHandoverLog = {
      id: `HO-${Date.now()}`,
      reportId,
      foundPersonId: fpId,
      verifiedBy: operatorId,
      verifiedAt: new Date().toISOString(),
      centerId,
      policeEscortArranged: minorEscort,
      reunionPointId,
      witnessVolunteerId,
    };

    state.handoverLogs.push(log);

    // Resolve the report and mark found person reunited
    report.status = "resolved";
    report.matchedFoundPersonId = fpId;
    const fp = state.foundPersons.find((p) => p.id === fpId);
    if (fp) fp.status = "reunited";

    persist(state);
    return { ok: true, log };
  },

  // ── Search (copied from registry.ts) ─────────────────────────────────────
  searchFound(input: SearchFoundPersonsInput): FoundPersonMatch[] {
    const waiting = state.foundPersons.filter((p) => notExpired(p) && p.status === "waiting");

    return waiting
      .map((person): FoundPersonMatch => {
        let score = 0;
        const reasons: string[] = [];

        if (input.gender && input.gender !== "unknown") {
          if (person.gender === input.gender) {
            score += 0.20;
            reasons.push("gender matches");
          } else {
            score -= 0.10;
          }
        }

        if (input.ageRange) {
          const overlap = ageRangesOverlap(person.ageRange, input.ageRange);
          if (overlap) {
            score += 0.25;
            reasons.push(`age range matches (${person.ageRange})`);
          }
        }

        if (input.clothingDescription) {
          const clothScore = clothingOverlapScore(
            person.clothing + " " + person.clothing_features.join(" "),
            input.clothingDescription,
          );
          score += clothScore * 0.25;
          if (clothScore > 0.4) reasons.push(`clothing matches (${Math.round(clothScore * 100)}%)`);
        }

        if (input.lastSeenZone) {
          const zoneMatch = locationOverlap(
            person.foundZone + " " + person.lastSeenLocation,
            input.lastSeenZone,
          );
          if (zoneMatch) {
            score += 0.15;
            reasons.push(`location match (found at ${person.foundZone})`);
          }
        }

        if (input.languageSpoken && person.languageSpoken) {
          if (person.languageSpoken.toLowerCase() === input.languageSpoken.toLowerCase()) {
            score += 0.10;
            reasons.push(`language matches (${person.languageSpoken})`);
          }
        }

        if (input.photoProvided && person.photoMatchConfidence) {
          score += person.photoMatchConfidence * 0.25;
          reasons.push(`photo match ${Math.round(person.photoMatchConfidence * 100)}%`);
        }

        const confidence = Math.min(Math.max(score, 0), 1.0);
        const matchReason = reasons.length > 0 ? reasons.join(", ") : "partial description overlap";

        return {
          ...person,
          confidence,
          matchReason,
          is_cross_center_match: false,
        };
      })
      .filter((r) => r.confidence >= 0.40)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);
  },
};
