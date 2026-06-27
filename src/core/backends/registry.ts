import type {
  FoundPerson,
  MissingReport,
  HelpCenter,
  PoliceStation,
  ReunionPoint,
  CompletedReunion,
  SearchFoundPersonsInput,
  FoundPersonMatch,
  RegisterFoundPersonInput,
  RegisterMissingPersonInput,
  HandoverLog,
} from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// In-memory registry — the unified database all centers share
// (This is the entire point of the demo: one registry visible to all centers)
// ─────────────────────────────────────────────────────────────────────────────

let foundPersons: FoundPerson[] = [];
let missingReports: MissingReport[] = [];
let helpCenters: HelpCenter[] = [];
let policeStations: PoliceStation[] = [];
let reunionPoints: ReunionPoint[] = [];
let completedReunions: CompletedReunion[] = [];
let handoverLogs: HandoverLog[] = [];
let fpCounter = 100;
let lpCounter = 25000;

function gen4PIN(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// ─── Load functions (called by seed.ts) ──────────────────────────────────────

export const registry = {
  // ── Seed loaders ────────────────────────────────────────────────────────────
  loadFoundPersons(data: FoundPerson[]) {
    foundPersons = [...data];
  },
  loadMissingReports(data: MissingReport[]) {
    missingReports = [...data];
  },
  loadHelpCenters(data: HelpCenter[]) {
    helpCenters = [...data];
  },
  loadPoliceStations(data: PoliceStation[]) {
    policeStations = [...data];
  },
  loadReunionPoints(data: ReunionPoint[]) {
    reunionPoints = [...data];
  },
  loadCompletedReunions(data: CompletedReunion[]) {
    completedReunions = [...data];
  },

  // ── Getters ──────────────────────────────────────────────────────────────────
  getAllFoundPersons(): FoundPerson[] {
    return foundPersons
      .filter((p) => p.status === "waiting")
      .filter(p => !p.expiresAt || new Date(p.expiresAt) > new Date());
  },
  getAllMissingReports(): MissingReport[] {
    return missingReports
      .filter((r) => r.status === "active")
      .filter(p => !p.expiresAt || new Date(p.expiresAt) > new Date());
  },
  getHelpCenters(): HelpCenter[] {
    return helpCenters;
  },
  getPoliceStations(): PoliceStation[] {
    return policeStations;
  },
  getReunionPoints(): ReunionPoint[] {
    return reunionPoints;
  },
  getCompletedReunions(): CompletedReunion[] {
    return completedReunions;
  },

  getCenterById(id: string): HelpCenter | undefined {
    return helpCenters.find((c) => c.id === id);
  },
  getCentersInZone(zone: string): HelpCenter[] {
    return helpCenters.filter((c) =>
      c.zone.toLowerCase().includes(zone.toLowerCase()) ||
      zone.toLowerCase().includes(c.zone.toLowerCase())
    );
  },
  getReunionPointForZone(zone: string): ReunionPoint | undefined {
    return reunionPoints.find((rp) =>
      rp.zone.toLowerCase().includes(zone.toLowerCase()) ||
      zone.toLowerCase().includes(rp.zone.toLowerCase())
    ) ?? reunionPoints[0];
  },

  // ── Stats ─────────────────────────────────────────────────────────────────────
  getStats() {
    const active = missingReports.filter((r) => r.status === "active");
    const resolved = missingReports.filter((r) => r.status === "resolved");
    const duplicates = missingReports.filter((r) => r.is_duplicate_report);
    const crossCenter = completedReunions.filter((r) => r.cross_center);
    return {
      foundPersonsWaiting: foundPersons.filter((p) => p.status === "waiting").length,
      missingReportsActive: active.length,
      reunionsCompleted: resolved.length + completedReunions.length,
      activeSearches: active.filter((r) => !r.is_duplicate_report).length,
      duplicateReportsCaught: duplicates.length,
      crossCenterMatches: crossCenter.length,
    };
  },

  // ── Search found persons (called by search_found_persons tool) ───────────────
  searchFound(input: SearchFoundPersonsInput): FoundPersonMatch[] {
    const waiting = foundPersons.filter((p) => p.status === "waiting");

    return waiting
      .map((person): FoundPersonMatch => {
        let score = 0;
        const reasons: string[] = [];

        // Gender match (+0.20)
        if (input.gender && input.gender !== "unknown") {
          if (person.gender === input.gender) {
            score += 0.20;
            reasons.push("gender matches");
          } else {
            score -= 0.10; // penalise wrong gender
          }
        }

        // Age range overlap (+0.25)
        if (input.ageRange) {
          const overlap = ageRangesOverlap(person.ageRange, input.ageRange);
          if (overlap) {
            score += 0.25;
            reasons.push(`age range matches (${person.ageRange})`);
          }
        }

        // Clothing description overlap (+0.25)
        if (input.clothingDescription) {
          const clothScore = clothingOverlapScore(
            person.clothing + " " + person.clothing_features.join(" "),
            input.clothingDescription
          );
          score += clothScore * 0.25;
          if (clothScore > 0.4) reasons.push(`clothing matches (${Math.round(clothScore * 100)}%)`);
        }

        // Zone/location match (+0.15)
        if (input.lastSeenZone) {
          const zoneMatch = locationOverlap(
            person.foundZone + " " + person.lastSeenLocation,
            input.lastSeenZone
          );
          if (zoneMatch) {
            score += 0.15;
            reasons.push(`location match (found at ${person.foundZone})`);
          }
        }

        // Language match (+0.10)
        if (input.languageSpoken && person.languageSpoken) {
          if (
            person.languageSpoken.toLowerCase() === input.languageSpoken.toLowerCase()
          ) {
            score += 0.10;
            reasons.push(`language matches (${person.languageSpoken})`);
          }
        }

        // Photo provided — use simulated confidence (+photoMatchConfidence)
        if (input.photoProvided && person.photoMatchConfidence) {
          score += person.photoMatchConfidence * 0.25;
          reasons.push(`photo match ${Math.round(person.photoMatchConfidence * 100)}%`);
        }

        const confidence = Math.min(Math.max(score, 0), 1.0);
        const matchReason = reasons.length > 0
          ? reasons.join(", ")
          : "partial description overlap";

        return {
          ...person,
          confidence,
          matchReason,
          is_cross_center_match: false, // set externally if needed
        };
      })
      .filter((r) => r.confidence >= 0.40)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);
  },

  // ── Register missing person ───────────────────────────────────────────────────
  addMissingReport(input: RegisterMissingPersonInput & { reportingCenter?: string }): MissingReport {
    const id = `LP-${String(lpCounter++).padStart(5, "0")}`;

    // Duplicate detection: same name + similar age + similar clothing
    const possibleDuplicate = missingReports.find((r) => {
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
      return (nameMatch || (ageMatch && clothMatch));
    });

    const report: MissingReport = {
      id,
      reportedBy: input.reporterName ?? "Unknown",
      contactNumber: input.contactNumber,
      reportingCenter: input.reportingCenter ?? "Unknown Center",
      verificationCode: gen4PIN(),
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
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
    };

    missingReports.push(report);
    return report;
  },

  // ── Register found person ─────────────────────────────────────────────────────
  addFoundPerson(input: RegisterFoundPersonInput): FoundPerson {
    const id = `FP-${String(fpCounter++).padStart(3, "0")}`;
    const center = helpCenters.find((c) => c.id === input.centerId);

    const fp: FoundPerson = {
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
      status: "waiting",
      is_potential_duplicate: false,
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    };

    foundPersons.push(fp);
    return fp;
  },

  // ── Handover verification ──────────────────────────────────────────────────────
  verifyHandover(reportId: string, fpId: string, code: string): {
    ok: boolean;
    report?: MissingReport;
    foundPerson?: FoundPerson;
    message: string;
  } {
    const report = missingReports.find(r => r.id === reportId);
    if (!report) return { ok: false, message: `No report found with ID ${reportId}` };
    if (report.status !== "active") return { ok: false, message: `Report ${reportId} is already ${report.status}` };
    if (report.verificationCode !== code.trim()) {
      return { ok: false, report, message: "❌ Verification code does not match — do not release. Re-confirm identity or call police (100)." };
    }
    const fp = fpId ? foundPersons.find(p => p.id === fpId) : undefined;
    return {
      ok: true,
      report,
      foundPerson: fp,
      message: `✅ Identity verified — safe to release ${fp ? fp.id : ""}. Report filed by ${report.reportedBy}.`,
    };
  },

  logHandover(reportId: string, fpId: string, centerId: string, operatorId: string) {
    const log: HandoverLog = {
      id: `HO-${Date.now()}`,
      reportId,
      foundPersonId: fpId,
      verifiedBy: operatorId,
      verifiedAt: new Date().toISOString(),
      centerId,
    };
    handoverLogs.push(log);
    this.resolveReport(reportId, fpId);
    return log;
  },

  getHandoverLogs(): HandoverLog[] {
    return handoverLogs;
  },

  getMissingReportById(id: string): MissingReport | undefined {
    return missingReports.find(r => r.id === id);
  },

  getFoundPersonById(id: string): FoundPerson | undefined {
    return foundPersons.find(p => p.id === id);
  },

  // ── Mark reunited ─────────────────────────────────────────────────────────────
  resolveReport(missingReportId: string, foundPersonId: string) {
    const report = missingReports.find((r) => r.id === missingReportId);
    if (report) {
      report.status = "resolved";
      report.matchedFoundPersonId = foundPersonId;
    }
    const fp = foundPersons.find((p) => p.id === foundPersonId);
    if (fp) fp.status = "reunited";
  },

  // ── Search missing reports (for volunteer flow) ───────────────────────────────
  searchMissingReports(fp: FoundPerson) {
    const active = missingReports.filter(
      (r) => r.status === "active" && !r.is_duplicate_report
    );
    return active
      .map((report) => {
        const mp = report.missingPerson;
        let score = 0;
        const reasons: string[] = [];

        if (mp.gender === fp.gender) { score += 0.20; reasons.push("gender"); }
        if (ageRangesOverlap(mp.ageRange, fp.ageRange)) { score += 0.25; reasons.push("age"); }
        const cloth = clothingOverlapScore(mp.clothing, fp.clothing);
        score += cloth * 0.30;
        if (cloth > 0.3) reasons.push("clothing");
        if (locationOverlap(mp.lastSeenLocation, fp.foundZone)) { score += 0.15; reasons.push("zone"); }
        if (mp.languageSpoken === fp.languageSpoken) { score += 0.10; reasons.push("language"); }

        return {
          missingReportId: report.id,
          reportedBy: report.reportedBy,
          reportingCenter: report.reportingCenter,
          contactNumber: report.contactNumber,
          confidence: Math.min(score, 1.0),
          matchReason: reasons.join(", "),
          is_cross_center_match: report.reportingCenter !== fp.centerName,
        };
      })
      .filter((r) => r.confidence >= 0.40)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);
  },

  reset() {
    foundPersons = [];
    missingReports = [];
    helpCenters = [];
    policeStations = [];
    reunionPoints = [];
    completedReunions = [];
    fpCounter = 100;
    lpCounter = 25000;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper: parse "7-9", "65-75", "80+", "41-60" etc. into [min, max]
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
  // Try to extract first number
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

// ─────────────────────────────────────────────────────────────────────────────
// Helper: keyword overlap between two clothing descriptions (0–1)
// ─────────────────────────────────────────────────────────────────────────────
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
  // Apply synonyms
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
  const denominator = Math.max(wb.length, 1);
  return matches / denominator;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: does location string contain zone keyword?
// ─────────────────────────────────────────────────────────────────────────────
function locationOverlap(locationStr: string, zone: string): boolean {
  const loc = locationStr.toLowerCase();
  const z = zone.toLowerCase();
  // Direct substring check
  if (loc.includes(z) || z.includes(loc.split(" ")[0])) return true;
  // Key landmark aliases
  const ZONE_ALIASES: Record<string, string[]> = {
    ramkund: ["ramkund", "ram kund", "godavari ghat", "dasak ghat"],
    panchavati: ["panchavati", "panchvati", "panchavati circle", "gauri patangan"],
    trimbakeshwar: ["trimbak", "trimbakeshwar", "kushavart", "kushavarta"],
    sadhugram: ["sadhugram", "sadhu gram", "sadhugram gate"],
    tapovan: ["tapovan"],
    "nashik road": ["nashik road", "nashik railway", "bus stand"],
    adgaon: ["adgaon"],
  };
  for (const [key, aliases] of Object.entries(ZONE_ALIASES)) {
    if (z.includes(key) || key.includes(z)) {
      if (aliases.some((alias) => loc.includes(alias))) return true;
    }
  }
  return false;
}
