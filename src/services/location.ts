// ─────────────────────────────────────────────────────────────────────────────
// Location Service — GPS + nearest center lookup
// ─────────────────────────────────────────────────────────────────────────────

import { registry } from "../core/backends/registry";
import { haversineKm, walkingMinutes } from "../core/backends/geo";

// Ramkund — default center if location unavailable
export const RAMKUND_DEFAULT = { lat: 20.0039, lng: 73.7894 };

export interface UserLocation {
  lat: number;
  lng: number;
  accuracy: number; // metres
  source: "gps" | "cached" | "default";
}

const CACHE_KEY = "kumbh_last_location";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getUserLocation(): Promise<UserLocation> {
  return new Promise((resolve) => {
    // Try cached first while GPS loads
    const cached = getCachedLocation();

    if (!navigator.geolocation) {
      resolve(cached ?? { ...RAMKUND_DEFAULT, accuracy: 0, source: "default" });
      return;
    }

    const timeout = setTimeout(() => {
      // GPS timed out — use cache or default
      resolve(cached ?? { ...RAMKUND_DEFAULT, accuracy: 0, source: "default" });
    }, 8000);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timeout);
        const loc: UserLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          source: "gps",
        };
        cacheLocation(loc);
        resolve(loc);
      },
      () => {
        clearTimeout(timeout);
        resolve(cached ?? { ...RAMKUND_DEFAULT, accuracy: 0, source: "default" });
      },
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 60000 }
    );
  });
}

function cacheLocation(loc: UserLocation) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...loc, cachedAt: Date.now() }));
  } catch {}
}

function getCachedLocation(): UserLocation | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data.cachedAt > CACHE_TTL) return null;
    return { lat: data.lat, lng: data.lng, accuracy: data.accuracy, source: "cached" };
  } catch {
    return null;
  }
}

export interface NearbyCenter {
  id: string;
  name: string;
  zone: string;
  location: { lat: number; lng: number };
  contactNumber: string;
  languages: string[];
  distanceKm: number;
  walkingMinutes: number;
  currentLoad: number;
  capacity: number;
}

export function getNearestCenters(location: UserLocation, n = 5): NearbyCenter[] {
  const centers = registry.getHelpCenters();
  return centers
    .map((c) => {
      const d = haversineKm(location, c.location);
      return {
        id: c.id,
        name: c.name,
        zone: c.zone,
        location: c.location,
        contactNumber: c.contactNumber,
        languages: c.languages,
        distanceKm: Math.round(d * 100) / 100,
        walkingMinutes: walkingMinutes(d),
        currentLoad: c.currentLoad,
        capacity: c.capacity,
      };
    })
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, n);
}

export function getLoadColor(load: number, capacity: number): string {
  const ratio = load / capacity;
  if (ratio < 0.5) return "#16a34a"; // green
  if (ratio < 0.8) return "#d97706"; // amber
  return "#dc2626"; // red
}
