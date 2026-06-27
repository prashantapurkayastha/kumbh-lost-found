import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { UserLocation } from "../services/location";
import type { ReunionPoint } from "../types";

// ── OSRM Route Fetcher (free, no API key, walking mode) ───────────────────────
async function fetchOSRMRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): Promise<{ coords: [number, number][]; distanceKm: number; durationMin: number } | null> {
  try {
    const url = `https://router.project-osrm.org/route/v1/foot/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code !== "Ok" || !data.routes?.[0]) return null;
    const route = data.routes[0];
    const coords: [number, number][] = route.geometry.coordinates.map(
      ([lng, lat]: [number, number]) => [lat, lng] as [number, number]
    );
    return {
      coords,
      distanceKm: Math.round(route.distance / 100) / 10,
      durationMin: Math.round(route.duration / 60),
    };
  } catch {
    return null;
  }
}

// Fix Leaflet default icon paths for Vite/bundlers
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// Custom icons
const makeIcon = (color: string, emoji: string) =>
  L.divIcon({
    html: `<div style="background:${color};width:32px;height:32px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;">
      <span style="transform:rotate(45deg);font-size:14px;">${emoji}</span>
    </div>`,
    className: "",
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -36],
  });

const ICONS = {
  user:     makeIcon("#2563eb", "📍"),
  center:   makeIcon("#f97316", "🏥"),
  police:   makeIcon("#1d4ed8", "👮"),
  found:    makeIcon("#dc2626", "🔴"),
  reunion:  makeIcon("#16a34a", "⭐"),
  volunteer: makeIcon("#7c3aed", "🙋"),
};

export interface MapMarker {
  type: "center" | "police" | "found" | "reunion" | "volunteer";
  lat: number;
  lng: number;
  label: string;
  detail?: string;
}

export interface RouteTarget {
  lat: number;
  lng: number;
  name: string;
}

export interface CctvPoint { id: string; lat: number; lng: number; label: string; }
export interface ChokepointData { name: string; lat: number; lng: number; }

interface Props {
  userLocation?: UserLocation | null;
  markers?: MapMarker[];
  reunionPoint?: ReunionPoint | null;
  routeTo?: RouteTarget | null;
  cctvPoints?: CctvPoint[];
  chokepoints?: ChokepointData[];
  showCctv?: boolean;
  showChokepoints?: boolean;
  height?: string | number;
  zoom?: number;
}

const RAMKUND = { lat: 20.0039, lng: 73.7894 };

export default function MapView({ userLocation, markers = [], reunionPoint, routeTo, cctvPoints = [], chokepoints = [], showCctv = false, showChokepoints = false, height = 320, zoom = 14 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const routeInfoRef = useRef<L.Control | null>(null);
  const cctvLayerRef = useRef<L.LayerGroup | null>(null);
  const chokeLayerRef = useRef<L.LayerGroup | null>(null);

  // ── Init map once ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const center = userLocation
      ? [userLocation.lat, userLocation.lng]
      : [RAMKUND.lat, RAMKUND.lng];

    const map = L.map(containerRef.current, {
      center: center as [number, number],
      zoom,
      zoomControl: true,
      attributionControl: true,
    });

    // CartoDB light — clean, free, no API key
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 20,
    }).addTo(map);

    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    cctvLayerRef.current = L.layerGroup().addTo(map);
    chokeLayerRef.current = L.layerGroup().addTo(map);

    // High-density zone circles (official no-vehicle pressure zones from dataset)
    const highDensityZones = [
      { lat: 20.0067, lng: 73.79062, label: "Ramkund — High Density Zone", color: "#dc262620" },
      { lat: 20.0064, lng: 73.7902,  label: "Godavari Ghat Approach",      color: "#dc262615" },
    ];
    highDensityZones.forEach((z) => {
      L.circle([z.lat, z.lng], {
        radius: 250,
        color: "#dc2626",
        fillColor: z.color,
        fillOpacity: 0.25,
        weight: 1.5,
        dashArray: "6 4",
      })
        .bindPopup(`⚠️ ${z.label}`)
        .addTo(map);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── OSRM route ────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const routeLayer = routeLayerRef.current;
    if (!map || !routeLayer) return;

    // Remove old route + info box
    routeLayer.clearLayers();
    if (routeInfoRef.current) {
      routeInfoRef.current.remove();
      routeInfoRef.current = null;
    }

    if (!routeTo || !userLocation) return;

    fetchOSRMRoute(userLocation, routeTo).then((route) => {
      if (!route) return;

      // Draw route polyline
      L.polyline(route.coords, {
        color: "#2563eb",
        weight: 5,
        opacity: 0.8,
        dashArray: undefined,
      }).addTo(routeLayer);

      // Destination marker
      L.marker([routeTo.lat, routeTo.lng], { icon: ICONS.center, zIndexOffset: 500 })
        .bindPopup(`<strong>${routeTo.name}</strong><br/>🚶 ${route.durationMin} min · ${route.distanceKm} km`)
        .addTo(routeLayer)
        .openPopup();

      // Fit map to route
      map.fitBounds(L.latLngBounds(route.coords), { padding: [40, 60] });

      // Route info control (bottom-left pill)
      const InfoControl = L.Control.extend({
        options: { position: "bottomleft" },
        onAdd() {
          const div = L.DomUtil.create("div");
          div.innerHTML = `
            <div style="background:white;border-radius:12px;padding:8px 14px;box-shadow:0 2px 8px rgba(0,0,0,.2);font-size:13px;font-family:sans-serif;display:flex;gap:12px;align-items:center;">
              <span>🚶 <strong>${route.durationMin} min</strong></span>
              <span style="color:#78716c">${route.distanceKm} km walking</span>
              <span style="color:#16a34a;font-weight:600">→ ${routeTo.name.slice(0, 22)}${routeTo.name.length > 22 ? "…" : ""}</span>
            </div>`;
          return div;
        },
      });
      routeInfoRef.current = new InfoControl();
      routeInfoRef.current.addTo(map);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeTo, userLocation]);

  // ── CCTV layer ────────────────────────────────────────────────────────────
  useEffect(() => {
    const layer = cctvLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!showCctv) return;
    const cctvIcon = L.divIcon({
      html: `<div style="background:#7c3aed;width:8px;height:8px;border-radius:50%;border:1px solid white;opacity:0.8;"></div>`,
      className: "",
      iconSize: [8, 8],
      iconAnchor: [4, 4],
    });
    cctvPoints.forEach((cam) => {
      L.marker([cam.lat, cam.lng], { icon: cctvIcon })
        .bindPopup(`📹 ${cam.label}`)
        .addTo(layer);
    });
  }, [showCctv, cctvPoints]);

  // ── Chokepoints layer ─────────────────────────────────────────────────────
  useEffect(() => {
    const layer = chokeLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!showChokepoints) return;
    chokepoints.forEach((cp) => {
      L.circle([cp.lat, cp.lng], {
        radius: 120,
        color: "#f97316",
        fillColor: "#f9731630",
        fillOpacity: 0.4,
        weight: 2,
      })
        .bindPopup(`⚠️ Chokepoint: <strong>${cp.name}</strong>`)
        .addTo(layer);
    });
  }, [showChokepoints, chokepoints]);

  // ── Update markers ─────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    // User location
    if (userLocation) {
      L.marker([userLocation.lat, userLocation.lng], { icon: ICONS.user })
        .bindPopup("📍 Your location")
        .addTo(layer);

      // Accuracy circle
      if (userLocation.accuracy > 0 && userLocation.accuracy < 500) {
        L.circle([userLocation.lat, userLocation.lng], {
          radius: userLocation.accuracy,
          color: "#2563eb",
          fillColor: "#2563eb10",
          fillOpacity: 0.15,
          weight: 1,
        }).addTo(layer);
      }
    }

    // Custom markers
    markers.forEach((m) => {
      const icon = ICONS[m.type] ?? ICONS.center;
      L.marker([m.lat, m.lng], { icon })
        .bindPopup(`<strong>${m.label}</strong>${m.detail ? `<br/><small>${m.detail}</small>` : ""}`)
        .addTo(layer);
    });

    // Reunion point (prominent green star)
    if (reunionPoint) {
      const rp = reunionPoint;
      L.marker([rp.location.lat, rp.location.lng], { icon: ICONS.reunion, zIndexOffset: 1000 })
        .bindPopup(
          `<strong>⭐ ${rp.name}</strong><br/>${rp.landmark}<br/><em>Volunteer: ${rp.volunteerAssigned}</em>`
        )
        .addTo(layer)
        .openPopup();

      // Zoom to reunion point
      map.setView([rp.location.lat, rp.location.lng], 16);
    }

    // Fit bounds if multiple markers
    if (markers.length > 1 && !reunionPoint) {
      const allPoints: [number, number][] = markers.map((m) => [m.lat, m.lng]);
      if (userLocation) allPoints.push([userLocation.lat, userLocation.lng]);
      map.fitBounds(L.latLngBounds(allPoints), { padding: [40, 40] });
    }
  }, [userLocation, markers, reunionPoint]);

  return (
    <div
      ref={containerRef}
      className="map-container"
      style={{ height, width: "100%" }}
      aria-label="Map showing nearby help centers and your location"
    />
  );
}
