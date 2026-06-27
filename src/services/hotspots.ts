// ─────────────────────────────────────────────────────────────────────────────
// Separation Hotspot Prediction Service
//
// Algorithm:
//   1. For each chokepoint, count neighbours (other chokepoints + CCTV) within 400m
//   2. Normalise to 0–1 → density score → risk level (high/medium/low)
//   3. Underserved = high-density cluster >600m from nearest help center
//   4. Suggested placement = centroid of underserved cluster
//
// This turns the passive KML pins into "we predict where to put help desks".
// ─────────────────────────────────────────────────────────────────────────────

import chokepointData from "../data/chokepoints.json";
import cctvData from "../data/cctv.json";
import { registry } from "../core/backends/registry";
import { haversineKm } from "../core/backends/geo";

export interface HotspotPoint {
  lat: number;
  lng: number;
  name: string;
  densityScore: number; // 0–1
  risk: "high" | "medium" | "low";
  nearestCenterKm: number;
  isUnderserved: boolean;
}

export interface SuggestedDesk {
  lat: number;
  lng: number;
  label: string;
  reason: string;
  urgency: "critical" | "high" | "medium";
}

const CLUSTER_RADIUS_KM = 0.4; // 400 m — consider nearby points
const UNDERSERVED_THRESHOLD_KM = 0.6; // >600 m from nearest center = underserved

type LatLng = { lat: number; lng: number };

function nearest(point: LatLng, centers: LatLng[]): number {
  if (centers.length === 0) return Infinity;
  return Math.min(...centers.map((c) => haversineKm(point, c)));
}

let _cache: { hotspots: HotspotPoint[]; suggested: SuggestedDesk[] } | null = null;

export function computeHotspots(): { hotspots: HotspotPoint[]; suggested: SuggestedDesk[] } {
  if (_cache) return _cache;

  const chokepoints = chokepointData as { lat: number; lng: number; name: string }[];
  const cctv = cctvData as { lat: number; lng: number; id: string; label: string }[];
  const centers = registry.getHelpCenters().map((c) => c.location);

  // All "pressure" points: chokepoints + sampled CCTV (every 3rd to keep it manageable)
  const allPressure: LatLng[] = [
    ...chokepoints,
    ...cctv.filter((_, i) => i % 3 === 0),
  ];

  // Score each chokepoint by neighbour count within CLUSTER_RADIUS_KM
  const counts = chokepoints.map((cp) => {
    const neighbours = allPressure.filter(
      (p) => haversineKm(cp, p) < CLUSTER_RADIUS_KM && (p.lat !== cp.lat || p.lng !== cp.lng)
    ).length;
    return neighbours;
  });

  const maxCount = Math.max(...counts, 1);

  const hotspots: HotspotPoint[] = chokepoints.map((cp, i) => {
    const densityScore = counts[i] / maxCount;
    const risk: "high" | "medium" | "low" =
      densityScore >= 0.65 ? "high" : densityScore >= 0.35 ? "medium" : "low";
    const nearestCenterKm = nearest(cp, centers);
    const isUnderserved = risk !== "low" && nearestCenterKm > UNDERSERVED_THRESHOLD_KM;

    return {
      lat: cp.lat,
      lng: cp.lng,
      name: cp.name,
      densityScore,
      risk,
      nearestCenterKm: Math.round(nearestCenterKm * 10) / 10,
      isUnderserved,
    };
  });

  // Group underserved high-risk points into clusters, emit one suggested desk per cluster
  const underserved = hotspots.filter((h) => h.isUnderserved).sort((a, b) => b.densityScore - a.densityScore);
  const visited = new Set<number>();
  const suggested: SuggestedDesk[] = [];

  underserved.forEach((h, i) => {
    if (visited.has(i)) return;
    // Gather cluster members within 600 m
    const cluster = underserved.filter((_, j) => {
      if (visited.has(j)) return false;
      return haversineKm(h, underserved[j]) < 0.6;
    });
    cluster.forEach((_, j) => visited.add(underserved.indexOf(cluster[j])));

    // Centroid
    const lat = cluster.reduce((s, p) => s + p.lat, 0) / cluster.length;
    const lng = cluster.reduce((s, p) => s + p.lng, 0) / cluster.length;
    const maxRisk = cluster.some((c) => c.risk === "high") ? "critical" : "high";
    const nearestCenterKm = nearest({ lat, lng }, centers);

    suggested.push({
      lat,
      lng,
      label: `Suggested Desk — ${h.name.slice(0, 28)}`,
      reason: `${cluster.length} high-density chokepoint(s) within 600 m, nearest help center ${nearestCenterKm.toFixed(1)} km away`,
      urgency: maxRisk,
    });
  });

  _cache = { hotspots, suggested };
  return _cache;
}

/** Call this when registry reloads (e.g., if centers change) */
export function clearHotspotCache() {
  _cache = null;
}
