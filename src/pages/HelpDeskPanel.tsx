import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import MapView, { type MapMarker, type CctvPoint } from "../components/MapView";
import ChatAgent from "../components/ChatAgent";
import { getUserLocation, type UserLocation } from "../services/location";
import { sendSMS } from "../services/sms";
import { notifyBackend } from "../core/backends/notify";
import { registry } from "../core/backends/registry";
import { flagSuspicionSync, getSyncStatus, getLastSyncTime } from "../core/backends/registrySync";
import { useOnline } from "../hooks/useOnline";
import { computeHotspots } from "../services/hotspots";
import { haversineKm } from "../core/backends/geo";
import type { AgentResult } from "../core/agent";
import type { Notification, PoliceStation } from "../types";
import cctvRaw from "../data/cctv.json";

// ────────────────────────��────────────────────────────────────────────────────
// Help Desk Panel
// Fixed-location admin interface for help desk staff (not volunteer, not family)
// Covers flows 3 (family at desk) and 6 (missing person at desk)
// ─────────────────────────────────────────────────────────────────────────────

type Tab = "queue" | "register-found" | "search" | "verify" | "intel" | "cctv" | "notifications" | "psa";
type Scenario = "family-reports" | "person-self-reports";

// ── Dummy auth ────────────────────────────────────────────────────────────────
const DESK_CREDS = { username: "helpdesk", password: "kumbh2027" };

