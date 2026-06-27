import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import MapView, { type MapMarker } from "../components/MapView";
import ChatAgent from "../components/ChatAgent";
import NearbyDesks from "../components/NearbyDesks";
import { getUserLocation, getNearestCenters, type UserLocation, type NearbyCenter } from "../services/location";
import { sendSMS, buildFoundPersonRegisteredSMS, buildMatchFoundSMS } from "../services/sms";
import { notifyBackend } from "../core/backends/notify";
import { registry } from "../core/backends/registry";
import { useOnline } from "../hooks/useOnline";
import type { AgentResult } from "../core/agent";
import type { Notification } from "../types";

// ───────────────────────────────────────────────────────���─────────────────────
type Tab = "dashboard" | "help-report" | "found-person" | "notifications";
type HelpMode = "help-family" | "help-person"; // who the volunteer is helping

export default function VolunteerPanel() {
  const navigate = useNavigate();
  const isOnline = useOnline();

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
  const notifIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stats = registry.getStats();
  const centers = registry.getHelpCenters();

  // ── Init ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    getUserLocation().then((loc) => {
      setUserLocation(loc);
      setNearbyDesks(getNearestCenters(loc, 5));

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

  return (
    <div className="page">
      {!isOnline && (
        <div className="offline-banner">⚠️ Offline — operations queued</div>
      )}

      {/* Header */}
      <div className="panel-header">
        <div>
          <h1>🙋 Volunteer Panel</h1>
          <p>Kumbh Mela 2027 · Lost & Found</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => navigate("/")}
            style={{
              fontSize: 12, color: "rgba(255,255,255,.7)",
              background: "rgba(255,255,255,.1)",
              padding: "4px 10px", borderRadius: 6, border: "none",
            }}
          >
            Public App ↗
          </button>
          <button
            onClick={() => navigate("/help-desk")}
            style={{
              fontSize: 12, color: "rgba(255,255,255,.7)",
              background: "rgba(255,255,255,.1)",
              padding: "4px 10px", borderRadius: 6, border: "none",
            }}
          >
            Help Desk ↗
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="tab-nav">
        {(["dashboard", "help-report", "found-person", "notifications"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`tab-btn${tab === t ? " active" : ""}`}
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
                <div className="badge badge-blue" style={{ marginBottom: 12 }}>
                  📍 Location: {userLocation.lat.toFixed(4)}, {userLocation.lng.toFixed(4)} ({userLocation.source})
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

          <ChatAgent
            langCode="en"
            initialPrompt={
              helpMode === "help-family"
                ? `I am a volunteer at ${registry.getCenterById(centerId)?.name ?? centerId}. A family member is here to report someone missing. Please help me take their report.`
                : `I am a volunteer at ${registry.getCenterById(centerId)?.name ?? centerId}. A person is here who appears to be lost and separated from their family. Please help me register them and find their family.`
            }
            onResult={handleAgentResult}
            placeholder={
              helpMode === "help-family"
                ? "Enter the missing person's details on behalf of the family…"
                : "Describe the lost person — what they're wearing, language, where found…"
            }
            showVoice={false}
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

          <ChatAgent
            langCode="en"
            initialPrompt={`I am a volunteer at ${registry.getCenterById(centerId)?.name ?? centerId}. An unaccompanied person has arrived at my center who appears to be lost. I need to register them and find their family. Please guide me through the process.`}
            onResult={handleAgentResult}
            placeholder="Describe the person: age, clothing, language, condition, where found…"
            showVoice={false}
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
