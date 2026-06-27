import { registry } from "../core/backends/registry";
import seedData from "../../SEED_DATA.json";
import type {
  HelpCenter,
  PoliceStation,
  ReunionPoint,
  FoundPerson,
  MissingReport,
  CompletedReunion,
} from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Seed all in-memory registries from SEED_DATA.json
// Call once on app startup
// ─────────────────────────────────────────────────────────────────────────────

export function seedRegistry() {
  registry.reset();

  registry.loadHelpCenters(seedData.helpCenters as HelpCenter[]);
  registry.loadPoliceStations(seedData.policeStations as PoliceStation[]);
  registry.loadReunionPoints(seedData.reunionPoints as ReunionPoint[]);
  registry.loadFoundPersons(seedData.foundPersons as FoundPerson[]);
  // Backfill verification codes for seeded reports that don't have one
  const seededReports = (seedData.missingPersonReports as MissingReport[]).map(r => ({
    ...r,
    verificationCode: r.verificationCode ?? String(Math.floor(1000 + Math.random() * 9000)),
  }));
  registry.loadMissingReports(seededReports);
  registry.loadCompletedReunions(seedData.completedReunions as CompletedReunion[]);

  console.log("[seed] Registry loaded:");
  const stats = registry.getStats();
  console.log(`  Help centers:       ${registry.getHelpCenters().length}`);
  console.log(`  Police stations:    ${registry.getPoliceStations().length}`);
  console.log(`  Reunion points:     ${registry.getReunionPoints().length}`);
  console.log(`  Found persons:      ${stats.foundPersonsWaiting} waiting`);
  console.log(`  Missing reports:    ${stats.missingReportsActive} active`);
  console.log(`  Duplicate reports:  ${stats.duplicateReportsCaught} detected`);
}
