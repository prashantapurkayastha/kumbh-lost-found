import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import MapView, { type MapMarker } from "../components/MapView";
import ChatAgent from "../components/ChatAgent";
import { getUserLocation, type UserLocation } from "../services/location";
import { sendSMS } from "../services/sms";
import { notifyBackend } from "../core/backends/notify";
import { registry } from "../core/backends/registry";
import { useOnline } from "../hooks/useOnline";
import type { AgentResult } from "../core/agent";
import type { Notification } from "../types";

// ────────────────────────��────────────────────────────────────────────────────
// Help Desk Panel
// Fixed-location admin interface for help desk staff (not volunteer, not family)
// Covers flows 3 (family at desk) and 6 (missing person at desk)
// ─────────────────────────────────────────────────────────────────────────────

type Tab = "queue" | "register-found" | "search" | "notifications";
type Scenario = "family-reports" | "person-self-reports";

export default function HelpDeskPanel() {
  const navigate = useNavigate();
  const isOnline = useOnline();

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
      <div className="tab-nav">
        {(["queue", "register-found", "search", "notifications"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`tab-btn${tab === t ? " active" : ""}`}>
            {t === "queue" && "📋 Queue"}
            {t === "register-found" && "👤 Register"}
            {t === "search" && "🔍 Search"}
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
              {allFound.slice(0, 6).map((fp) => (
                <div key={fp.id} className="notif-item">
                  <div className="notif-dot" style={{ background: fp.condition === "distressed" ? "#dc2626" : "#16a34a" }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{fp.id}</span>
                      <span className={`badge ${fp.condition === "distressed" ? "badge-red" : "badge-green"}`}>{fp.condition}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#57534e" }}>{fp.ageRange} {fp.gender} · {fp.clothing.slice(0, 40)}</div>
                    <div style={{ fontSize: 11, color: "#a8a29e" }}>{fp.centerName} · {fp.languageSpoken}</div>
                  </div>
                </div>
              ))}

              <div className="card-title" style={{ marginTop: 16 }}>🔍 Active Missing Reports</div>
              {allMissing.filter((r) => !r.is_duplicate_report).slice(0, 5).map((mr) => (
                <div key={mr.id} className="notif-item">
                  <div className="notif-dot" style={{ background: "#d97706" }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{mr.id}</span>
                      {mr.is_duplicate_report && <span className="badge badge-amber">Duplicate</span>}
                    </div>
                    <div style={{ fontSize: 12, color: "#57534e" }}>
                      {mr.missingPerson.name ?? "Unknown"} · {mr.missingPerson.ageRange} · {mr.missingPerson.clothing.slice(0, 35)}
                    </div>
                    <div style={{ fontSize: 11, color: "#a8a29e" }}>{mr.reportingCenter}</div>
                  </div>
                </div>
              ))}
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
    </div>
  );
}
