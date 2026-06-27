import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import MapView, { type MapMarker } from "../components/MapView";
import ChatAgent from "../components/ChatAgent";
import { getUserLocation, type UserLocation } from "../services/location";
import { sendSMS } from "../services/sms";
import { notifyBackend } from "../core/backends/notify";
import { registry } from "../core/backends/registry";
import { useOnline } from "../hooks/useOnline";
import { computeHotspots } from "../services/hotspots";
import type { AgentResult } from "../core/agent";
import type { Notification } from "../types";

// ────────────────────────��────────────────────────────────────────────────────
// Help Desk Panel
// Fixed-location admin interface for help desk staff (not volunteer, not family)
// Covers flows 3 (family at desk) and 6 (missing person at desk)
// ─────────────────────────────────────────────────────────────────────────────

type Tab = "queue" | "register-found" | "search" | "verify" | "intel" | "notifications" | "psa";
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
      {!isOnline && <div className="offline-banner">⚠️ Offline — operations queued</div>}

      {/* Header */}
      <div className="panel-header" style={{ background: "#1d4ed8" }}>
        <div>
          <h1>🏥 Help Desk</h1>
          <p>Kumbh Mela 2027 · Control Room</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => navigate("/")}
            style={{ fontSize: 11, color: "rgba(255,255,255,.7)", background: "rgba(255,255,255,.1)", padding: "4px 10px", borderRadius: 6, border: "none" }}
          >
            Public App ↗
          </button>
          <button
            onClick={() => navigate("/volunteer")}
            style={{ fontSize: 11, color: "rgba(255,255,255,.7)", background: "rgba(255,255,255,.1)", padding: "4px 10px", borderRadius: 6, border: "none" }}
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
        {(["queue", "register-found", "search", "verify", "intel", "notifications", "psa"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`tab-btn${tab === t ? " active" : ""}`} style={{ whiteSpace: "nowrap" }}>
            {t === "queue" && "📋 Queue"}
            {t === "register-found" && "👤 Register"}
            {t === "search" && "🔍 Search"}
            {t === "verify" && "🔐 Verify"}
            {t === "intel" && "🧠 Intel"}
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
                return (
                  <div key={fp.id} className="notif-item" style={{ borderLeft: hasMatch ? "3px solid #f97316" : undefined, background: hasMatch ? "#fff8f4" : undefined, borderRadius: hasMatch ? 6 : undefined }}>
                    <div className="notif-dot" style={{ background: fp.condition === "distressed" ? "#dc2626" : "#16a34a" }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{fp.id}</span>
                        <div style={{ display: "flex", gap: 4 }}>
                          {hasMatch && <span style={{ fontSize: 10, background: "#f97316", color: "white", borderRadius: 10, padding: "1px 6px" }}>⚡ MATCH</span>}
                          <span className={`badge ${fp.condition === "distressed" ? "badge-red" : "badge-green"}`}>{fp.condition}</span>
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: "#57534e" }}>{fp.ageRange} {fp.gender} · {fp.clothing.slice(0, 40)}</div>
                      <div style={{ fontSize: 11, color: "#a8a29e" }}>{fp.centerName} · {fp.languageSpoken}</div>
                      {hasMatch && (
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
                return (
                  <div key={mr.id} className="notif-item" style={{ borderLeft: hasMatch ? "3px solid #16a34a" : undefined, background: hasMatch ? "#f0fdf4" : undefined, borderRadius: hasMatch ? 6 : undefined }}>
                    <div className="notif-dot" style={{ background: "#d97706" }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{mr.id}</span>
                        <div style={{ display: "flex", gap: 4 }}>
                          {hasMatch && <span style={{ fontSize: 10, background: "#16a34a", color: "white", borderRadius: 10, padding: "1px 6px" }}>✅ FOUND</span>}
                          {mr.is_duplicate_report && <span className="badge badge-amber">Linked</span>}
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: "#57534e" }}>
                        {mr.missingPerson.name ?? "Unknown"} · {mr.missingPerson.ageRange} · {mr.missingPerson.clothing.slice(0, 35)}
                      </div>
                      <div style={{ fontSize: 11, color: "#a8a29e" }}>{mr.reportingCenter}</div>
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
              <MapView userLocation={userLocation} markers={markers} height="100%" zoom={13} />
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

      {/* PSA — Public Service Announcement broadcaster */}
      {tab === "psa" && <PSABroadcaster />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Verify Handover — 4-digit PIN check before releasing a found person
// ─────────────────────────────────────────────────────────────────────────────
function VerifyHandover({ deskId }: { deskId: string }) {
  const [reportId, setReportId] = useState("");
  const [fpId, setFpId] = useState("");
  const [pin, setPin] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string; reportedBy?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [handoverDone, setHandoverDone] = useState(false);

  const recentLogs = registry.getHandoverLogs().slice(-5).reverse();

  function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    // Simulate network delay for effect
    setTimeout(() => {
      const res = registry.verifyHandover(reportId.trim().toUpperCase(), fpId.trim().toUpperCase(), pin.trim());
      setResult({ ok: res.ok, message: res.message, reportedBy: res.report?.reportedBy });
      setLoading(false);
    }, 400);
  }

  function handleLogHandover() {
    if (!reportId || !fpId || !operatorName) return;
    registry.logHandover(reportId.trim().toUpperCase(), fpId.trim().toUpperCase(), deskId, operatorName);
    setHandoverDone(true);
    setResult(null);
    setReportId(""); setFpId(""); setPin("");
  }

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">🔐 Handover Verification</div>
        <p style={{ fontSize: 13, color: "#57534e", marginBottom: 16 }}>
          Family must quote the <strong>4-digit PIN</strong> issued when the missing report was filed.
          Do not release anyone without a matching PIN.
        </p>

        {handoverDone && (
          <div style={{ background: "#f0fdf4", border: "1px solid #16a34a", borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13, color: "#15803d", fontWeight: 600 }}>
            ✅ Handover logged. Report marked resolved. Person released.
          </div>
        )}

        <form onSubmit={handleVerify} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label className="input-label">Missing Report ID (e.g. LP-25000)</label>
            <input
              className="input"
              value={reportId}
              onChange={e => { setReportId(e.target.value); setResult(null); setHandoverDone(false); }}
              placeholder="LP-25000"
              style={{ fontFamily: "monospace", fontWeight: 700 }}
            />
          </div>
          <div>
            <label className="input-label">Found Person ID (e.g. FP-100) — optional</label>
            <input
              className="input"
              value={fpId}
              onChange={e => { setFpId(e.target.value); setResult(null); }}
              placeholder="FP-100"
              style={{ fontFamily: "monospace" }}
            />
          </div>
          <div>
            <label className="input-label">4-Digit Verification PIN</label>
            <input
              className="input"
              value={pin}
              onChange={e => { setPin(e.target.value.replace(/\D/g, "").slice(0, 4)); setResult(null); }}
              placeholder="••••"
              maxLength={4}
              inputMode="numeric"
              style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 22, letterSpacing: 8, textAlign: "center" }}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading || pin.length < 4 || !reportId}>
            {loading ? <><span className="spinner" /> Checking…</> : "🔐 Verify PIN"}
          </button>
        </form>

        {result && (
          <div style={{
            marginTop: 16,
            padding: 14,
            borderRadius: 10,
            background: result.ok ? "#f0fdf4" : "#fef2f2",
            border: `2px solid ${result.ok ? "#16a34a" : "#dc2626"}`,
            fontSize: 14,
            color: result.ok ? "#15803d" : "#b91c1c",
            fontWeight: 600,
          }}>
            {result.message}
            {result.ok && result.reportedBy && (
              <div style={{ fontSize: 12, color: "#57534e", fontWeight: 400, marginTop: 6 }}>
                Report filed by: {result.reportedBy}
              </div>
            )}
          </div>
        )}

        {result?.ok && !handoverDone && (
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <div>
              <label className="input-label">Your name (operator)</label>
              <input className="input" value={operatorName} onChange={e => setOperatorName(e.target.value)} placeholder="Desk operator name" />
            </div>
            <button
              className="btn btn-primary"
              style={{ background: "#16a34a", borderColor: "#16a34a" }}
              onClick={handleLogHandover}
              disabled={!operatorName}
            >
              ✅ Confirm Release & Log Handover
            </button>
          </div>
        )}
      </div>

      {/* Recent handover log */}
      {recentLogs.length > 0 && (
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
