import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import MapView, { type MapMarker } from "../components/MapView";
import ChatAgent from "../components/ChatAgent";
import VolunteerQuickForm from "../components/VolunteerQuickForm";
import NearbyDesks from "../components/NearbyDesks";
import { getUserLocation, getNearestCenters, type UserLocation, type NearbyCenter } from "../services/location";
import { sendSMS, buildFoundPersonRegisteredSMS, buildMatchFoundSMS } from "../services/sms";
import { notifyBackend } from "../core/backends/notify";
import { registry } from "../core/backends/registry";
import { registerVolunteer, removeVolunteer } from "../services/volunteers";
import { useOnline } from "../hooks/useOnline";
import type { AgentResult } from "../core/agent";
import type { Notification } from "../types";

// ───────────────────────────────────────────────────────���─────────────────────
type Tab = "dashboard" | "help-report" | "found-person" | "notifications";
type HelpMode = "help-family" | "help-person"; // who the volunteer is helping

// ── Dummy auth ────────────────────────────────────────────────────────────────
const VOLUNTEER_CREDS = { username: "volunteer", password: "kumbh2027" };

function VolunteerLogin({ onLogin }: { onLogin: () => void }) {
  const navigate = useNavigate();
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      if (u === VOLUNTEER_CREDS.username && p === VOLUNTEER_CREDS.password) {
        onLogin();
      } else {
        setError("Invalid credentials. Try volunteer / kumbh2027");
      }
      setLoading(false);
    }, 600);
  }

  return (
    <div className="page" style={{ background: "#f0fdf4", minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <div style={{ maxWidth: 360, margin: "0 auto", padding: "0 20px", width: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 48 }}>🙋</div>
          <h1 style={{ fontWeight: 700, fontSize: 22, color: "#15803d", marginTop: 8 }}>Volunteer Login</h1>
          <p style={{ fontSize: 13, color: "#57534e", marginTop: 4 }}>Kumbh Mela 2027 — Lost & Found</p>
        </div>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label className="input-label">Username</label>
            <input className="input" value={u} onChange={e => setU(e.target.value)} placeholder="volunteer" autoComplete="username" />
          </div>
          <div>
            <label className="input-label">Password</label>
            <input className="input" type="password" value={p} onChange={e => setP(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
          </div>
          {error && <p style={{ fontSize: 13, color: "#dc2626", textAlign: "center" }}>{error}</p>}
          <button type="submit" className="btn btn-primary btn-full" disabled={loading} style={{ background: "#16a34a", borderColor: "#16a34a" }}>
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

export default function VolunteerPanel() {
  const navigate = useNavigate();
  const isOnline = useOnline();

  const [loggedIn, setLoggedIn] = useState(false);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [helpMode, setHelpMode] = useState<HelpMode>("help-family");
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [nearbyDesks, setNearbyDesks] = useState<NearbyCenter[]>([]);
  const [markers, setMarkers] = useState<MapMarker[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [centerId, setCenterId] = useState("CENTER-RAMKUND");
  const [contactNumber, setContactNumber] = useState("");
  const [agentResult, setAgentResult] = useState<AgentResult | null>(null);
  const [refNumber, setRefNumber] = useState<string | null>(null);
  const [locationShared, setLocationShared] = useState(false);
  const notifIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const volId = useRef(`VOL-${Math.random().toString(36).slice(2, 8).toUpperCase()}`);

  const stats = registry.getStats();
  const centers = registry.getHelpCenters();

  // ── Init ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    getUserLocation().then((loc) => {
      setUserLocation(loc);
      setNearbyDesks(getNearestCenters(loc, 5));

      // Register this volunteer's location so the public app can show them
      if (loc.source !== "default") {
        const center = registry.getCenterById(centerId);
        registerVolunteer({
          id: volId.current,
          name: "Volunteer",
          centerId,
          centerName: center?.name ?? "Unknown Center",
          lat: loc.lat,
          lng: loc.lng,
          lastSeen: Date.now(),
        });
        setLocationShared(true);
      }

      // Build markers
      const ms: MapMarker[] = registry.getHelpCenters().map((c) => ({
        type: "center" as const,
        lat: c.location.lat,
        lng: c.location.lng,
        label: c.name,
        detail: `Load: ${c.currentLoad}/${c.capacity}`,
      }));
      registry.getPoliceStations().forEach((ps) => {
        ms.push({ type: "police", lat: ps.location.lat, lng: ps.location.lng, label: ps.name });
      });
      // Waiting found persons
      registry.getAllFoundPersons().forEach((fp) => {
        const center = registry.getCenterById(fp.centerId);
        if (center) {
          ms.push({
            type: "found",
            lat: center.location.lat,
            lng: center.location.lng,
            label: `Found: ${fp.clothing.slice(0, 30)}…`,
            detail: fp.centerName,
          });
        }
      });
      setMarkers(ms);
    });

    // Poll notifications every 5s
    setNotifications(notifyBackend.getAll());
    notifIntervalRef.current = setInterval(() => {
      setNotifications(notifyBackend.getAll());
    }, 5000);

    return () => {
      if (notifIntervalRef.current) clearInterval(notifIntervalRef.current);
      removeVolunteer(volId.current);
    };
  }, []);

  // ── Agent result ───────────────────────────────────────────────────────────
  async function handleAgentResult(result: AgentResult) {
    setAgentResult(result);

    // Extract reference numbers and send SMS
    for (const tc of result.toolCallsMade) {
      const out = tc.output as Record<string, unknown>;

      if (tc.name === "register_found_person" && out.recordId) {
        const recordId = out.recordId as string;
        setRefNumber(recordId);

        // SMS to the person if they have a phone
        if (contactNumber) {
          const center = registry.getCenterById(centerId);
          await sendSMS({
            to: contactNumber,
            message: buildFoundPersonRegisteredSMS(recordId, center?.name ?? centerId),
            type: "case_registered",
          });
        }
      }

      if (tc.name === "register_missing_person" && out.referenceId) {
        setRefNumber(out.referenceId as string);
        if (contactNumber) {
          await sendSMS({
            to: contactNumber,
            message: `Kumbh Mela: Missing report ${out.referenceId} registered. You will be notified when a match is found.`,
            type: "case_registered",
          });
        }
      }

      if (tc.name === "get_reunion_point" && out.reunionPointId) {
        const rp = registry.getReunionPoints().find((r) => r.id === out.reunionPointId);
        if (rp && contactNumber) {
          const matchCall = result.toolCallsMade.find((t) => t.name === "search_found_persons");
          const matchDesc = (matchCall?.output as Record<string, unknown>)?.matches
            ? ((matchCall?.output as Record<string, unknown>)?.matches as Record<string, unknown>[])[0]?.clothing as string ?? "the found person"
            : "the found person";

          await sendSMS({
            to: contactNumber,
            message: buildMatchFoundSMS(
              refNumber ?? "UNKNOWN",
              matchDesc,
              rp.name,
              rp.landmark
            ),
            type: "match_found",
          });
        }
      }
    }
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!loggedIn) return <VolunteerLogin onLogin={() => setLoggedIn(true)} />;

  return (
    <div className="page">
      {!isOnline && (
        <div className="offline-banner">⚠️ Offline — operations queued</div>
      )}

      {/* Header */}
      <div className="panel-header">
        <div>
          <h1>🙋 Volunteer Panel</h1>
          <p style={{ fontSize: 11 }}>Kumbh Mela 2027 · Lost & Found</p>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          <button
            onClick={() => navigate("/")}
            style={{
              fontSize: 11, color: "rgba(255,255,255,.8)",
              background: "rgba(255,255,255,.15)",
              padding: "4px 8px", borderRadius: 6, border: "none", whiteSpace: "nowrap",
            }}
          >
            ← App
          </button>
          <button
            onClick={() => navigate("/help-desk")}
            style={{
              fontSize: 11, color: "rgba(255,255,255,.8)",
              background: "rgba(255,255,255,.15)",
              padding: "4px 8px", borderRadius: 6, border: "none", whiteSpace: "nowrap",
            }}
          >
            Desk ↗
          </button>
        </div>
      </div>

      {/* Tabs — scrollable on narrow screens */}
      <div className="tab-nav" style={{ overflowX: "auto", flexWrap: "nowrap" }}>
        {(["dashboard", "help-report", "found-person", "notifications"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`tab-btn${tab === t ? " active" : ""}`}
            style={{ whiteSpace: "nowrap" }}
          >
            {t === "dashboard" && "📊 Dashboard"}
            {t === "help-report" && "📝 Help Report"}
            {t === "found-person" && "👤 Found Person"}
            {t === "notifications" && (
              <>
                🔔 Alerts{unreadCount > 0 && (
                  <span style={{
                    background: "#dc2626", color: "white",
                    borderRadius: 10, padding: "1px 6px",
                    fontSize: 10, marginLeft: 4,
                  }}>
                    {unreadCount}
                  </span>
                )}
              </>
            )}
          </button>
        ))}
      </div>

      {/* DASHBOARD */}
      {tab === "dashboard" && (
        <div style={{ flex: 1, overflow: "auto" }}>
          <div className="two-panel">
            {/* Left: stats + desks */}
            <div className="two-panel__left" style={{ padding: 16 }}>
              <div className="stats-row">
                <div className="stat-box">
                  <div className="stat-value">{stats.foundPersonsWaiting}</div>
                  <div className="stat-label">Waiting</div>
                </div>
                <div className="stat-box">
                  <div className="stat-value">{stats.activeSearches}</div>
                  <div className="stat-label">Searching</div>
                </div>
                <div className="stat-box">
                  <div className="stat-value">{stats.reunionsCompleted}</div>
                  <div className="stat-label">Reunited</div>
                </div>
              </div>

              {/* Duplicate reports alert */}
              {stats.duplicateReportsCaught > 0 && (
                <div className="card" style={{ background: "#fff8f4", borderColor: "#f97316", marginBottom: 12 }}>
                  <div style={{ fontWeight: 700, color: "#f97316", fontSize: 14 }}>
                    ⚠️ {stats.duplicateReportsCaught} duplicate report(s) detected
                  </div>
                  <p style={{ fontSize: 12, color: "#57534e", marginTop: 4 }}>
                    Same person reported at multiple centers. Reports are linked.
                  </p>
                </div>
              )}

              {/* My center */}
              <div className="form-row">
                <label className="input-label">My current center</label>
                <select
                  value={centerId}
                  onChange={(e) => setCenterId(e.target.value)}
                  className="input"
                >
                  {centers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {/* Location */}
              {userLocation && (
                <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                  <div className="badge badge-blue">
                    📍 {userLocation.lat.toFixed(4)}, {userLocation.lng.toFixed(4)} ({userLocation.source})
                  </div>
                  {locationShared
                    ? <div className="badge badge-green">📡 Location shared with public app</div>
                    : <div className="badge" style={{ background: "#fef9c3", color: "#854d0e" }}>⚠️ Default location — GPS not active</div>
                  }
                </div>
              )}

              <div className="card-title" style={{ marginTop: 8 }}>Nearby Centers</div>
              <NearbyDesks centers={nearbyDesks.slice(0, 4)} />

              {/* Active found persons */}
              <div className="card-title" style={{ marginTop: 16 }}>Currently Waiting at Centers</div>
              {registry.getAllFoundPersons().slice(0, 4).map((fp) => (
                <div key={fp.id} className="notif-item">
                  <div className="notif-dot" />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{fp.id} · {fp.ageRange} {fp.gender}</div>
                    <div style={{ fontSize: 12, color: "#57534e" }}>{fp.clothing}</div>
                    <div style={{ fontSize: 11, color: "#a8a29e" }}>{fp.centerName}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Right: Map */}
            <div className="two-panel__right">
              <MapView
                userLocation={userLocation}
                markers={markers}
                showSatellite={false}
                height="100%"
                zoom={13}
              />
            </div>
          </div>
        </div>
      )}

      {/* HELP REPORT — Volunteer assists a family OR a lost person */}
      {tab === "help-report" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {/* Mode toggle */}
          <div style={{ padding: "12px 16px", background: "white", borderBottom: "1px solid #e7e5e4", display: "flex", gap: 8 }}>
            <button
              onClick={() => setHelpMode("help-family")}
              className={`btn btn-sm ${helpMode === "help-family" ? "btn-primary" : "btn-ghost"}`}
            >
              👨‍👩‍👧 Family is reporting
            </button>
            <button
              onClick={() => setHelpMode("help-person")}
              className={`btn btn-sm ${helpMode === "help-person" ? "btn-primary" : "btn-ghost"}`}
            >
              🙋 Person is lost
            </button>
          </div>

          {/* Contact number */}
          <div style={{ padding: "12px 16px", background: "#fafaf9", borderBottom: "1px solid #e7e5e4" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="tel"
                value={contactNumber}
                onChange={(e) => setContactNumber(e.target.value)}
                placeholder="Reporter's mobile (for SMS)"
                className="input"
                style={{ flex: 1 }}
              />
              <select
                value={centerId}
                onChange={(e) => setCenterId(e.target.value)}
                className="input"
                style={{ flex: 1 }}
              >
                {centers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name.replace(" Kho-Ya-Paya Kendra", "").replace(" Control Room", "").replace(" Center", "")}</option>
                ))}
              </select>
            </div>

            {refNumber && (
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                <span className="badge badge-green">✅ Registered: {refNumber}</span>
                {contactNumber && <span className="badge badge-blue">📱 SMS sent</span>}
              </div>
            )}
          </div>

          <VolunteerQuickForm
            mode={helpMode === "help-family" ? "help-family" : "help-person"}
            centerId={centerId}
            onSubmitted={(r) => setRefNumber(r.refId)}
          />
        </div>
      )}

      {/* FOUND PERSON — Volunteer registers an unaccompanied person */}
      {tab === "found-person" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "12px 16px", background: "#fafaf9", borderBottom: "1px solid #e7e5e4" }}>
            <p style={{ fontSize: 13, color: "#57534e" }}>
              Use this tab when an unaccompanied/confused person arrives at your center. Claude will register them and automatically search for a matching missing person report.
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <input
                type="tel"
                value={contactNumber}
                onChange={(e) => setContactNumber(e.target.value)}
                placeholder="Person's mobile (if they have one)"
                className="input"
                style={{ flex: 1 }}
              />
              <select
                value={centerId}
                onChange={(e) => setCenterId(e.target.value)}
                className="input"
                style={{ flex: 1 }}
              >
                {centers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name.replace(" Kho-Ya-Paya Kendra", "").replace(" Control Room", "").replace(" Center", "")}</option>
                ))}
              </select>
            </div>

            {refNumber && (
              <div style={{ marginTop: 8 }}>
                <span className="badge badge-green">✅ Registered: {refNumber}</span>
              </div>
            )}
          </div>

          <VolunteerQuickForm
            mode="found-person"
            centerId={centerId}
            onSubmitted={(r) => setRefNumber(r.refId)}
          />
        </div>
      )}

      {/* NOTIFICATIONS */}
      {tab === "notifications" && (
        <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
          {notifications.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#a8a29e" }}>
              <div style={{ fontSize: 40 }}>🔔</div>
              <p style={{ marginTop: 12 }}>No notifications yet</p>
            </div>
          ) : (
            [...notifications].reverse().map((n) => (
              <div
                key={n.id}
                className="notif-item"
                onClick={() => notifyBackend.markRead(n.id)}
                style={{ cursor: "pointer", opacity: n.read ? .6 : 1 }}
              >
                <div className={`notif-dot ${n.urgency}`} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{n.centerName}</div>
                  <div style={{ fontSize: 13, color: "#1c1917", marginTop: 2 }}>{n.message}</div>
                  <div style={{ fontSize: 11, color: "#a8a29e", marginTop: 4 }}>
                    {new Date(n.sentAt).toLocaleTimeString()}
                  </div>
                </div>
                {!n.read && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#f97316", flexShrink: 0, marginTop: 6 }} />}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