function HelpDeskLogin({ onLogin }: { onLogin: () => void }) {
  const navigate = useNavigate();
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      if (u === DESK_CREDS.username && p === DESK_CREDS.password) {
        onLogin();
      } else {
        setError("Invalid credentials. Try helpdesk / kumbh2027");
      }
      setLoading(false);
    }, 600);
  }

  return (
    <div className="page" style={{ background: "#eff6ff", minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <div style={{ maxWidth: 360, margin: "0 auto", padding: "0 20px", width: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 48 }}>🏥</div>
          <h1 style={{ fontWeight: 700, fontSize: 22, color: "#1d4ed8", marginTop: 8 }}>Help Desk Login</h1>
          <p style={{ fontSize: 13, color: "#57534e", marginTop: 4 }}>Kumbh Mela 2027 — Lost & Found</p>
        </div>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label className="input-label">Username</label>
            <input className="input" value={u} onChange={e => setU(e.target.value)} placeholder="helpdesk" autoComplete="username" />
          </div>
          <div>
            <label className="input-label">Password</label>
            <input className="input" type="password" value={p} onChange={e => setP(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
          </div>
          {error && <p style={{ fontSize: 13, color: "#dc2626", textAlign: "center" }}>{error}</p>}
          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
            {loading ? <span className="spinner" /> : "Login →"}
          </button>
          <button type="button" onClick={() => navigate("/")} className="btn btn-ghost btn-full" style={{ fontSize: 13 }}>
            ← Back to Public App
          </button>
        </form>
      </div>
    </div>
  );
}

export default function HelpDeskPanel() {
  const navigate = useNavigate();
  const isOnline = useOnline();

  const [loggedIn, setLoggedIn] = useState(false);
  const [tab, setTab] = useState<Tab>("queue");
  const [scenario, setScenario] = useState<Scenario>("family-reports");
  const [deskId, setDeskId] = useState("CENTER-RAMKUND");
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [markers, setMarkers] = useState<MapMarker[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [contactNumber, setContactNumber] = useState("");
  const [refNumber, setRefNumber] = useState<string | null>(null);
  const [agentResult, setAgentResult] = useState<AgentResult | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const notifIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stats = registry.getStats();
  const centers = registry.getHelpCenters();
  const allFound = registry.getAllFoundPersons();
  const allMissing = registry.getAllMissingReports();
  const { hotspots, suggested: suggestedDesks } = useMemo(() => computeHotspots(), []);
  const unread = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    getUserLocation().then((loc) => {
      setUserLocation(loc);
      const ms: MapMarker[] = registry.getHelpCenters().map((c) => ({
        type: "center" as const,
        lat: c.location.lat,
        lng: c.location.lng,
        label: c.name,
        detail: `Load: ${c.currentLoad}/${c.capacity}`,
      }));
      registry.getPoliceStations().forEach((ps) =>
        ms.push({ type: "police", lat: ps.location.lat, lng: ps.location.lng, label: ps.name })
      );
      setMarkers(ms);
    });

    setNotifications(notifyBackend.getAll());
    notifIntervalRef.current = setInterval(() => setNotifications(notifyBackend.getAll()), 5000);
    return () => { if (notifIntervalRef.current) clearInterval(notifIntervalRef.current); };
  }, []);

  async function handleAgentResult(result: AgentResult) {
    setAgentResult(result);
    for (const tc of result.toolCallsMade) {
      const out = tc.output as Record<string, unknown>;
      if ((tc.name === "register_missing_person" || tc.name === "register_found_person") && (out.referenceId ?? out.recordId)) {
        const ref = (out.referenceId ?? out.recordId) as string;
        setRefNumber(ref);
        if (contactNumber) {
          await sendSMS({
            to: contactNumber,
            message: `Kumbh Mela: ${tc.name === "register_found_person" ? "You have been registered as" : "Missing report"} ${ref}. ${registry.getCenterById(deskId)?.name ?? deskId}. Show this to any help desk.`,
            type: "case_registered",
          });
        }
      }
    }
  }

  function filterFoundPersons() {
    const q = searchQuery.toLowerCase();
    if (!q) return allFound;
    return allFound.filter(
      (fp) =>
        fp.clothing.toLowerCase().includes(q) ||
        fp.foundZone.toLowerCase().includes(q) ||
        fp.languageSpoken.toLowerCase().includes(q) ||
        fp.ageRange.includes(q) ||
        fp.id.toLowerCase().includes(q)
    );
  }

  function filterMissingReports() {
    const q = searchQuery.toLowerCase();
    if (!q) return allMissing;
    return allMissing.filter(
      (mr) =>
        (mr.missingPerson.name ?? "").toLowerCase().includes(q) ||
        mr.missingPerson.clothing.toLowerCase().includes(q) ||
        mr.missingPerson.lastSeenLocation.toLowerCase().includes(q) ||
        mr.id.toLowerCase().includes(q)
    );
  }

  if (!loggedIn) return <HelpDeskLogin onLogin={() => setLoggedIn(true)} />;

  return (
    <div className="page">
      {(!isOnline || getSyncStatus() === "offline") && (
        <div className="offline-banner">
          ⚡ Offline — showing cached registry
          {getLastSyncTime() ? ` (last sync ${Math.round((Date.now() - getLastSyncTime()!) / 60000)}m ago)` : " — no cache yet"}
          {" "}· Writes queued
        </div>
      )}

      {/* Header */}
      <div className="panel-header" style={{ background: "#1d4ed8" }}>
        <div>
          <h1>🏥 Help Desk</h1>
          <p>Kumbh Mela 2027 · Control Room</p>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button
            onClick={() => navigate("/")}
            style={{ fontSize: 11, color: "rgba(255,255,255,.8)", background: "rgba(255,255,255,.15)", padding: "4px 8px", borderRadius: 6, border: "none", whiteSpace: "nowrap" }}
          >
            ← App
          </button>
          <button
            onClick={() => navigate("/volunteer")}
            style={{ fontSize: 11, color: "rgba(255,255,255,.8)", background: "rgba(255,255,255,.15)", padding: "4px 8px", borderRadius: 6, border: "none", whiteSpace: "nowrap" }}
          >
            Volunteer ↗
          </button>
        </div>
      </div>

      {/* Desk selector */}
      <div style={{ padding: "10px 16px", background: "#eff6ff", borderBottom: "1px solid #bfdbfe", display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#1d4ed8", flexShrink: 0 }}>Desk:</span>
        <select value={deskId} onChange={(e) => setDeskId(e.target.value)} className="input" style={{ flex: 1 }}>
          {centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Tabs */}
      <div className="tab-nav" style={{ overflowX: "auto", flexWrap: "nowrap" }}>
        {(["queue", "register-found", "search", "verify", "intel", "cctv", "notifications", "psa"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`tab-btn${tab === t ? " active" : ""}`} style={{ whiteSpace: "nowrap" }}>
            {t === "queue" && "📋 Queue"}
            {t === "register-found" && "👤 Register"}
            {t === "search" && "🔍 Search"}
            {t === "verify" && "🔐 Verify"}
            {t === "intel" && "🧠 Intel"}
            {t === "cctv" && "📷 CCTV"}
            {t === "psa" && "📢 PSA"}
            {t === "notifications" && (
              <>🔔{unread > 0 && <span style={{ background: "#dc2626", color: "white", borderRadius: 10, padding: "1px 6px", fontSize: 10, marginLeft: 4 }}>{unread}</span>}</>
            )}
          </button>
        ))}
      </div>

      {/* QUEUE */}
      {tab === "queue" && (
        <div style={{ flex: 1, overflow: "auto" }}>
          <div className="two-panel">
            <div className="two-panel__left" style={{ padding: 16 }}>
              {/* Stats */}
              <div className="stats-row">
                <div className="stat-box"><div className="stat-value">{stats.foundPersonsWaiting}</div><div className="stat-label">Waiting</div></div>
                <div className="stat-box"><div className="stat-value">{stats.activeSearches}</div><div className="stat-label">Active</div></div>
                <div className="stat-box"><div className="stat-value">{stats.reunionsCompleted}</div><div className="stat-label">Reunited</div></div>
              </div>

              {stats.duplicateReportsCaught > 0 && (
                <div className="card" style={{ background: "#fff8f4", borderColor: "#f97316", marginBottom: 12 }}>
                  <span style={{ fontWeight: 700, color: "#f97316", fontSize: 13 }}>
                    ⚠️ {stats.duplicateReportsCaught} cross-center duplicates linked
                  </span>
                </div>
              )}

              <div className="card-title">⏳ Found Persons Waiting</div>
              {allFound.slice(0, 8).map((fp) => {
                const matches = registry.searchMissingReports(fp);
                const hasMatch = matches.length > 0;
                const isCareCase = fp.disposition && fp.disposition !== "active";
                const isMinorFlag = fp.isMinorUnaccompanied;
                return (
                  <div key={fp.id} className="notif-item" style={{
                    borderLeft: isCareCase ? "3px solid #7c3aed" : isMinorFlag ? "3px solid #dc2626" : hasMatch ? "3px solid #f97316" : undefined,
                    background: isCareCase ? "#f5f3ff" : isMinorFlag ? "#fef2f2" : hasMatch ? "#fff8f4" : undefined,
                    borderRadius: 6, alignItems: "flex-start"
                  }}>
                    {fp.photoBase64 && (
                      <img src={`data:image/jpeg;base64,${fp.photoBase64}`} alt="Person" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, flexShrink: 0, border: "1px solid #e5e7eb", marginRight: 6 }} />
                    )}
                    {!fp.photoBase64 && <div className="notif-dot" style={{ background: isCareCase ? "#7c3aed" : isMinorFlag ? "#dc2626" : fp.condition === "distressed" ? "#dc2626" : "#16a34a" }} />}
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 4 }}>
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{fp.id}</span>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {isMinorFlag && <span style={{ fontSize: 10, background: "#dc2626", color: "white", borderRadius: 10, padding: "1px 6px" }}>👶 MINOR</span>}
                          {isCareCase && <span style={{ fontSize: 10, background: "#7c3aed", color: "white", borderRadius: 10, padding: "1px 6px" }}>♿ {fp.disposition?.replace(/-/g, " ").toUpperCase()}</span>}
                          {hasMatch && !isCareCase && <span style={{ fontSize: 10, background: "#f97316", color: "white", borderRadius: 10, padding: "1px 6px" }}>⚡ MATCH</span>}
                          <span className={`badge ${fp.condition === "distressed" ? "badge-red" : "badge-green"}`}>{fp.condition}</span>
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: "#57534e" }}>{fp.ageRange} {fp.gender} · {fp.clothing.slice(0, 40)}</div>
                      <div style={{ fontSize: 11, color: "#a8a29e" }}>{fp.centerName} · {fp.languageSpoken}</div>
                      {isCareCase && fp.dispositionNotes && (
                        <div style={{ marginTop: 4, fontSize: 11, color: "#4c1d95", background: "#ede9fe", padding: "3px 6px", borderRadius: 4 }}>
                          📋 {fp.dispositionNotes}
                        </div>
                      )}
                      {isMinorFlag && (
                        <div style={{ marginTop: 4, fontSize: 11, color: "#b91c1c", background: "#fee2e2", padding: "3px 6px", borderRadius: 4 }}>
                          ⚠️ Unaccompanied minor — police escort required for handover
                          {fp.childHometown ? ` · From: ${fp.childHometown}` : ""}
                        </div>
                      )}
                      {hasMatch && !isCareCase && (
                        <div style={{ marginTop: 4, fontSize: 11, color: "#c2410c", background: "#fff7ed", padding: "3px 6px", borderRadius: 4 }}>
                          ⚠️ Missing report {matches[0].missingReportId} ({Math.round(matches[0].confidence * 100)}% match)
                          {matches[0].contactNumber && <> · 📞 <a href={`tel:${matches[0].contactNumber}`} style={{ color: "#1d4ed8" }}>{matches[0].contactNumber}</a></>}
                          <span style={{ color: "#a8a29e", marginLeft: 4 }}>{matches[0].matchReason}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              <div className="card-title" style={{ marginTop: 16 }}>🔍 Active Missing Reports</div>
              {allMissing.filter((r) => !r.is_duplicate_report).slice(0, 6).map((mr) => {
                const matches = registry.searchFound({
                  description: mr.missingPerson.clothing,
                  ageRange: mr.missingPerson.ageRange,
                  gender: mr.missingPerson.gender,
                  clothingDescription: mr.missingPerson.clothing,
                  lastSeenZone: mr.missingPerson.lastSeenLocation,
                });
                const hasMatch = matches.length > 0;
                const isHeld = mr.held;
                return (
                  <div key={mr.id} className="notif-item" style={{ borderLeft: isHeld ? "3px solid #dc2626" : hasMatch ? "3px solid #16a34a" : undefined, background: isHeld ? "#fef2f2" : hasMatch ? "#f0fdf4" : undefined, borderRadius: 6, alignItems: "flex-start" }}>
                    {mr.photoBase64 && (
                      <img src={`data:image/jpeg;base64,${mr.photoBase64}`} alt="Person" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, flexShrink: 0, border: "1px solid #e5e7eb", marginRight: 6 }} />
                    )}
                    {!mr.photoBase64 && <div className="notif-dot" style={{ background: isHeld ? "#dc2626" : "#d97706" }} />}
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{mr.id}</span>
                        <div style={{ display: "flex", gap: 4 }}>
                          {isHeld && <span style={{ fontSize: 10, background: "#dc2626", color: "white", borderRadius: 10, padding: "1px 6px" }}>🔒 HELD</span>}
                          {hasMatch && !isHeld && <span style={{ fontSize: 10, background: "#16a34a", color: "white", borderRadius: 10, padding: "1px 6px" }}>✅ FOUND</span>}
                          {mr.is_duplicate_report && <span className="badge badge-amber">Linked</span>}
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: "#57534e" }}>
                        {mr.missingPerson.name ?? "Unknown"} · {mr.missingPerson.ageRange} · {mr.missingPerson.clothing.slice(0, 35)}
                      </div>
                      <div style={{ fontSize: 11, color: "#a8a29e" }}>{mr.reportingCenter}</div>
                      {isHeld && mr.suspicionNotes && (
                        <div style={{ fontSize: 11, color: "#b91c1c", background: "#fee2e2", padding: "2px 6px", borderRadius: 4, marginTop: 3 }}>🚨 {mr.suspicionNotes}</div>
                      )}
                      {hasMatch && (
                        <div style={{ marginTop: 4, fontSize: 11, color: "#15803d", background: "#f0fdf4", padding: "3px 6px", borderRadius: 4 }}>
                          ✅ Possible match: {matches[0].id} at {matches[0].centerName} ({Math.round(matches[0].confidence * 100)}%)
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="two-panel__right">
              <MapView userLocation={userLocation} markers={markers} showSatellite={false} height="100%" zoom={13} />
            </div>
          </div>
        </div>
      )}

      {/* REGISTER — Help a person/family at the desk */}
      {tab === "register-found" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {/* Scenario picker */}
          <div style={{ padding: "12px 16px", background: "white", borderBottom: "1px solid #e7e5e4", display: "flex", gap: 8 }}>
            <button
              onClick={() => { setScenario("family-reports"); setAgentResult(null); setRefNumber(null); }}
              className={`btn btn-sm ${scenario === "family-reports" ? "btn-primary" : "btn-ghost"}`}
            >
              👨‍👩‍👧 Family reporting
            </button>
            <button
              onClick={() => { setScenario("person-self-reports"); setAgentResult(null); setRefNumber(null); }}
              className={`btn btn-sm ${scenario === "person-self-reports" ? "btn-primary" : "btn-ghost"}`}
            >
              🙋 Person is here
            </button>
          </div>

          {/* Contact + status bar */}
          <div style={{ padding: "10px 16px", background: "#fafaf9", borderBottom: "1px solid #e7e5e4", display: "flex", gap: 8 }}>
            <input
              type="tel"
              value={contactNumber}
              onChange={(e) => setContactNumber(e.target.value)}
              placeholder="Contact number (for SMS)"
              className="input"
              style={{ flex: 1 }}
            />
            {refNumber && <span className="badge badge-green" style={{ flexShrink: 0 }}>✅ {refNumber}</span>}
          </div>

          <ChatAgent
            langCode="en"
            key={`${deskId}-${scenario}`}
            initialPrompt={
              scenario === "family-reports"
                ? `I am a help desk operator at ${registry.getCenterById(deskId)?.name ?? deskId}. A family has arrived to report a missing family member. Please help me take their report and search the registry.`
                : `I am a help desk operator at ${registry.getCenterById(deskId)?.name ?? deskId}. A person has arrived at our desk who is separated from their family. Please help me register them (use register_found_person with centerId="${deskId}") and search for their family.`
            }
            onResult={handleAgentResult}
            placeholder={scenario === "family-reports" ? "Family member details…" : "Describe the person at your desk…"}
            showVoice={false}
          />
        </div>
      )}

      {/* SEARCH */}
      {tab === "search" && (
        <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
          <div className="form-row">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, clothing, zone, language, ID…"
              className="input"
            />
          </div>

          {/* Found persons */}
          <div className="card-title">Found Persons ({filterFoundPersons().length})</div>
          {filterFoundPersons().slice(0, 8).map((fp) => (
            <div key={fp.id} className="notif-item">
              <div className="notif-dot" />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{fp.id} · {fp.centerName}</div>
                <div style={{ fontSize: 12, color: "#57534e" }}>{fp.ageRange} {fp.gender} · {fp.clothing}</div>
                <div style={{ fontSize: 11, color: "#a8a29e" }}>{fp.languageSpoken} · Found: {fp.foundZone}</div>
              </div>
              <span className={`badge ${fp.status === "waiting" ? "badge-amber" : "badge-green"}`}>{fp.status}</span>
            </div>
          ))}

          <div className="divider" />

          {/* Missing reports */}
          <div className="card-title">Missing Reports ({filterMissingReports().length})</div>
          {filterMissingReports().slice(0, 8).map((mr) => (
            <div key={mr.id} className="notif-item">
              <div className="notif-dot" style={{ background: "#d97706" }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>
                  {mr.id}
                  {mr.is_duplicate_report && <span className="badge badge-amber" style={{ marginLeft: 6 }}>Dup</span>}
                </div>
                <div style={{ fontSize: 12, color: "#57534e" }}>
                  {mr.missingPerson.name ?? "Unknown"} · {mr.missingPerson.ageRange} · {mr.missingPerson.clothing}
                </div>
                <div style={{ fontSize: 11, color: "#a8a29e" }}>
                  {mr.reportingCenter} · {mr.missingPerson.languageSpoken}
                  {mr.contactNumber && ` · 📞 ${mr.contactNumber}`}
                </div>
              </div>
              <span className={`badge ${mr.status === "active" ? "badge-amber" : "badge-green"}`}>{mr.status}</span>
            </div>
          ))}
        </div>
      )}

      {/* NOTIFICATIONS */}
      {tab === "notifications" && (
        <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
          {notifications.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#a8a29e" }}>
              <div style={{ fontSize: 40 }}>🔔</div>
              <p style={{ marginTop: 12 }}>No alerts yet</p>
            </div>
          ) : (
            [...notifications].reverse().map((n) => (
              <div
                key={n.id}
                className="notif-item"
                onClick={() => notifyBackend.markRead(n.id)}
                style={{ cursor: "pointer", opacity: n.read ? .6 : 1, borderLeft: n.urgency === "high" ? "3px solid #dc2626" : "3px solid transparent" }}
              >
                <div className={`notif-dot ${n.urgency}`} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{n.centerName}</span>
                    <span className={`badge ${n.urgency === "high" ? "badge-red" : n.urgency === "medium" ? "badge-amber" : "badge-blue"}`}>{n.urgency}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "#1c1917", marginTop: 4 }}>{n.message}</div>
                  <div style={{ fontSize: 11, color: "#a8a29e", marginTop: 4 }}>{new Date(n.sentAt).toLocaleTimeString()}</div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* VERIFY — 4-digit PIN handover check */}
      {tab === "verify" && <VerifyHandover deskId={deskId} />}

      {/* INTEL — Separation hotspot map + suggested placements */}
      {tab === "intel" && (
        <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="card-title">🧠 Separation Hotspot Intelligence</div>
            <p style={{ fontSize: 13, color: "#57534e", marginBottom: 12 }}>
              Predicted separation clusters based on chokepoint density and CCTV pressure.
              Purple pins = where a help desk would reduce separation risk most.
            </p>
            <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#57534e", marginBottom: 8 }}>
              <span><span style={{ color: "#dc2626", fontWeight: 700 }}>●</span> High risk</span>
              <span><span style={{ color: "#f97316", fontWeight: 700 }}>●</span> Medium risk</span>
              <span><span style={{ color: "#eab308", fontWeight: 700 }}>●</span> Low risk</span>
              <span><span style={{ color: "#7c3aed", fontWeight: 700 }}>📍</span> Suggested desk</span>
            </div>
          </div>

          <div style={{ borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
            <MapView
              userLocation={userLocation}
              markers={markers}
              hotspots={hotspots}
              suggestedDesks={suggestedDesks}
              showHotspots={true}
              showSatellite={false}
              height={340}
              zoom={13}
            />
          </div>

          {/* Underserved zone list */}
          <div className="card-title">⚠️ Underserved High-Risk Zones</div>
          {hotspots.filter((h) => h.isUnderserved && h.risk === "high").slice(0, 8).map((h, i) => (
            <div key={i} className="notif-item" style={{ borderLeft: "3px solid #dc2626", background: "#fff5f5" }}>
              <div className="notif-dot" style={{ background: "#dc2626" }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{h.name}</div>
                <div style={{ fontSize: 12, color: "#57534e" }}>
                  Density: {Math.round(h.densityScore * 100)}% · Nearest center: {h.nearestCenterKm} km away
                </div>
              </div>
              <span className="badge badge-red">Underserved</span>
            </div>
          ))}
          {hotspots.filter((h) => h.isUnderserved && h.risk === "high").length === 0 && (
            <div style={{ textAlign: "center", padding: "20px", color: "#a8a29e", fontSize: 13 }}>
              ✅ All high-risk zones are within 600 m of a help center
            </div>
          )}

          {/* Suggested desk placements */}
          {suggestedDesks.length > 0 && (
            <>
              <div className="card-title" style={{ marginTop: 16 }}>📍 Suggested Desk Placements</div>
              {suggestedDesks.map((sd, i) => (
                <div key={i} className="card" style={{ background: "#f5f3ff", borderColor: "#7c3aed", marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#4c1d95" }}>{sd.label}</div>
                    <span className={`badge ${sd.urgency === "critical" ? "badge-red" : "badge-amber"}`}>{sd.urgency}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#57534e", marginTop: 4 }}>{sd.reason}</div>
                  <div style={{ fontSize: 11, color: "#a8a29e", marginTop: 4 }}>
                    📍 {sd.lat.toFixed(5)}, {sd.lng.toFixed(5)}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* CCTV — Camera lookup + nearest police station notification */}
      {tab === "cctv" && <CCTVPanel deskId={deskId} userLocation={userLocation} />}

      {/* PSA — Public Service Announcement broadcaster */}
      {tab === "psa" && <PSABroadcaster />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CCTV Panel — find cameras near a zone/ref + notify nearest police station
// ─────────────────────────────────────────────────────────────────────────────

const ALL_CCTV = cctvRaw as CctvPoint[];

function CCTVPanel({ deskId, userLocation }: { deskId: string; userLocation: UserLocation | null }) {
  const [query, setQuery] = useState("");
  const [refId, setRefId] = useState("");
  const [cameras, setCameras] = useState<CctvPoint[]>([]);
  const [searched, setSearched] = useState(false);
  const [centerLat, setCenterLat] = useState<number | null>(null);
  const [centerLng, setCenterLng] = useState<number | null>(null);
  const [notifyStatus, setNotifyStatus] = useState<Record<string, "idle" | "sending" | "sent">>({});

  const policeStations: PoliceStation[] = registry.getPoliceStations();

  function handleSearch() {
    // Try to find the report/zone to get coordinates
    let lat: number | null = null;
    let lng: number | null = null;

    // Try by ref ID — look up report, then use center lat/lng
    if (refId.trim()) {
      const report = registry.getMissingReportById(refId.trim().toUpperCase());
      if (report) {
        const centerObj = registry.getCenterById(report.reportingCenter) ?? registry.getHelpCenters()[0];
        if (centerObj) { lat = centerObj.location.lat; lng = centerObj.location.lng; }
      }
    }

    // Try by zone name — match help center or fallback to user location
    if (!lat) {
      const q = query.toLowerCase();
      const center = registry.getHelpCenters().find(c =>
        c.name.toLowerCase().includes(q) || c.zone.toLowerCase().includes(q)
      );
      if (center) { lat = center.location.lat; lng = center.location.lng; }
    }

    // Last resort — use user/desk location
    if (!lat && userLocation) { lat = userLocation.lat; lng = userLocation.lng; }
    if (!lat) { lat = 20.0042; lng = 73.7896; } // Ramkund default

    setCenterLat(lat);
    setCenterLng(lng);

    // Find cameras within 1 km
    const nearby = ALL_CCTV
      .map(c => ({ ...c, distKm: haversineKm({ lat: lat ?? 0, lng: lng ?? 0 }, { lat: c.lat, lng: c.lng }) }))
      .filter(c => c.distKm <= 1.0)
      .sort((a, b) => a.distKm - b.distKm)
      .slice(0, 20);

    setCameras(nearby as CctvPoint[]);
    setSearched(true);
  }

  function nearestPoliceStation(): PoliceStation | null {
    if (!centerLat || !centerLng) return null;
    return policeStations
      .map(ps => ({ ...ps, d: haversineKm({ lat: centerLat, lng: centerLng }, ps.location) }))
      .sort((a, b) => a.d - b.d)[0] ?? null;
  }

  async function notifyPolice(ps: PoliceStation) {
    setNotifyStatus(s => ({ ...s, [ps.id]: "sending" }));

    const report = refId ? registry.getMissingReportById(refId.trim().toUpperCase()) : null;
    const desc = report
      ? `Missing person report ${report.id}: ${report.missingPerson.ageRange} ${report.missingPerson.gender}, ${report.missingPerson.clothing}. Last seen: ${report.missingPerson.lastSeenLocation}.`
      : `CCTV check requested for zone: ${query || "near help desk"}. ${cameras.length} cameras identified.`;

    // Notify via internal notification system
    notifyBackend.send({
      centerId: deskId,
      centerName: ps.name,
      message: `🚔 POLICE NOTIFICATION from ${deskId}: ${desc} Please check CCTV cameras in the area and assist. Ref: ${refId || "—"}.`,
      urgency: "high",
    });

    // In a real system this would call police via API; for demo, log to console
    console.log(`[POLICE NOTIFY] → ${ps.name}: ${desc}`);

    await new Promise(r => setTimeout(r, 800));
    setNotifyStatus(s => ({ ...s, [ps.id]: "sent" }));
  }

  const nearest = nearestPoliceStation();
  const cameraMarkers: MapMarker[] = cameras.slice(0, 20).map(c => ({
    type: "found" as const,
    lat: c.lat,
    lng: c.lng,
    label: c.id,
    detail: c.label,
  }));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto" }}>
      <div className="two-panel">
        <div className="two-panel__left" style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: "#1e293b" }}>
            📷 Find CCTV Cameras Near a Zone
          </div>

          {/* Search inputs */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            <input
              className="input"
              value={refId}
              onChange={e => setRefId(e.target.value)}
              placeholder="Ref number (LP-XXXXX) — optional"
            />
            <input
              className="input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Zone or area name (e.g. Ramkund, Panchavati)"
              onKeyDown={e => e.key === "Enter" && handleSearch()}
            />
            <button onClick={handleSearch} className="btn btn-primary">
              🔍 Find Nearby Cameras
            </button>
          </div>

          {/* Results */}
          {searched && (
            <>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: cameras.length > 0 ? "#15803d" : "#dc2626" }}>
                {cameras.length > 0 ? `✅ ${cameras.length} camera(s) within 1 km` : "⚠️ No cameras found within 1 km"}
              </div>

              {cameras.slice(0, 8).map(c => (
                <div key={c.id} className="notif-item" style={{ fontSize: 12 }}>
                  <div className="notif-dot" style={{ background: "#7c3aed" }} />
                  <div>
                    <div style={{ fontWeight: 600 }}>{c.id} — {c.label}</div>
                    <div style={{ color: "#a8a29e" }}>{c.lat.toFixed(5)}, {c.lng.toFixed(5)}</div>
                  </div>
                </div>
              ))}

              {/* Nearest police station */}
              {nearest && (
                <div style={{ marginTop: 16, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "12px 14px" }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#1d4ed8", marginBottom: 6 }}>
                    👮 Nearest Police Station
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{nearest.name}</div>
                  <div style={{ fontSize: 11, color: "#57534e", marginBottom: 10 }}>
                    {haversineKm({ lat: centerLat ?? 0, lng: centerLng ?? 0 }, nearest.location).toFixed(2)} km away
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => notifyPolice(nearest)}
                      disabled={notifyStatus[nearest.id] === "sent"}
                      className="btn btn-primary btn-sm"
                      style={{ flex: 1, background: notifyStatus[nearest.id] === "sent" ? "#16a34a" : undefined }}
                    >
                      {notifyStatus[nearest.id] === "sending" && "Notifying…"}
                      {notifyStatus[nearest.id] === "sent" && "✅ Notified"}
                      {(!notifyStatus[nearest.id] || notifyStatus[nearest.id] === "idle") && "🚔 Notify Police"}
                    </button>
                    <a
                      href={`tel:100`}
                      className="btn btn-ghost btn-sm"
                      style={{ flex: 1, textAlign: "center", textDecoration: "none" }}
                    >
                      📞 Call 100
                    </a>
                  </div>

                  {/* Also show all stations within 3 km */}
                  {policeStations
                    .map(ps => ({ ...ps, d: haversineKm({ lat: centerLat ?? 0, lng: centerLng ?? 0 }, ps.location) }))
                    .filter(ps => ps.d <= 3)
                    .sort((a, b) => a.d - b.d)
                    .slice(1, 4)
                    .map(ps => (
                      <div key={ps.id} style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "#374151" }}>
                        <span>{ps.name} ({ps.d.toFixed(1)} km)</span>
                        <button
                          onClick={() => notifyPolice(ps)}
                          disabled={notifyStatus[ps.id] === "sent"}
                          style={{ fontSize: 11, padding: "3px 8px", background: notifyStatus[ps.id] === "sent" ? "#16a34a" : "#1d4ed8", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}
                        >
                          {notifyStatus[ps.id] === "sent" ? "✅" : "Notify"}
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </>
          )}

          {!searched && (
            <div style={{ color: "#a8a29e", fontSize: 13, textAlign: "center", padding: "20px 0" }}>
              Enter a zone name or ref number and click Find to locate CCTV cameras
            </div>
          )}
        </div>

        {/* Map showing cameras */}
        <div className="two-panel__right">
          <MapView
            userLocation={centerLat && centerLng
              ? { lat: centerLat, lng: centerLng, source: "gps", accuracy: 10 }
              : userLocation}
            markers={cameraMarkers}
            showSatellite={true}
            height="100%"
            zoom={15}
          />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Verify Handover — full 6-step handover chain
// ─────────────────────────────────────────────────────────────────────────────

type HandoverStep = 1 | 2 | 3 | 4 | 5 | 6;

function isMinor(ageRange: string): boolean {
  const minorKeywords = ["child", "infant", "toddler", "3-", "4-", "5-", "6-", "7-", "8-", "9-", "10", "11", "12"];
  const lower = ageRange.toLowerCase();
  return minorKeywords.some(k => lower.includes(k));
}

function VerifyHandover({ deskId }: { deskId: string }) {
  const [step, setStep] = useState<HandoverStep>(1);

  // Step 1 — Lookup
  const [refInput, setRefInput] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [report, setReport] = useState<import("../types").MissingReport | null>(null);

  // Step 2 — Found person + center
  const [fpIdInput, setFpIdInput] = useState("");
  const [fpLookupError, setFpLookupError] = useState("");
  const [foundPerson, setFoundPerson] = useState<import("../types").FoundPerson | null>(null);
  const [holdingCenter, setHoldingCenter] = useState<import("../types").HelpCenter | null>(null);

  // Step 3 — PIN
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [suspicionNotes, setSuspicionNotes] = useState("");
  const [suspicionFlagged, setSuspicionFlagged] = useState(false);
  const [showSuspicionForm, setShowSuspicionForm] = useState(false);

  // Step 4 — Minor check
  const [policeEscortArranged, setPoliceEscortArranged] = useState(false);

  // Step 5 — Reunion point (loaded after step 3/4)
  const [reunionPoint, setReunionPoint] = useState<import("../types").ReunionPoint | null>(null);

  // Step 6 — Completion
  const [handoverLog, setHandoverLog] = useState<import("../types").HandoverLog | null>(null);

  const recentLogs = registry.getHandoverLogs().slice(-5).reverse();

  function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    const id = refInput.trim().toUpperCase();
    const found = registry.getMissingReportById(id);
    if (!found) {
      setLookupError(`No report found with ID ${id}`);
      return;
    }
    if (found.status !== "active") {
      setLookupError(`Report ${id} is already ${found.status}`);
      return;
    }
    setReport(found);
    setLookupError("");
    setStep(2);
  }

  function handleFpLookup(e: React.FormEvent) {
    e.preventDefault();
    const id = fpIdInput.trim().toUpperCase();
    const fp = registry.getFoundPersonById(id);
    if (!fp) {
      setFpLookupError(`No found person with ID ${id}`);
      return;
    }
    const center = registry.getCenterById(fp.centerId) ?? null;
    setFoundPerson(fp);
    setHoldingCenter(center);
    setFpLookupError("");
    setStep(3);
  }

  function handlePinVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!report) return;
    if (report.verificationCode !== pin.trim()) {
      setPinError("❌ PIN does not match — do not release. Re-confirm identity or call police (100).");
      return;
    }
    setPinError("");
    const minor = isMinor(report.missingPerson.ageRange);
    if (minor) {
      setStep(4);
    } else {
      const zone = foundPerson?.foundZone ?? report.missingPerson.lastSeenLocation;
      const rp = registry.getReunionPointForZone(zone) ?? null;
      setReunionPoint(rp);
      setStep(5);
    }
  }

  function proceedFromMinorCheck() {
    const zone = foundPerson?.foundZone ?? report?.missingPerson.lastSeenLocation ?? "";
    const rp = registry.getReunionPointForZone(zone) ?? null;
    setReunionPoint(rp);
    setStep(5);
  }

  function handleCompleteHandover() {
    if (!report) return;
    const fpId = foundPerson?.id ?? "";
    const log = registry.logHandover(report.id, fpId, deskId, "DESK-OPERATOR");
    setHandoverLog(log);
    setStep(6);
  }

  function resetFlow() {
    setStep(1);
    setRefInput(""); setLookupError(""); setReport(null);
    setFpIdInput(""); setFpLookupError(""); setFoundPerson(null); setHoldingCenter(null);
    setPin(""); setPinError("");
    setSuspicionNotes(""); setSuspicionFlagged(false); setShowSuspicionForm(false);
    setPoliceEscortArranged(false);
    setReunionPoint(null);
    setHandoverLog(null);
  }

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 16 }}>

      {/* Step progress bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, alignItems: "center" }}>
        {([1,2,3,4,5,6] as HandoverStep[]).map((s) => (
          <div key={s} style={{
            flex: 1, height: 4, borderRadius: 4,
            background: step >= s ? "#1d4ed8" : "#e7e5e4",
            transition: "background .3s",
          }} />
        ))}
      </div>

      {/* STEP 1 — Lookup by reference number */}
      {step === 1 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Step 1 of 6 — Lookup Missing Report</div>
          <p style={{ fontSize: 13, color: "#57534e", marginBottom: 12 }}>
            Enter the family's reference number (LP-XXXXX) to look up the missing report.
          </p>
          <form onSubmit={handleLookup} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label className="input-label">Reference Number</label>
              <input
                className="input"
                value={refInput}
                onChange={e => { setRefInput(e.target.value); setLookupError(""); }}
                placeholder="LP-25000"
                style={{ fontFamily: "monospace", fontWeight: 700 }}
              />
            </div>
            {lookupError && <p style={{ fontSize: 13, color: "#dc2626" }}>{lookupError}</p>}
            <button type="submit" className="btn btn-primary" disabled={!refInput.trim()}>
              🔍 Look Up Report
            </button>
          </form>
        </div>
      )}

      {/* STEP 2 — Confirm holding center */}
      {step === 2 && report && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Step 2 of 6 — Confirm Holding Center</div>

          <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{report.id}</div>
            <div style={{ fontSize: 13, color: "#57534e", marginTop: 2 }}>
              {report.missingPerson.name ?? "Unknown"} · {report.missingPerson.ageRange} · {report.missingPerson.gender}
            </div>
            <div style={{ fontSize: 12, color: "#57534e", marginTop: 2 }}>{report.missingPerson.clothing}</div>
            <div style={{ fontSize: 12, color: "#78716c", marginTop: 2 }}>Last seen: {report.missingPerson.lastSeenLocation}</div>
            <div style={{ fontSize: 12, color: "#78716c" }}>Reported by: {report.reportedBy}</div>
          </div>

          <p style={{ fontSize: 13, color: "#57534e", marginBottom: 8 }}>
            Enter the Found Person ID (FP-XXXXX) to confirm who is being held and at which center.
          </p>
          <form onSubmit={handleFpLookup} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label className="input-label">Found Person ID (FP-XXXXX)</label>
              <input
                className="input"
                value={fpIdInput}
                onChange={e => { setFpIdInput(e.target.value); setFpLookupError(""); }}
                placeholder="FP-100"
                style={{ fontFamily: "monospace" }}
              />
            </div>
            {fpLookupError && <p style={{ fontSize: 13, color: "#dc2626" }}>{fpLookupError}</p>}
            <button type="submit" className="btn btn-primary" disabled={!fpIdInput.trim()}>
              Confirm Found Person →
            </button>
          </form>
        </div>
      )}

      {/* STEP 3 — PIN Verification */}
      {step === 3 && report && foundPerson && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Step 3 of 6 — PIN Verification</div>

          {holdingCenter && (
            <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#1d4ed8" }}>
                {foundPerson.id} is currently held at:
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{holdingCenter.name}</div>
              <div style={{ marginTop: 6 }}>
                <a
                  href={`tel:${holdingCenter.contactNumber}`}
                  style={{ fontSize: 13, color: "#1d4ed8", fontWeight: 700, textDecoration: "none" }}
                >
                  📞 Call {holdingCenter.name} — {holdingCenter.contactNumber}
                </a>
              </div>
            </div>
          )}

          <p style={{ fontSize: 13, color: "#57534e", marginBottom: 12 }}>
            Ask the family to quote their <strong>4-digit PIN</strong>. Do not release without a match.
          </p>
          <form onSubmit={handlePinVerify} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label className="input-label">4-Digit Verification PIN</label>
              <input
                className="input"
                value={pin}
                onChange={e => { setPin(e.target.value.replace(/\D/g, "").slice(0, 4)); setPinError(""); }}
                placeholder="••••"
                maxLength={4}
                inputMode="numeric"
                style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 22, letterSpacing: 8, textAlign: "center" }}
              />
            </div>
            {pinError && (
              <div style={{ background: "#fef2f2", border: "1px solid #dc2626", borderRadius: 8, padding: "10px 12px", fontSize: 13, color: "#b91c1c", fontWeight: 600 }}>
                {pinError}
              </div>
            )}
            <button type="submit" className="btn btn-primary" disabled={pin.length < 4}>
              🔐 Verify PIN
            </button>
          </form>

          {/* Suspicion flag — adversarial claimant */}
          {!suspicionFlagged ? (
            <div style={{ marginTop: 16 }}>
              {!showSuspicionForm ? (
                <button
                  type="button"
                  onClick={() => setShowSuspicionForm(true)}
                  style={{ width: "100%", padding: "9px", background: "#fef2f2", color: "#b91c1c", border: "2px solid #fca5a5", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 }}
                >
                  🚨 Flag Suspicious Claimant
                </button>
              ) : (
                <div style={{ background: "#fef2f2", border: "2px solid #dc2626", borderRadius: 10, padding: "14px" }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#b91c1c", marginBottom: 8 }}>🚨 Flag as Suspicious — DO NOT release</div>
                  <textarea
                    style={{ width: "100%", padding: "8px 10px", border: "1px solid #fca5a5", borderRadius: 6, fontSize: 13, minHeight: 60, resize: "vertical", boxSizing: "border-box" }}
                    placeholder="Describe the suspicious behaviour (e.g. can't confirm relationship, claimant nervous, story inconsistent)"
                    value={suspicionNotes}
                    onChange={e => setSuspicionNotes(e.target.value)}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!report) return;
                        await flagSuspicionSync(report.id, suspicionNotes || "Flagged at handover desk");
                        notifyBackend.send({
                          centerId: deskId,
                          centerName: "POLICE",
                          message: `🚨 SUSPICIOUS CLAIMANT — Report ${report.id}. ${suspicionNotes || "Flagged at handover"}. Record put on hold. Do NOT release.`,
                          urgency: "high",
                        });
                        setSuspicionFlagged(true);
                        setShowSuspicionForm(false);
                      }}
                      disabled={!suspicionNotes.trim()}
                      style={{ flex: 1, padding: "8px", background: "#dc2626", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 700 }}
                    >
                      🔒 Hold Record + Notify Police
                    </button>
                    <button type="button" onClick={() => setShowSuspicionForm(false)} style={{ padding: "8px 14px", background: "#f3f4f6", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ marginTop: 16, background: "#dc2626", color: "white", borderRadius: 10, padding: "14px", textAlign: "center" }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>🔒 Record HELD — Police Notified</div>
              <div style={{ fontSize: 12, marginTop: 4, opacity: .9 }}>Do not release. Await police instructions.</div>
              <a href="tel:100" style={{ display: "inline-block", marginTop: 8, color: "white", fontWeight: 700, textDecoration: "underline" }}>📞 Call Police 100</a>
            </div>
          )}
        </div>
      )}

      {/* STEP 4 — Minor check */}
      {step === 4 && report && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Step 4 of 6 — Minor Check</div>
          <div style={{ background: "#fef2f2", border: "2px solid #dc2626", borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#b91c1c" }}>
              ⚠️ MINOR — Police escort required before release
            </div>
            <div style={{ fontSize: 13, color: "#7f1d1d", marginTop: 6 }}>
              Age range "{report.missingPerson.ageRange}" indicates this may be a minor.
              A police escort must be arranged before release.
            </div>
            <div style={{ marginTop: 10 }}>
              <a href="tel:100" style={{ fontSize: 14, color: "#b91c1c", fontWeight: 700, textDecoration: "none" }}>
                📞 Call Police (100)
              </a>
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={policeEscortArranged}
              onChange={e => setPoliceEscortArranged(e.target.checked)}
              style={{ marginTop: 2, flexShrink: 0, width: 18, height: 18 }}
            />
            <span style={{ fontWeight: 600 }}>Police escort arranged ✓</span>
          </label>
          <button
            className="btn btn-primary"
            style={{ marginTop: 16, width: "100%" }}
            disabled={!policeEscortArranged}
            onClick={proceedFromMinorCheck}
          >
            Proceed to Reunion Point →
          </button>
        </div>
      )}

      {/* STEP 5 — Reunion point */}
      {step === 5 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Step 5 of 6 — Reunion Point</div>
          {reunionPoint ? (
            <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "12px 14px", marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>📍 {reunionPoint.name}</div>
              <div style={{ fontSize: 13, color: "#57534e", marginTop: 4 }}>{reunionPoint.landmark}</div>
              {reunionPoint.landmark_hi && (
                <div style={{ fontSize: 13, color: "#57534e", marginTop: 2 }}>{reunionPoint.landmark_hi}</div>
              )}
              <div style={{ fontSize: 12, color: "#78716c", marginTop: 4 }}>Zone: {reunionPoint.zone}</div>
              <div style={{ fontSize: 12, color: "#78716c" }}>Volunteer: {reunionPoint.volunteerAssigned}</div>
              <a
                href={`https://maps.google.com/?q=${reunionPoint.location.lat},${reunionPoint.location.lng}`}
                target="_blank"
                rel="noreferrer"
                style={{ display: "inline-block", marginTop: 10, fontSize: 13, color: "#1d4ed8", fontWeight: 700, textDecoration: "none" }}
              >
                🗺 Get directions
              </a>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "#57534e", marginBottom: 12 }}>
              No specific reunion point found — use the nearest help center.
            </div>
          )}
          <button
            className="btn btn-primary"
            style={{ background: "#16a34a", borderColor: "#16a34a", width: "100%" }}
            onClick={handleCompleteHandover}
          >
            ✅ Complete Handover — Release to Family
          </button>
        </div>
      )}

      {/* STEP 6 — Done */}
      {step === 6 && handoverLog && (
        <div className="card" style={{ background: "#f0fdf4", borderColor: "#16a34a", borderWidth: 2, marginBottom: 16 }}>
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <div style={{ fontSize: 40 }}>🎉</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: "#15803d", marginTop: 8 }}>Reunited!</div>
            <div style={{ fontFamily: "monospace", fontSize: 14, background: "#dcfce7", color: "#15803d", padding: "4px 14px", borderRadius: 8, marginTop: 8, display: "inline-block", fontWeight: 700 }}>
              Ref: {handoverLog.reportId}
            </div>
            <div style={{ fontSize: 13, color: "#57534e", marginTop: 8 }}>
              DESK-OPERATOR witness present
            </div>
            <div style={{ fontSize: 12, color: "#a8a29e", marginTop: 4 }}>
              Logged: {new Date(handoverLog.verifiedAt).toLocaleTimeString()}
            </div>
          </div>
          <button className="btn btn-ghost btn-full" style={{ marginTop: 8 }} onClick={resetFlow}>
            ← Start new handover
          </button>
        </div>
      )}

      {/* Recent handover log */}
      {recentLogs.length > 0 && step !== 6 && (
        <div>
          <div className="card-title">📋 Recent Handovers (this session)</div>
          {recentLogs.map((log) => (
            <div key={log.id} className="notif-item" style={{ borderLeft: "3px solid #16a34a" }}>
              <div className="notif-dot" style={{ background: "#16a34a" }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>
                  {log.reportId} → {log.foundPersonId || "—"}
                </div>
                <div style={{ fontSize: 12, color: "#57534e" }}>
                  Operator: {log.verifiedBy} · {new Date(log.verifiedAt).toLocaleTimeString()}
                </div>
              </div>
              <span className="badge badge-green">Released</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PSA Broadcaster — uses Web Speech API (no API key, built into Chrome/Safari)
// ─────────────────────────────────────────────────────────────────────────────
const PSA_LANGUAGES = [
  { code: "mr-IN", label: "मराठी" },
  { code: "hi-IN", label: "हिन्दी" },
  { code: "en-IN", label: "English" },
  { code: "gu-IN", label: "ગુજરાતી" },
  { code: "bn-IN", label: "বাংলা" },
  { code: "te-IN", label: "తెలుగు" },
  { code: "ta-IN", label: "தமிழ்" },
];

const PSA_TEMPLATES: Record<string, Record<string, string>> = {
  "hi-IN": {
    missing_child: "ध्यान दें! कुंभ मेला प्रशासन की सूचना — एक बच्चा खो गया है। कृपया निकटतम सहायता केंद्र पर जाएं या 100 नंबर पर कॉल करें।",
    missing_elder: "ध्यान दें! एक बुजुर्ग व्यक्ति अपने परिवार से बिछड़ गए हैं। यदि आपने किसी असहाय बुजुर्ग को देखा हो तो कृपया उन्हें निकटतम खो-या-पाया केंद्र तक पहुंचाएं।",
    general: "कुंभ मेला 2027 — यदि आप अपने परिवार से बिछड़ गए हैं, तो घबराएं नहीं। नजदीकी हरे रंग के सहायता केंद्र पर जाएं। Claude AI आपकी मदद करेगा।",
  },
  "mr-IN": {
    missing_child: "लक्ष द्या! कुंभमेळा प्रशासनाची सूचना — एक मुल हरवले आहे. कृपया जवळच्या मदत केंद्रावर जा किंवा 100 वर फोन करा.",
    missing_elder: "लक्ष द्या! एक वृद्ध व्यक्ती आपल्या कुटुंबापासून वेगळे झाले आहेत. कृपया त्यांना जवळच्या हरवले-सापडले केंद्रावर घेऊन जा.",
    general: "कुंभमेळा 2027 — जर तुम्ही तुमच्या कुटुंबापासून वेगळे झाला असाल तर घाबरू नका. जवळच्या मदत केंद्रावर जा. Claude AI तुम्हाला मदत करेल.",
  },
  "en-IN": {
    missing_child: "Attention! Kumbh Mela Administration announcement — a child is missing. Please go to the nearest help center or call 100.",
    missing_elder: "Attention! An elderly person has been separated from their family. If you see an unaccompanied elderly person, please escort them to the nearest Kho-Ya-Paya center.",
    general: "Kumbh Mela 2027 — If you are separated from your family, do not panic. Go to the nearest green help center. Claude AI will assist you.",
  },
};

function PSABroadcaster() {
  const [psaLang, setPsaLang] = useState("hi-IN");
  const [psaText, setPsaText] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [repeat, setRepeat] = useState(3);
  const [status, setStatus] = useState<string | null>(null);

  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;

  function loadTemplate(key: string) {
    const templates = PSA_TEMPLATES[psaLang] ?? PSA_TEMPLATES["hi-IN"];
    setPsaText(templates[key] ?? "");
  }

  function broadcast() {
    if (!ttsSupported || !psaText.trim()) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(true);
    setStatus(`Broadcasting ${repeat}× in ${PSA_LANGUAGES.find(l => l.code === psaLang)?.label}…`);

    let count = 0;
    function speak() {
      if (count >= repeat) { setIsSpeaking(false); setStatus("✅ Broadcast complete"); return; }
      const utt = new SpeechSynthesisUtterance(psaText);
      utt.lang = psaLang;
      utt.rate = 0.85;
      utt.pitch = 1.0;
      utt.onend = () => { count++; setTimeout(speak, 800); };
      utt.onerror = () => { setIsSpeaking(false); setStatus("⚠️ TTS error — check browser permissions"); };
      window.speechSynthesis.speak(utt);
    }
    speak();
  }

  function stop() {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setStatus("Stopped");
  }

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
      <div className="card">
        <div className="card-title">📢 Public Service Announcement</div>
        <p style={{ fontSize: 13, color: "#57534e", marginBottom: 16 }}>
          Broadcast a multilingual announcement via text-to-speech. Works on any device with a speaker.
        </p>

        {/* Language */}
        <div className="form-row">
          <label className="input-label">Language</label>
          <select className="input" value={psaLang} onChange={e => { setPsaLang(e.target.value); setPsaText(""); }}>
            {PSA_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>

        {/* Templates */}
        <div className="form-row">
          <label className="input-label">Quick templates</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button onClick={() => loadTemplate("missing_child")} className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }}>👦 Missing Child</button>
            <button onClick={() => loadTemplate("missing_elder")} className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }}>👴 Missing Elder</button>
            <button onClick={() => loadTemplate("general")} className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }}>📣 General Alert</button>
          </div>
        </div>

        {/* Text */}
        <div className="form-row">
          <label className="input-label">Announcement text</label>
          <textarea
            className="input"
            value={psaText}
            onChange={e => setPsaText(e.target.value)}
            rows={5}
            placeholder="Type or select a template above…"
            style={{ resize: "vertical" }}
          />
        </div>

        {/* Repeat */}
        <div className="form-row" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <label className="input-label" style={{ marginBottom: 0 }}>Repeat</label>
          {[1, 2, 3, 5].map(n => (
            <button
              key={n}
              onClick={() => setRepeat(n)}
              style={{
                padding: "4px 12px", borderRadius: 20, fontSize: 13, cursor: "pointer",
                background: repeat === n ? "#f97316" : "white",
                color: repeat === n ? "white" : "#57534e",
                border: `1px solid ${repeat === n ? "#f97316" : "#e7e5e4"}`,
              }}
            >{n}×</button>
          ))}
        </div>

        {/* Broadcast */}
        {!ttsSupported && (
          <div className="badge" style={{ background: "#fee2e2", color: "#dc2626", marginBottom: 12 }}>
            ⚠️ Text-to-speech not supported in this browser. Use Chrome or Safari.
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button
            onClick={broadcast}
            disabled={isSpeaking || !psaText.trim() || !ttsSupported}
            className="btn btn-primary flex-1"
            style={{ background: "#f97316", borderColor: "#f97316", fontSize: 15 }}
          >
            {isSpeaking ? <><span className="spinner" /> Broadcasting…</> : "🔊 Broadcast Now"}
          </button>
          {isSpeaking && (
            <button onClick={stop} className="btn btn-ghost" style={{ color: "#dc2626", borderColor: "#dc2626" }}>
              ⏹ Stop
            </button>
          )}
        </div>

        {status && (
          <div style={{ marginTop: 12, fontSize: 13, color: "#57534e", textAlign: "center" }}>{status}</div>
        )}
      </div>

      {/* Live display */}
      {psaText && (
        <div className="card" style={{ marginTop: 12, background: "#fffbeb", borderColor: "#f59e0b" }}>
          <div className="card-title" style={{ color: "#92400e" }}>📺 Display Panel Text</div>
          <p style={{ fontSize: 18, lineHeight: 1.8, color: "#1c1917", fontWeight: 500 }}>{psaText}</p>
          <p style={{ fontSize: 11, color: "#a8a29e", marginTop: 8 }}>
            Show this on any screen at the venue for literacy-independent communication
          </p>
        </div>
      )}
    </div>
  );
}
