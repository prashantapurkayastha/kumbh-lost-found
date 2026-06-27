import type { LatLng, HelpCenter, PoliceStation } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Geo helpers — Haversine distance, nearest-N lookups
// ─────────────────────────────────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Walking time estimate: ~4 km/h in a crowd */
export function walkingMinutes(km: number): number {
  return Math.round((km / 4) * 60);
}

export function nearestCenters(
  point: LatLng,
  centers: HelpCenter[],
  n = 3
): (HelpCenter & { distanceKm: number; walkingMinutes: number })[] {
  return centers
    .map((c) => {
      const d = haversineKm(point, c.location);
      return { ...c, distanceKm: d, walkingMinutes: walkingMinutes(d) };
    })
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, n);
}

export function nearestPoliceStations(
  point: LatLng,
  stations: PoliceStation[],
  n = 2
): (PoliceStation & { distanceKm: number; walkingMinutes: number })[] {
  return stations
    .map((s) => {
      const d = haversineKm(point, s.location);
      return { ...s, distanceKm: d, walkingMinutes: walkingMinutes(d) };
    })
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, n);
}

/** Rough zone name → centroid lookup for zone-based queries */
export const ZONE_CENTROIDS: Record<string, LatLng> = {
  Ramkund: { lat: 20.0067, lng: 73.7906 },
  Panchavati: { lat: 20.0022, lng: 73.7883 },
  Trimbakeshwar: { lat: 19.9333, lng: 73.5284 },
  Sadhugram: { lat: 20.0025, lng: 73.792 },
  Tapovan: { lat: 20.0156, lng: 73.7918 },
  Adgaon: { lat: 20.0155, lng: 73.8269 },
  "Nashik Road": { lat: 19.9528, lng: 73.8397 },
  Central: { lat: 20.005, lng: 73.783 },
  "Rajur Bahula": { lat: 19.946, lng: 73.673 },
  "Madsangvi Transit": { lat: 20.066, lng: 73.883 },
};

export function zoneToLatLng(zone: string): LatLng | null {
  const key = Object.keys(ZONE_CENTROIDS).find((k) =>
    zone.toLowerCase().includes(k.toLowerCase())
  );
  return key ? ZONE_CENTROIDS[key] : null;
}
