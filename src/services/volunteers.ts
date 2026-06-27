// ─────────────────────────────────────────────────────────────────────────────
// Volunteer Location Service
// Uses localStorage as shared state between tabs (public app + volunteer panel)
// ─────────────────────────────────────────────────────────────────────────────

export interface VolunteerRecord {
  id: string;
  name: string;
  centerId: string;
  centerName: string;
  lat: number;
  lng: number;
  lastSeen: number; // Date.now()
}

const KEY = "kumbh_volunteers";
const TTL_MS = 30 * 60 * 1000; // 30 minutes

function readAll(): VolunteerRecord[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function registerVolunteer(v: VolunteerRecord): void {
  const others = readAll().filter((x) => x.id !== v.id);
  try {
    localStorage.setItem(KEY, JSON.stringify([...others, { ...v, lastSeen: Date.now() }]));
  } catch {}
}

export function getActiveVolunteers(): VolunteerRecord[] {
  const cutoff = Date.now() - TTL_MS;
  return readAll().filter((v) => v.lastSeen > cutoff);
}

export function removeVolunteer(id: string): void {
  const others = readAll().filter((v) => v.id !== id);
  try {
    localStorage.setItem(KEY, JSON.stringify(others));
  } catch {}
}

// Seed a few demo volunteers near key zones so the public app shows them even
// before any volunteer panel is opened (realistic for a hackathon demo)
export function seedDemoVolunteers(): void {
  const existing = readAll();
  if (existing.length > 0) return; // already seeded

  const demos: VolunteerRecord[] = [
    { id: "VOL-DEMO-1", name: "Priya Desai",   centerId: "CENTER-RAMKUND",    centerName: "Ramkund Kho-Ya-Paya Kendra", lat: 20.0042, lng: 73.7896, lastSeen: Date.now() },
    { id: "VOL-DEMO-2", name: "Rahul Sharma",  centerId: "CENTER-PANCHAVATI", centerName: "Panchavati Center",          lat: 20.0018, lng: 73.7880, lastSeen: Date.now() },
    { id: "VOL-DEMO-3", name: "Sunita Patil",  centerId: "CENTER-CENTRAL",    centerName: "Central Control Room",       lat: 20.0055, lng: 73.7835, lastSeen: Date.now() },
    { id: "VOL-DEMO-4", name: "Arjun Kulkarni",centerId: "CENTER-ADGAON",     centerName: "Adgaon Kho-Ya-Paya",        lat: 20.0158, lng: 73.8265, lastSeen: Date.now() },
  ];
  try {
    localStorage.setItem(KEY, JSON.stringify(demos));
  } catch {}
}
