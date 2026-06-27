import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import MapView, { type MapMarker } from "../components/MapView";
import ChatAgent from "../components/ChatAgent";
import LanguageSelector from "../components/LanguageSelector";
import NearbyDesks from "../components/NearbyDesks";
import { getUserLocation, getNearestCenters, type UserLocation, type NearbyCenter } from "../services/location";
import { sendSMS, buildCaseRegisteredSMS, buildSOSAlertSMS } from "../services/sms";
import { registry } from "../core/backends/registry";
import { useOnline } from "../hooks/useOnline";
import type { AgentResult } from "../core/agent";
import type { ReunionPoint } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Screens
type Screen = "landing" | "language" | "i-am-lost" | "report-missing" | "chat" | "result";
type FlowType = "i-am-lost" | "report-missing";

// ─────────────────────────────────────────────────────────────────────────────
export default function PublicApp() {
  const navigate = useNavigate();
  const isOnline = useOnline();

  // ── State ──────────────────────────────────────────────────────────────────
  const [screen, setScreen] = useState<Screen>("landing");
  const [flowType, setFlowType] = useState<FlowType>("report-missing");
  const [lang, setLang] = useState("mr"); // Default Marathi
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [nearbyDesks, setNearbyDesks] = useState<NearbyCenter[]>([]);
  const [locationLoading, setLocationLoading] = useState(false);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [contactNumber, setContactNumber] = useState("");
  const [agentResult, setAgentResult] = useState<AgentResult | null>(null);
  const [reunionPoint, setReunionPoint] = useState<ReunionPoint | null>(null);
  const [refNumber, setRefNumber] = useState<string | null>(null);
  const [sosLoading, setSosLoading] = useState(false);
  const [sosSent, setSosSent] = useState(false);
  const [markers, setMarkers] = useState<MapMarker[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const stats = registry.getStats();

  // ── Fetch location on mount ────────────────────────────────────────────────
  useEffect(() => {
    setLocationLoading(true);
    getUserLocation().then((loc) => {
      setUserLocation(loc);
      setNearbyDesks(getNearestCenters(loc, 5));
      setLocationLoading(false);
    });
  }, []);

  // ── Build map markers from help centers ────────────────────────────────────
  useEffect(() => {
    const centers = registry.getHelpCenters();
    const ms: MapMarker[] = centers.map((c) => ({
      type: "center",
      lat: c.location.lat,
      lng: c.location.lng,
      label: c.name,
      detail: `${c.languages.join(", ")} · Load: ${c.currentLoad}/${c.capacity}`,
    }));
    const police = registry.getPoliceStations();
    police.forEach((ps) => {
      ms.push({
        type: "police",
        lat: ps.location.lat,
        lng: ps.location.lng,
        label: ps.name,
      });
    });
    setMarkers(ms);
  }, []);

  // ── Photo upload ───────────────────────────────────────────────────────────
  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoPreview(URL.createObjectURL(file));
    const reader = new FileReader();
    reader.onload = (ev) => {
      const data = (ev.target?.result as string).split(",")[1]; // strip data:...;base64,
      setPhotoBase64(data);
    };
    reader.readAsDataURL(file);
  }

  // ── SOS handler ────────────────────────────────────────────────────────────
  async function handleSOS() {
    if (sosLoading || sosSent) return;
    setSosLoading(true);

    const loc = userLocation ?? (await getUserLocation());
    const desks = getNearestCenters(loc, 1);
    const nearest = desks[0];
    const refId = `SOS-${Date.now().toString().slice(-5)}`;

    if (contactNumber && nearest) {
      await sendSMS({
        to: contactNumber,
        message: buildSOSAlertSMS(
          "Pilgrim needs help",
          nearest.name,
          refId,
          loc.lat,
          loc.lng
        ),
        type: "sos_alert",
      });
    }

    setSosLoading(false);
    setSosSent(true);
    setRefNumber(refId);

    // Show brief confirmation then go to chat
    setTimeout(() => {
      setFlowType("i-am-lost");
      setScreen("chat");
    }, 2500);
  }

  // ── Agent result handler ───────────────────────────────────────────────────
  async function handleAgentResult(result: AgentResult) {
    setAgentResult(result);

    // Extract reunion point from tool calls
    const rpCall = result.toolCallsMade.find((t) => t.name === "get_reunion_point");
    if (rpCall) {
      const output = rpCall.output as Record<string, unknown>;
      if (output.reunionPointId) {
        const rp = registry.getReunionPoints().find((r) => r.id === output.reunionPointId);
        setReunionPoint(rp ?? null);
      }
    }

    // Extract reference number
    const regCall = result.toolCallsMade.find(
      (t) => t.name === "register_missing_person" || t.name === "register_found_person"
    );
    if (regCall) {
      const output = regCall.output as Record<string, unknown>;
      const ref = (output.referenceId ?? output.recordId) as string | undefined;
      if (ref) {
        setRefNumber(ref);

        // Send SMS if we have a contact number
        if (contactNumber) {
          const nearest = nearbyDesks[0];
          await sendSMS({
            to: contactNumber,
            message: buildCaseRegisteredSMS(ref, nearest?.name ?? "nearest center"),
            type: "case_registered",
          });
        }
      }
    }

    setScreen("result");
  }

  // ── Build initial prompt based on flow ────────────────────────────────────
  function buildInitialPrompt(): string {
    if (flowType === "i-am-lost") {
      const locStr = userLocation
        ? `My current GPS location is ${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}.`
        : "";
      return `I am lost and need help. ${locStr} Please help me get back to my family. I speak ${getLangName(lang)}.`;
    }
    return ""; // Family flow: user types themselves
  }

  function getLangName(code: string): string {
    const names: Record<string, string> = {
      mr: "Marathi", hi: "Hindi", en: "English", gu: "Gujarati",
      bn: "Bengali", te: "Telugu", ta: "Tamil", pa: "Punjabi",
      kn: "Kannada", bh: "Bhojpuri", mai: "Maithili",
    };
    return names[code] ?? code;
  }

  // ── Screens ────────────────────────────────────────────────────────────────

  // LANDING
  if (screen === "landing") {
    return (
      <div className="page" style={{ background: "linear-gradient(180deg, #fff8f4 0%, #faf9f7 100%)" }}>
        {!isOnline && (
          <div className="offline-banner">
            ⚠️ You are offline — reports will be saved and sent when connectivity returns
          </div>
        )}

        {/* Header */}
        <div className="page-header" style={{ justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#f97316" }}>🕉 Kumbh Mela 2027</div>
            <div style={{ fontSize: 11, color: "#78716c" }}>Lost & Found · Reunification</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <LanguageSelector value={lang} onChange={setLang} compact />
            <button
              onClick={() => navigate("/volunteer")}
              style={{ fontSize: 11, color: "#78716c", padding: "4px 8px", border: "1px solid #e7e5e4", borderRadius: 6 }}
            >
              Volunteer →
            </button>
          </div>
        </div>

        {/* Map */}
        <div style={{ position: "relative" }}>
          <MapView
            userLocation={userLocation}
            markers={markers}
            height={260}
            zoom={13}
          />
          {locationLoading && (
            <div style={{
              position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)",
              background: "white", borderRadius: 20, padding: "4px 12px",
              fontSize: 12, boxShadow: "0 2px 8px rgba(0,0,0,.15)",
            }}>
              📍 Getting your location…
            </div>
          )}
        </div>

        <div className="page-body">
          {/* Stats */}
          <div className="stats-row" style={{ marginTop: 16 }}>
            <div className="stat-box">
              <div className="stat-value">{stats.foundPersonsWaiting}</div>
              <div className="stat-label">Found today</div>
            </div>
            <div className="stat-box">
              <div className="stat-value">{stats.reunionsCompleted}</div>
              <div className="stat-label">Reunited</div>
            </div>
            <div className="stat-box">
              <div className="stat-value">{registry.getHelpCenters().length}</div>
              <div className="stat-label">Help centers</div>
            </div>
          </div>

          {/* SOS Button */}
          <div
            style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              padding: "24px 0 16px", gap: 8,
            }}
          >
            {sosSent ? (
              <div className="result-box" style={{ textAlign: "center", padding: "16px 24px" }}>
                <div style={{ fontSize: 28 }}>✅</div>
                <div style={{ fontWeight: 700, color: "#16a34a", marginTop: 8 }}>SOS Sent!</div>
                <div style={{ fontSize: 13, color: "#57534e", marginTop: 4 }}>
                  Nearest center alerted · Ref: <strong>{refNumber}</strong>
                </div>
              </div>
            ) : (
              <button
                onClick={handleSOS}
                disabled={sosLoading}
                className="sos-btn"
                aria-label="SOS — I need help"
                style={{ width: 96, height: 96, fontSize: 13 }}
              >
                {sosLoading ? <span className="spinner" /> : "🆘 SOS"}
              </button>
            )}
            <p style={{ fontSize: 12, color: "#78716c", textAlign: "center" }}>
              {sosSent ? "Going to chat…" : "Press for immediate help"}
            </p>
          </div>

          <div className="divider" />

          {/* Main action buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <button
              onClick={() => {
                setFlowType("report-missing");
                setScreen("report-missing");
              }}
              className="btn btn-primary btn-full btn-lg"
            >
              <span style={{ fontSize: 22 }}>🔍</span>
              <div style={{ textAlign: "left" }}>
                <div>I'm looking for someone</div>
                <div style={{ fontSize: 12, fontWeight: 400, opacity: .85 }}>
                  मैं किसी को ढूंढ रहा हूँ
                </div>
              </div>
            </button>

            <button
              onClick={() => {
                setFlowType("i-am-lost");
                setScreen("i-am-lost");
              }}
              className="btn btn-ghost btn-full btn-lg"
              style={{ border: "2px solid #f97316", color: "#f97316" }}
            >
              <span style={{ fontSize: 22 }}>🙋</span>
              <div style={{ textAlign: "left" }}>
                <div>I am lost</div>
                <div style={{ fontSize: 12, fontWeight: 400, opacity: .85 }}>
                  मैं खो गया हूँ / मी हरवलो आहे
                </div>
              </div>
            </button>
          </div>

          {/* Nearby desks */}
          <div className="card" style={{ marginTop: 20 }}>
            <div className="card-title">📍 Nearest Help Centers</div>
            <NearbyDesks centers={nearbyDesks.slice(0, 3)} />
          </div>
        </div>
      </div>
    );
  }

  // I AM LOST — collect phone + confirm language before chat
  if (screen === "i-am-lost") {
    return (
      <div className="page">
        <div className="page-header">
          <button onClick={() => setScreen("landing")} style={{ fontSize: 20, background: "none" }}>←</button>
          <div>
            <div style={{ fontWeight: 700 }}>I Am Lost / मैं खो गया हूँ</div>
            <div style={{ fontSize: 11, color: "#78716c" }}>We will find your family</div>
          </div>
          <LanguageSelector value={lang} onChange={setLang} compact />
        </div>

        <div className="page-body">
          <div className="card">
            <p style={{ fontSize: 14, color: "#57534e", marginBottom: 16, lineHeight: 1.6 }}>
              Don't worry. Tell us about yourself and we will find your family or bring you to the nearest help center.
            </p>

            <div className="form-row">
              <label className="input-label">📱 Your mobile number (optional)</label>
              <input
                type="tel"
                value={contactNumber}
                onChange={(e) => setContactNumber(e.target.value)}
                placeholder="+91 XXXXXXXXXX"
                className="input"
              />
              <p style={{ fontSize: 11, color: "#a8a29e", marginTop: 4 }}>
                We'll send you updates and help you reconnect
              </p>
            </div>

            {userLocation && (
              <div className="badge badge-green" style={{ marginBottom: 12, display: "inline-flex" }}>
                📍 Location captured ({userLocation.source})
              </div>
            )}

            <LanguageSelector value={lang} onChange={setLang} />

            <button
              onClick={() => setScreen("chat")}
              className="btn btn-primary btn-full mt-16"
            >
              Start → Tell us about yourself
            </button>
          </div>

          {nearbyDesks.length > 0 && (
            <div className="card" style={{ marginTop: 12 }}>
              <div className="card-title">🏥 Nearest center</div>
              <div className="desk-item" style={{ marginBottom: 0 }}>
                <div className="desk-icon">🏥</div>
                <div>
                  <div className="desk-name">{nearbyDesks[0].name}</div>
                  <div className="desk-meta">🚶 {nearbyDesks[0].walkingMinutes} min walk</div>
                  <a href={`tel:${nearbyDesks[0].contactNumber}`} style={{ fontSize: 13, color: "#2563eb" }}>
                    📞 {nearbyDesks[0].contactNumber}
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // REPORT MISSING — collect info before chat
  if (screen === "report-missing") {
    return (
      <div className="page">
        <div className="page-header">
          <button onClick={() => setScreen("landing")} style={{ fontSize: 20, background: "none" }}>←</button>
          <div>
            <div style={{ fontWeight: 700 }}>Report Missing Person</div>
            <div style={{ fontSize: 11, color: "#78716c" }}>गुमशुदा व्यक्ति की रिपोर्ट</div>
          </div>
          <LanguageSelector value={lang} onChange={setLang} compact />
        </div>

        <div className="page-body">
          <div className="card">
            <div className="form-row">
              <label className="input-label">📱 Your mobile number</label>
              <input
                type="tel"
                value={contactNumber}
                onChange={(e) => setContactNumber(e.target.value)}
                placeholder="+91 XXXXXXXXXX"
                className="input"
              />
            </div>

            <div className="form-row">
              <label className="input-label">📷 Photo of missing person (optional but helps)</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoChange}
                style={{ display: "none" }}
              />
              {photoPreview ? (
                <div style={{ position: "relative" }}>
                  <img src={photoPreview} alt="Preview" className="photo-preview" />
                  <button
                    onClick={() => { setPhotoBase64(null); setPhotoPreview(null); }}
                    style={{
                      position: "absolute", top: 8, right: 8,
                      background: "#dc2626", color: "white",
                      border: "none", borderRadius: "50%",
                      width: 28, height: 28, fontSize: 14,
                      cursor: "pointer",
                    }}
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <div className="photo-upload-box" onClick={() => fileInputRef.current?.click()}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>📷</div>
                  <p style={{ fontSize: 13 }}>Tap to upload or take photo</p>
                  <p style={{ fontSize: 11, color: "#a8a29e", marginTop: 4 }}>
                    Photo helps find them 3× faster
                  </p>
                </div>
              )}
            </div>

            <LanguageSelector value={lang} onChange={setLang} />

            <button
              onClick={() => setScreen("chat")}
              className="btn btn-primary btn-full mt-16"
            >
              Start → Describe the missing person
            </button>
          </div>
        </div>
      </div>
    );
  }

  // CHAT — Claude agent
  if (screen === "chat") {
    const initial = buildInitialPrompt();
    return (
      <div className="page">
        <div className="page-header">
          <button onClick={() => setScreen(flowType === "i-am-lost" ? "i-am-lost" : "report-missing")} style={{ fontSize: 20, background: "none" }}>←</button>
          <div>
            <div style={{ fontWeight: 700 }}>
              {flowType === "i-am-lost" ? "🙋 I Am Lost" : "🔍 Find My Family Member"}
            </div>
            <div style={{ fontSize: 11, color: "#78716c" }}>Claude is searching all 10 centers</div>
          </div>
          <LanguageSelector value={lang} onChange={setLang} compact />
        </div>

        <ChatAgent
          langCode={lang}
          initialPrompt={flowType === "i-am-lost" ? initial : undefined}
          photoBase64={photoBase64}
          onResult={handleAgentResult}
          placeholder={
            flowType === "i-am-lost"
              ? "Tell us: your name, where you came from, what you're wearing…"
              : "Describe the missing person: name, age, clothing, last seen where…"
          }
          showVoice
        />
      </div>
    );
  }

  // RESULT
  if (screen === "result") {
    const hasMatch = agentResult?.toolCallsMade.some((t) => t.name === "get_reunion_point");

    return (
      <div className="page">
        <div className="page-header">
          <button onClick={() => setScreen("landing")} style={{ fontSize: 20, background: "none" }}>←</button>
          <div style={{ fontWeight: 700 }}>
            {hasMatch ? "✅ Match Found!" : "📋 Report Registered"}
          </div>
        </div>

        <div className="page-body">
          {/* Reunion map */}
          <MapView
            userLocation={userLocation}
            markers={markers}
            reunionPoint={reunionPoint}
            height={220}
          />

          {/* Reference number */}
          {refNumber && (
            <div className="result-box" style={{ marginTop: 16 }}>
              <h2>{hasMatch ? "🎉 Match Found!" : "📋 Case Registered"}</h2>
              <p style={{ fontSize: 13, color: "#57534e", marginBottom: 8 }}>Your reference number:</p>
              <div className="ref-number">{refNumber}</div>
              {contactNumber && (
                <p style={{ fontSize: 12, color: "#57534e" }}>
                  ✅ SMS sent to {contactNumber}
                </p>
              )}
            </div>
          )}

          {/* Claude's response */}
          {agentResult?.finalText && (
            <div className="card" style={{ marginTop: 12 }}>
              <div className="card-title">📢 Instructions</div>
              <p style={{ fontSize: 14, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                {agentResult.finalText}
              </p>
            </div>
          )}

          {/* Reunion point details */}
          {reunionPoint && (
            <div className="card" style={{ marginTop: 12, borderColor: "#16a34a", borderWidth: 2 }}>
              <div className="card-title" style={{ color: "#16a34a" }}>⭐ {reunionPoint.name}</div>
              <p style={{ fontSize: 14, color: "#57534e" }}>{reunionPoint.landmark}</p>
              {reunionPoint.landmark_mr && (
                <p style={{ fontSize: 14, color: "#57534e", marginTop: 4 }}>{reunionPoint.landmark_mr}</p>
              )}
              <p style={{ fontSize: 12, color: "#a8a29e", marginTop: 8 }}>
                Volunteer: {reunionPoint.volunteerAssigned}
              </p>
            </div>
          )}

          {/* Nearby desks */}
          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-title">🏥 Nearest Help Centers</div>
            <NearbyDesks centers={nearbyDesks.slice(0, 3)} />
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button
              onClick={() => {
                setScreen("chat");
                setAgentResult(null);
                setReunionPoint(null);
              }}
              className="btn btn-ghost flex-1"
            >
              ← Chat again
            </button>
            <button onClick={() => setScreen("landing")} className="btn btn-primary flex-1">
              🏠 Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
