import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { registry } from "../core/backends/registry";
import MapView, { type RouteTarget } from "../components/MapView";
import { RAMKUND_DEFAULT, type UserLocation } from "../services/location";
import type { FoundPerson, MissingReport, HelpCenter } from "../types";

const NASHIK_LOC: UserLocation = { ...RAMKUND_DEFAULT, accuracy: 0, source: "default" };

type Tab = "missing" | "found";

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1) return "just now";
  if (diff < 60) return `${diff}m ago`;
  return `${Math.floor(diff / 60)}h ${diff % 60}m ago`;
}

function genderIcon(g: string) {
  return g === "female" ? "👩" : g === "male" ? "👨" : "🧑";
}

// ── Cross-match a missing report against found persons ──────────────────────
function getCrossMatches(mr: MissingReport, found: FoundPerson[]) {
  return found
    .map((fp) => {
      let score = 0;
      if (fp.gender === mr.missingPerson.gender) score += 0.25;
      const ageA = mr.missingPerson.ageRange, ageB = fp.ageRange;
      if (ageA && ageB && ageRangesOverlap(ageA, ageB)) score += 0.30;
      const words = (cloth: string) => cloth.toLowerCase().split(/\W+/).filter(w => w.length > 2);
      const a = new Set(words(mr.missingPerson.clothing));
      const b = words(fp.clothing);
      const shared = b.filter(w => a.has(w)).length;
      if (b.length) score += (shared / b.length) * 0.30;
      if (mr.missingPerson.languageSpoken === fp.languageSpoken) score += 0.15;
      return { fp, score: Math.min(score, 1) };
    })
    .filter(m => m.score >= 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
}

function ageRangesOverlap(a: string, b: string): boolean {
  const parse = (s: string): [number, number] => {
    const plus = s.match(/^(\d+)\+$/); if (plus) return [+plus[1], 120];
    const dash = s.match(/^(\d+)[-–](\d+)$/); if (dash) return [+dash[1], +dash[2]];
    const n = s.match(/\d+/); if (n) { const x = +n[0]; return [x, x + 10]; }
    return [0, 120];
  };
  const [aMin, aMax] = parse(a), [bMin, bMax] = parse(b);
  return aMin <= bMax && bMin <= aMax;
}

// ── Missing report card ───────────────────────────────────────────────────────
function MissingCard({
  mr, found, centers, onGetDirections,
}: {
  mr: MissingReport;
  found: FoundPerson[];
  centers: HelpCenter[];
  onGetDirections: (target: RouteTarget & { center: HelpCenter }) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const matches = getCrossMatches(mr, found);
  const mp = mr.missingPerson;

  return (
    <div
      className="card"
      style={{
        margin: "0 0 10px",
        borderColor: matches.length > 0 ? "#16a34a" : "#e7e5e4",
        borderWidth: matches.length > 0 ? 2 : 1,
      }}
    >
      {/* Top row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <span style={{ fontFamily: "monospace", fontSize: 11, background: "#fef3c7", color: "#92400e", padding: "2px 6px", borderRadius: 4 }}>
            {mr.id}
          </span>
          {mr.is_duplicate_report && (
            <span style={{ marginLeft: 4, fontSize: 10, background: "#fde8d8", color: "#c2410c", padding: "1px 5px", borderRadius: 4 }}>LINKED</span>
          )}
        </div>
        <span style={{ fontSize: 11, color: "#a8a29e", flexShrink: 0 }}>{timeAgo(mr.registeredAt)}</span>
      </div>

      {/* Description */}
      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
        <span style={{ fontSize: 28 }}>{genderIcon(mp.gender)}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>
            {mp.name ? mp.name : "Unknown"} · {mp.gender} · {mp.ageRange}
          </div>
          <div style={{ fontSize: 12, color: "#57534e" }}>👗 {mp.clothing}</div>
          <div style={{ fontSize: 11, color: "#78716c" }}>
            📍 Last seen: {mp.lastSeenLocation}
            {mp.lastSeenTime && ` · ⏰ ${typeof mp.lastSeenTime === "string" && mp.lastSeenTime.includes("T") ? timeAgo(mp.lastSeenTime) : mp.lastSeenTime}`}
          </div>
          <div style={{ fontSize: 11, color: "#a8a29e" }}>🗣 {mp.languageSpoken} · Reported by: {mr.reportedBy}</div>
        </div>
      </div>

      {/* Match alert */}
      {matches.length > 0 && (
        <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "8px 10px", marginTop: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: "#15803d", marginBottom: 4 }}>
            ✅ Possible match found at {matches[0].fp.centerName}
          </div>
          {matches.map(({ fp, score }) => {
            const center = centers.find(c => c.id === fp.centerId);
            return (
              <div key={fp.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                <div>
                  <span style={{ fontSize: 11, color: "#15803d" }}>
                    {Math.round(score * 100)}% match · {fp.ageRange} {fp.gender} · {fp.clothing.slice(0, 30)}
                  </span>
                  <br />
                  <span style={{ fontSize: 11, color: "#57534e" }}>🏥 {fp.centerName}</span>
                  {center?.contactNumber && (
                    <> · <a href={`tel:${center.contactNumber}`} style={{ fontSize: 11, color: "#1d4ed8" }}>📞 {center.contactNumber}</a></>
                  )}
                </div>
                {center && (
                  <button
                    onClick={() => onGetDirections({ lat: center.location.lat, lng: center.location.lng, name: center.name, center })}
                    style={{ fontSize: 11, background: "#15803d", color: "white", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer", whiteSpace: "nowrap" }}
                  >
                    🗺 Go there
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Expand toggle */}
      <button
        onClick={() => setExpanded(v => !v)}
        style={{ fontSize: 11, color: "#78716c", background: "none", border: "none", marginTop: 6, cursor: "pointer", padding: 0 }}
      >
        {expanded ? "▲ Less" : "▼ More details"}
      </button>
      {expanded && mp.additionalDetails && (
        <div style={{ fontSize: 12, color: "#57534e", marginTop: 4, fontStyle: "italic" }}>
          {mp.additionalDetails}
        </div>
      )}
    </div>
  );
}

// ── Found person card ─────────────────────────────────────────────────────────
function FoundCard({
  fp, centers, onGetDirections,
}: {
  fp: FoundPerson;
  centers: HelpCenter[];
  onGetDirections: (target: RouteTarget & { center: HelpCenter }) => void;
}) {
  const center = centers.find(c => c.id === fp.centerId);
  const missMatches = registry.searchMissingReports(fp);

  return (
    <div
      className="card"
      style={{
        margin: "0 0 10px",
        borderColor: missMatches.length > 0 ? "#f97316" : "#e7e5e4",
        borderWidth: missMatches.length > 0 ? 2 : 1,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontFamily: "monospace", fontSize: 11, background: "#e0f2fe", color: "#0369a1", padding: "2px 6px", borderRadius: 4 }}>
          {fp.id}
        </span>
        <span style={{ fontSize: 11, color: "#a8a29e" }}>{timeAgo(fp.foundAt)}</span>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
        <span style={{ fontSize: 28 }}>{genderIcon(fp.gender)}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{fp.gender} · {fp.ageRange}</div>
          <div style={{ fontSize: 12, color: "#57534e" }}>👗 {fp.clothing}</div>
          <div style={{ fontSize: 11, color: "#78716c" }}>📍 Found at: {fp.foundZone}</div>
          <div style={{ fontSize: 11, color: "#a8a29e" }}>🗣 {fp.languageSpoken} · 💊 {fp.condition}</div>
        </div>
      </div>

      {/* Where they are now */}
      <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "8px 10px", marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 12, color: "#1d4ed8" }}>🏥 Currently at: {fp.centerName}</div>
          {center?.contactNumber && <a href={`tel:${center.contactNumber}`} style={{ fontSize: 11, color: "#1d4ed8" }}>📞 {center.contactNumber}</a>}
        </div>
        {center && (
          <button
            onClick={() => onGetDirections({ lat: center.location.lat, lng: center.location.lng, name: center.name, center })}
            style={{ fontSize: 11, background: "#1d4ed8", color: "white", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}
          >
            🗺 Directions
          </button>
        )}
      </div>

      {/* Missing report matches */}
      {missMatches.length > 0 && (
        <div style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 8, padding: "6px 10px", marginTop: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#c2410c" }}>⚠️ Family may be searching — Ref {missMatches[0].missingReportId}</div>
          <div style={{ fontSize: 11, color: "#7c2d12" }}>Contact: {missMatches[0].contactNumber ?? "—"}</div>
        </div>
      )}
    </div>
  );
}

// ── Main Registry Page ────────────────────────────────────────────────────────
export default function MissingRegistry() {
  const navigate = useNavigate();
  const topRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>("missing");
  const [search, setSearch] = useState("");
  const [foundPersons, setFoundPersons] = useState<FoundPerson[]>([]);
  const [missingReports, setMissingReports] = useState<MissingReport[]>([]);
  const [routeTo, setRouteTo] = useState<(RouteTarget & { center: HelpCenter }) | null>(null);
  const centers = registry.getHelpCenters();

  // Live-refresh every 3 seconds
  useEffect(() => {
    const refresh = () => {
      setFoundPersons(registry.getAllFoundPersons());
      setMissingReports(registry.getAllMissingReports());
    };
    refresh();
    const iv = setInterval(refresh, 3000);
    return () => clearInterval(iv);
  }, []);

  const q = search.toLowerCase();

  const filteredMissing = missingReports.filter(mr => {
    if (!q) return true;
    const mp = mr.missingPerson;
    return [mp.name, mp.clothing, mp.lastSeenLocation, mp.languageSpoken, mr.id]
      .some(s => (s ?? "").toLowerCase().includes(q));
  });

  const filteredFound = foundPersons.filter(fp => {
    if (!q) return true;
    return [fp.clothing, fp.foundZone, fp.languageSpoken, fp.centerName, fp.id]
      .some(s => (s ?? "").toLowerCase().includes(q));
  });

  const crossMatchCount = missingReports.filter(mr => getCrossMatches(mr, foundPersons).length > 0).length;
  const markers = centers.map(c => ({
    type: "center" as const, lat: c.location.lat, lng: c.location.lng, label: c.name,
  }));
  if (routeTo) {
    markers.push({ type: "center" as const, lat: routeTo.lat, lng: routeTo.lng, label: `📍 ${routeTo.name}` });
  }

  function handleGetDirections(target: RouteTarget & { center: HelpCenter }) {
    setRouteTo(target);
    topRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <div className="page" style={{ background: "#fafaf9" }}>
      <div ref={topRef} />
      {/* Header */}
      <div className="page-header" style={{ justifyContent: "space-between", background: "#1e293b" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: "white" }}>📋 Live Registry</div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>
            {missingReports.length} missing · {foundPersons.length} at centers
            {crossMatchCount > 0 && <span style={{ color: "#4ade80", marginLeft: 8 }}>✅ {crossMatchCount} possible match{crossMatchCount > 1 ? "es" : ""}</span>}
          </div>
        </div>
        <button
          onClick={() => navigate("/")}
          style={{ fontSize: 12, color: "#94a3b8", background: "rgba(255,255,255,.1)", border: "none", borderRadius: 6, padding: "5px 10px" }}
        >
          ← Home
        </button>
      </div>

      {/* Map — always visible, shows route when "Go there" is tapped */}
      <div style={{ position: "relative" }}>
        <MapView userLocation={NASHIK_LOC} markers={markers} routeTo={routeTo ?? undefined} height={220} zoom={13} />
        {routeTo && (
          <div style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", background: "white", borderRadius: 20, padding: "4px 12px", fontSize: 12, boxShadow: "0 2px 8px rgba(0,0,0,.2)", zIndex: 999, whiteSpace: "nowrap" }}>
            🗺 Route to {routeTo.name}
            <button onClick={() => setRouteTo(null)} style={{ marginLeft: 8, fontSize: 11, color: "#dc2626", background: "none", border: "none", cursor: "pointer" }}>✕</button>
          </div>
        )}
      </div>

      {/* Search */}
      <div style={{ padding: "10px 16px", background: "white", borderBottom: "1px solid #e7e5e4" }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Search by name, clothing, location…"
          className="input"
          style={{ margin: 0 }}
        />
      </div>

      {/* Tabs */}
      <div className="tab-nav">
        <button onClick={() => setTab("missing")} className={`tab-btn${tab === "missing" ? " active" : ""}`}>
          🔍 Missing ({filteredMissing.length})
        </button>
        <button onClick={() => setTab("found")} className={`tab-btn${tab === "found" ? " active" : ""}`}>
          🏥 At Centers ({filteredFound.length})
        </button>
      </div>

      {/* Content */}
      <div className="page-body" style={{ paddingTop: 12 }}>
        {tab === "missing" && (
          <>
            {crossMatchCount > 0 && (
              <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 13 }}>
                <strong style={{ color: "#15803d" }}>✅ {crossMatchCount} missing report{crossMatchCount > 1 ? "s" : ""} have a possible match at a help center.</strong>
                {" "}Scroll down to see where to go.
              </div>
            )}
            {filteredMissing.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "#a8a29e" }}>
                <div style={{ fontSize: 40 }}>🔍</div>
                <p style={{ marginTop: 12 }}>No active missing reports{search ? " matching your search" : ""}.</p>
              </div>
            ) : (
              filteredMissing.map(mr => (
                <MissingCard
                  key={mr.id}
                  mr={mr}
                  found={foundPersons}
                  centers={centers}
                  onGetDirections={handleGetDirections}
                />
              ))
            )}
          </>
        )}

        {tab === "found" && (
          <>
            {filteredFound.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "#a8a29e" }}>
                <div style={{ fontSize: 40 }}>🏥</div>
                <p style={{ marginTop: 12 }}>No found persons at centers{search ? " matching your search" : ""}.</p>
              </div>
            ) : (
              filteredFound.map(fp => (
                <FoundCard
                  key={fp.id}
                  fp={fp}
                  centers={centers}
                  onGetDirections={handleGetDirections}
                />
              ))
            )}
          </>
        )}

        {/* CTA */}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={() => navigate("/")} className="btn btn-primary flex-1">
            🔍 Report Missing
          </button>
          <button onClick={() => navigate("/help-desk")} className="btn btn-ghost flex-1">
            🏥 Help Desk
          </button>
        </div>
      </div>
    </div>
  );
}
