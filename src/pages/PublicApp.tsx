import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";
import MapView, { type MapMarker, type RouteTarget, type CctvPoint, type ChokepointData } from "../components/MapView";
import cctvData from "../data/cctv.json";
import chokepointData from "../data/chokepoints.json";
import ChatAgent from "../components/ChatAgent";
import LanguageSelector from "../components/LanguageSelector";
import NearbyDesks from "../components/NearbyDesks";
import { getUserLocation, getNearestCenters, type UserLocation, type NearbyCenter } from "../services/location";
import { sendSMS, buildCaseRegisteredSMS, buildSOSAlertSMS } from "../services/sms";
import { registry } from "../core/backends/registry";
import { useOnline } from "../hooks/useOnline";
import { t } from "../i18n/translations";
import { getActiveVolunteers, type VolunteerRecord } from "../services/volunteers";
import { registry as regBackend } from "../core/backends/registry";
import { haversineKm, walkingMinutes } from "../core/backends/geo";
import { getQueue } from "../services/offlineQueue";
import type { AgentResult } from "../core/agent";
import type { ReunionPoint, FoundPerson } from "../types";
import { RAMKUND_DEFAULT } from "../services/location";

/** Extract a human-friendly zone label from a center/zone name — hides exact desk identity */
function maskZone(centerOrZone: string): string {
  const z = centerOrZone.toLowerCase();
  if (z.includes("ramkund") || z.includes("ram kund")) return "Ramkund area";
  if (z.includes("panchavati") || z.includes("panchvati")) return "Panchavati area";
  if (z.includes("trimbak") || z.includes("kushavart")) return "Trimbakeshwar area";
  if (z.includes("sadhugram") || z.includes("sadhu")) return "Sadhugram area";
  if (z.includes("tapovan")) return "Tapovan area";
  if (z.includes("nashik road") || z.includes("railway")) return "Nashik Road area";
  if (z.includes("adgaon")) return "Adgaon area";
  if (z.includes("bharatbharati") || z.includes("central")) return "Central Nashik area";
  // Fall back to first 2 words of zone string + "area"
  const words = centerOrZone.split(/[\s-]+/).slice(0, 2).join(" ");
  return words ? `${words} area` : "Nashik area";
}

// ── Shared markdown renderer (same logic as ChatAgent) ─────────────────────
function renderInline(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i} style={{ background: "#f1f0ef", padding: "1px 4px", borderRadius: 3, fontFamily: "monospace", fontSize: "0.88em" }}>{part.slice(1, -1)}</code>;
    return <span key={i}>{part}</span>;
  });
}
function MarkdownView({ text }: { text: string }) {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]; const trimmed = line.trim();
    if (trimmed.startsWith("## ")) nodes.push(<div key={i} style={{ fontWeight: 700, fontSize: 15, color: "#1e293b", marginTop: 10, marginBottom: 2 }}>{renderInline(trimmed.slice(3))}</div>);
    else if (trimmed.startsWith("### ")) nodes.push(<div key={i} style={{ fontWeight: 700, fontSize: 13, color: "#374151", marginTop: 6 }}>{renderInline(trimmed.slice(4))}</div>);
    else if (trimmed === "---" || trimmed === "***") nodes.push(<hr key={i} style={{ border: "none", borderTop: "1px solid #e7e5e4", margin: "6px 0" }} />);
    else if (/^\|[-:\s|]+\|$/.test(trimmed)) { /* skip table sep */ }
    else if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const cells = trimmed.split("|").slice(1, -1);
      nodes.push(<div key={i} style={{ display: "flex", gap: 8, fontSize: 13, padding: "3px 0", borderBottom: "1px solid #f1f0ef" }}>{cells.map((c, j) => <div key={j} style={{ flex: 1 }}>{renderInline(c.trim())}</div>)}</div>);
    } else if (/^[-*•]\s+/.test(trimmed)) {
      nodes.push(<div key={i} style={{ display: "flex", gap: 6, fontSize: 14, lineHeight: 1.55, marginTop: 1 }}><span style={{ color: "#f97316", flexShrink: 0 }}>•</span><span>{renderInline(trimmed.replace(/^[-*•]\s+/, ""))}</span></div>);
    } else if (/^\d+\.\s+/.test(trimmed)) {
      const m = trimmed.match(/^(\d+)\.\s+(.*)/);
      if (m) nodes.push(<div key={i} style={{ display: "flex", gap: 6, fontSize: 14, lineHeight: 1.55, marginTop: 1 }}><span style={{ color: "#f97316", flexShrink: 0, fontWeight: 700, minWidth: 16 }}>{m[1]}.</span><span>{renderInline(m[2])}</span></div>);
    } else if (trimmed === "") nodes.push(<div key={i} style={{ height: 4 }} />);
    else nodes.push(<div key={i} style={{ fontSize: 14, lineHeight: 1.6 }}>{renderInline(line)}</div>);
  }
  return <>{nodes}</>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Screens
type Screen = "landing" | "language" | "i-am-lost" | "report-missing" | "match-check" | "chat" | "result";
type FlowType = "i-am-lost" | "report-missing";

// Auto-proceeds after showing "no match found" message
function MatchCheckEmpty({ onProceed }: { onProceed: () => void }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 1000);
    const t2 = setTimeout(() => setStep(2), 2200);
    const t3 = setTimeout(() => onProceed(), 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onProceed]);
  return (
    <div style={{ textAlign: "center", padding: "40px 20px" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
      <div style={{ fontWeight: 700, fontSize: 16, color: "#1e293b", marginBottom: 8 }}>Scanning all 10 help centers…</div>
      <div style={{ fontSize: 13, color: step >= 1 ? "#16a34a" : "#a8a29e", marginBottom: 4, transition: "color .4s" }}>
        {step >= 1 ? "✅ Centers scanned" : "⏳ Scanning…"}
      </div>
      <div style={{ fontSize: 13, color: step >= 2 ? "#f97316" : "#a8a29e", marginBottom: 20, transition: "color .4s" }}>
        {step >= 2 ? "⚠️ No match found yet — opening chat to file a report" : "⏳ Cross-referencing descriptions…"}
      </div>
      <div className="spinner" style={{ margin: "0 auto", width: 24, height: 24 }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function PublicApp() {
  const navigate = useNavigate();
  const location = useLocation();
  const isOnline = useOnline();
  const { lang, setLang } = useLanguage();

  // ── State ──────────────────────────────────────────────────────────────────
  // Support navigating directly to a screen via router state (e.g. from Registry)
  const [screen, setScreen] = useState<Screen>(
    (location.state as { initialScreen?: Screen } | null)?.initialScreen ?? "landing"
  );
  const [flowType, setFlowType] = useState<FlowType>(
    (location.state as { initialFlow?: FlowType } | null)?.initialFlow ?? "report-missing"
  );
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [nearbyDesks, setNearbyDesks] = useState<NearbyCenter[]>([]);
  const [locationLoading, setLocationLoading] = useState(false);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [contactNumber, setContactNumber] = useState("");
  const [missingDescription, setMissingDescription] = useState("");
  const [preCheckMatches, setPreCheckMatches] = useState<FoundPerson[]>([]);
  // i-am-lost form fields (collected before chat)
  const [lostName, setLostName] = useState("");
  const [lostAge, setLostAge] = useState("");
  const [lostDescription, setLostDescription] = useState("");
  // Validation errors
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [agentResult, setAgentResult] = useState<AgentResult | null>(null);
  const [registerOutput, setRegisterOutput] = useState<Record<string, unknown> | null>(null);
  const [reunionPoint, setReunionPoint] = useState<ReunionPoint | null>(null);
  const [refNumber, setRefNumber] = useState<string | null>(null);
  const [dpdpConsent, setDpdpConsent] = useState(false);
  const [sosLoading, setSosLoading] = useState(false);
  const [sosSent, setSosSent] = useState(false);
  const [markers, setMarkers] = useState<MapMarker[]>([]);
  const [routeTo, setRouteTo] = useState<RouteTarget | null>(null);
  const [selectedDeskId, setSelectedDeskId] = useState<string | null>(null);
  const [showCctv, setShowCctv] = useState(false);
  const [showChokepoints, setShowChokepoints] = useState(false);
  const [nearbyVolunteers, setNearbyVolunteers] = useState<VolunteerRecord[]>([]);
  const [nearbyPolice, setNearbyPolice] = useState<{ name: string; distKm: number; walkMin: number }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const cctv = cctvData as CctvPoint[];
  const choke = chokepointData as ChokepointData[];

  // ── Validation helpers ────────────────────────────────────────────────────
  function validatePhone(val: string): string {
    if (!val) return "";                          // optional unless explicitly required
    if (val.length !== 10) return "Mobile number must be exactly 10 digits";
    return "";
  }
  function validatePhoneRequired(val: string): string {
    if (!val) return "Mobile number is required";
    if (val.length !== 10) return "Mobile number must be exactly 10 digits";
    return "";
  }
  function validateDescription(val: string, min = 20): string {
    if (!val.trim()) return "Please describe the person";
    if (val.trim().length < min) return `Please add more detail (at least ${min} characters)`;
    return "";
  }
  function validateAge(val: string): string {
    if (!val) return "";                          // optional
    const n = parseInt(val, 10);
    if (isNaN(n) || n < 1 || n > 110) return "Age must be between 1 and 110";
    return "";
  }
  function validateWearing(val: string): string {
    if (!val.trim()) return "Please describe what you are wearing";
    return "";
  }

  // ── Fetch location on mount + build derived data ──────────────────────────
  useEffect(() => {
    setLocationLoading(true);
    getUserLocation().then((loc) => {
      setUserLocation(loc);
      setNearbyDesks(getNearestCenters(loc, 5));
      setLocationLoading(false);

      // Nearest police stations
      const policeStations = regBackend.getPoliceStations();
      const sortedPolice = policeStations
        .map((ps) => {
          const d = haversineKm(loc, ps.location);
          return { name: ps.name, distKm: Math.round(d * 100) / 100, walkMin: walkingMinutes(d) };
        })
        .sort((a, b) => a.distKm - b.distKm)
        .slice(0, 2);
      setNearbyPolice(sortedPolice);

      // Active volunteers sorted by distance
      const vols = getActiveVolunteers()
        .map((v) => ({ ...v, _dist: haversineKm(loc, { lat: v.lat, lng: v.lng }) }))
        .sort((a, b) => a._dist - b._dist)
        .slice(0, 4);
      setNearbyVolunteers(vols);
    });
  }, []);

  // ── Build map markers ─────────────────────────────────────────────────────
  useEffect(() => {
    const centers = registry.getHelpCenters();
    const ms: MapMarker[] = centers.map((c) => ({
      type: "center",
      lat: c.location.lat,
      lng: c.location.lng,
      label: c.name,
      detail: `${c.languages.join(", ")} · Load: ${c.currentLoad}/${c.capacity}`,
    }));
    registry.getPoliceStations().forEach((ps) => {
      ms.push({ type: "police", lat: ps.location.lat, lng: ps.location.lng, label: ps.name });
    });
    // Active volunteers
    getActiveVolunteers().forEach((v) => {
      ms.push({ type: "volunteer", lat: v.lat, lng: v.lng, label: `🙋 ${v.name}`, detail: v.centerName });
    });
    setMarkers(ms);
  }, [nearbyVolunteers]); // re-run when volunteers update

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

    // Extract reference number + full register output
    const regCall = result.toolCallsMade.find(
      (t) => t.name === "register_missing_person" || t.name === "register_found_person"
    );
    if (regCall) {
      const output = regCall.output as Record<string, unknown>;
      const ref = (output.referenceId ?? output.recordId) as string | undefined;
      setRegisterOutput(output);
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
        ? ` My GPS: ${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}.`
        : "";
      const nameStr = lostName ? ` My name is ${lostName}.` : "";
      const ageStr = lostAge ? ` I am ${lostAge} years old.` : "";
      const descStr = lostDescription ? ` I am wearing: ${lostDescription}.` : "";
      const phoneStr = contactNumber ? ` My phone: +91${contactNumber}.` : "";
      return `I am lost and need help finding my family.${locStr}${nameStr}${ageStr}${descStr}${phoneStr} I speak ${getLangName(lang)}. Please register me as a found person and search for any missing reports my family may have filed.`;
    }
    if (flowType === "report-missing" && missingDescription.trim()) {
      const photoNote = photoBase64 ? " I have also attached a photo." : "";
      const locStr = userLocation
        ? ` My current location: ${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}.`
        : "";
      return `I am looking for a missing family member.${locStr} Here are the details: ${missingDescription.trim()}${photoNote} I speak ${getLangName(lang)}.`;
    }
    return "";
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
    const queueCount = getQueue().length;
    return (
      <div className="page" style={{ background: "linear-gradient(180deg, #fff8f4 0%, #faf9f7 100%)" }}>
        {!isOnline ? (
          <div className="offline-banner">
            📵 Offline — matching locally on device{queueCount > 0 ? ` · ${queueCount} report${queueCount > 1 ? "s" : ""} queued for sync` : ""}
          </div>
        ) : null}

        {/* Header — row 1: title + language selector */}
        <div className="page-header" style={{ justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#f97316" }}>🕉 {t("title", lang)}</div>
            <div style={{ fontSize: 11, color: "#78716c" }}>{t("subtitle", lang)}</div>
          </div>
          <LanguageSelector value={lang} onChange={setLang} compact />
        </div>

        {/* Header — row 2: secondary nav (scrollable on narrow screens) */}
        <div style={{
          display: "flex", gap: 6, alignItems: "center",
          padding: "6px 12px", overflowX: "auto",
          background: "#faf9f7", borderBottom: "1px solid #e7e5e4",
          scrollbarWidth: "none",
        }}>
          <span style={{ fontSize: 10, background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: 10, padding: "3px 8px", whiteSpace: "nowrap", fontWeight: 600, flexShrink: 0 }}>
            🔵 Matching locally
          </span>
          <button
            onClick={() => navigate("/registry")}
            style={{ fontSize: 11, color: "#15803d", padding: "4px 10px", border: "1px solid #86efac", borderRadius: 6, background: "#f0fdf4", whiteSpace: "nowrap", flexShrink: 0 }}
          >
            📋 Registry
          </button>
          <button
            onClick={() => navigate("/volunteer")}
            style={{ fontSize: 11, color: "#78716c", padding: "4px 10px", border: "1px solid #e7e5e4", borderRadius: 6, background: "white", whiteSpace: "nowrap", flexShrink: 0 }}
          >
            🙋 {t("volunteer", lang)}
          </button>
          <button
            onClick={() => navigate("/help-desk")}
            style={{ fontSize: 11, color: "#1d4ed8", padding: "4px 10px", border: "1px solid #bfdbfe", borderRadius: 6, background: "#eff6ff", whiteSpace: "nowrap", flexShrink: 0 }}
          >
            🏥 {t("helpDesk", lang)}
          </button>
        </div>

        {/* Map — shows route when a center is selected */}
        <div style={{ position: "relative" }}>
          <MapView
            userLocation={userLocation}
            markers={markers}
            routeTo={routeTo}
            cctvPoints={cctv}
            chokepoints={choke}
            showCctv={showCctv}
            showChokepoints={showChokepoints}
            showSatellite={false}
            height={260}
            zoom={13}
          />
          {/* Layer toggles */}
          <div style={{
            position: "absolute", bottom: 8, right: 8, zIndex: 999,
            display: "flex", gap: 4, flexDirection: "column",
          }}>
            <button
              onClick={() => setShowCctv(v => !v)}
              style={{
                fontSize: 10, padding: "3px 7px", borderRadius: 10,
                background: showCctv ? "#7c3aed" : "white",
                color: showCctv ? "white" : "#57534e",
                border: "1px solid #d4d0cb",
                boxShadow: "0 1px 4px rgba(0,0,0,.2)",
                cursor: "pointer",
              }}
            >
              📹 {showCctv ? "CCTV ON" : "CCTV"}
            </button>
            <button
              onClick={() => setShowChokepoints(v => !v)}
              style={{
                fontSize: 10, padding: "3px 7px", borderRadius: 10,
                background: showChokepoints ? "#f97316" : "white",
                color: showChokepoints ? "white" : "#57534e",
                border: "1px solid #d4d0cb",
                boxShadow: "0 1px 4px rgba(0,0,0,.2)",
                cursor: "pointer",
              }}
            >
              ⚠️ {showChokepoints ? "Zones ON" : "Zones"}
            </button>
          </div>
          {locationLoading && (
            <div style={{
              position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)",
              background: "white", borderRadius: 20, padding: "4px 12px",
              fontSize: 12, boxShadow: "0 2px 8px rgba(0,0,0,.15)",
            }}>
              {t("gettingLocation", lang)}
            </div>
          )}
        </div>

        <div className="page-body">
          {/* Stats */}
          <div className="stats-row" style={{ marginTop: 16 }}>
            <div className="stat-box">
              <div className="stat-value">{registry.getHelpCenters().length}</div>
              <div className="stat-label">{t("helpCenters", lang)}</div>
            </div>
            <div className="stat-box">
              <div className="stat-value">{registry.getPoliceStations().length}</div>
              <div className="stat-label">{t("policeStations", lang)}</div>
            </div>
            <div className="stat-box">
              <div className="stat-value">24/7</div>
              <div className="stat-label">{t("support", lang)}</div>
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
              <div className="result-box" style={{ width: "100%", padding: "20px 24px" }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 32 }}>✅</div>
                  <div style={{ fontWeight: 700, color: "#16a34a", fontSize: 18, marginTop: 6 }}>Help is on the way!</div>
                  <div style={{ display: "inline-block", fontFamily: "monospace", fontSize: 14, background: "#f0fdf4", color: "#15803d", padding: "4px 14px", borderRadius: 8, marginTop: 6, fontWeight: 700 }}>
                    Ref: {refNumber}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 10, color: "#78716c", fontSize: 12 }}>
                    <span className="spinner" style={{ width: 12, height: 12 }} />
                    Nearest center alerted · coordinator notified
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <button
                    onClick={() => { setFlowType("i-am-lost"); setScreen("i-am-lost"); }}
                    className="btn btn-primary flex-1"
                    style={{ fontSize: 13 }}
                  >
                    💬 Chat with agent
                  </button>
                  <button
                    onClick={() => navigate("/registry")}
                    className="btn btn-ghost flex-1"
                    style={{ fontSize: 13 }}
                  >
                    📋 View registry
                  </button>
                </div>
                <p style={{ fontSize: 11, color: "#a8a29e", textAlign: "center", marginTop: 8 }}>
                  Keep this screen open — your family can search for Ref {refNumber}
                </p>
              </div>
            ) : (
              <button
                onClick={handleSOS}
                disabled={sosLoading}
                className="sos-btn"
                aria-label="SOS — I need help"
                style={{ width: 96, height: 96, fontSize: 13 }}
              >
                {sosLoading ? <span className="spinner" /> : t("sosBtn", lang)}
              </button>
            )}
            {!sosSent && (
              <p style={{ fontSize: 12, color: "#78716c", textAlign: "center" }}>{t("sosHint", lang)}</p>
            )}
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
                <div>{t("lookingForSomeone", lang)}</div>
                <div style={{ fontSize: 12, fontWeight: 400, opacity: .85 }}>
                  {t("lookingSubtext", lang)}
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
                <div>{t("iAmLost", lang)}</div>
                <div style={{ fontSize: 12, fontWeight: 400, opacity: .85 }}>
                  {t("iAmLostSubtext", lang)}
                </div>
              </div>
            </button>
          </div>

          {/* Safety Quick-Access — Police + CCTV */}
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <div className="card" style={{ flex: 1, margin: 0, borderColor: "#1d4ed8" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#1d4ed8", marginBottom: 6 }}>👮 Nearest Police</div>
              {nearbyPolice.length > 0 ? (
                nearbyPolice.slice(0, 1).map((ps) => (
                  <div key={ps.name}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#1e293b" }}>{ps.name}</div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>🚶 {ps.walkMin} min · {ps.distKm} km</div>
                    <a href="tel:100" style={{ fontSize: 12, color: "#1d4ed8", fontWeight: 700 }}>📞 Dial 100</a>
                  </div>
                ))
              ) : (
                <div style={{ fontSize: 11, color: "#94a3b8" }}>Locating…</div>
              )}
            </div>
            <div className="card" style={{ flex: 1, margin: 0, borderColor: "#7c3aed" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed", marginBottom: 6 }}>📹 CCTV Coverage</div>
              <div style={{ fontSize: 12, color: "#1e293b" }}>{cctv.length} cameras</div>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>Active monitoring</div>
              <button
                onClick={() => { setShowCctv(v => !v); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                style={{ fontSize: 11, color: "#7c3aed", background: "none", border: "1px solid #7c3aed", borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}
              >
                {showCctv ? "Hide on map" : "Show on map →"}
              </button>
            </div>
          </div>

          {/* Nearest Volunteers */}
          {nearbyVolunteers.length > 0 && (
            <div className="card" style={{ marginTop: 12 }}>
              <div className="card-title">🙋 Nearest Volunteers ({nearbyVolunteers.length} active)</div>
              {nearbyVolunteers.slice(0, 3).map((v) => {
                const dist = userLocation ? haversineKm(userLocation, { lat: v.lat, lng: v.lng }) : 0;
                const isRouted = routeTo?.lat === v.lat && routeTo?.lng === v.lng;
                return (
                  <div key={v.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f1f0ef" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{v.name}</div>
                      <div style={{ fontSize: 11, color: "#78716c" }}>{v.centerName}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 12, color: "#16a34a", fontWeight: 700 }}>🟢 Active</div>
                        <div style={{ fontSize: 11, color: "#78716c" }}>🚶 {walkingMinutes(dist)} min</div>
                      </div>
                      <button
                        onClick={() => {
                          setRouteTo({ lat: v.lat, lng: v.lng, name: `${v.name} (Volunteer)` });
                          setSelectedDeskId(v.id);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        style={{
                          fontSize: 11, padding: "4px 8px", borderRadius: 6,
                          background: isRouted ? "#7c3aed" : "white",
                          color: isRouted ? "white" : "#7c3aed",
                          border: "1px solid #7c3aed", cursor: "pointer",
                        }}
                      >
                        {isRouted ? "📍" : "🗺"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Nearby desks — tap to show route on map above */}
          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-title">{t("nearestCenters", lang)}</div>
            {routeTo && (
              <div style={{ fontSize: 12, color: "#2563eb", marginBottom: 8 }}>
                🗺 Showing route to <strong>{routeTo.name}</strong> — scroll up to see map
                <button
                  onClick={() => { setRouteTo(null); setSelectedDeskId(null); }}
                  style={{ marginLeft: 8, fontSize: 11, color: "#dc2626", background: "none", border: "none", cursor: "pointer" }}
                >
                  ✕ Clear
                </button>
              </div>
            )}
            <NearbyDesks
              centers={nearbyDesks.slice(0, 3)}
              userLocation={userLocation}
              selectedId={selectedDeskId}
              onSelect={(c) => {
                setRouteTo({ lat: c.location.lat, lng: c.location.lng, name: c.name });
                setSelectedDeskId(c.id);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
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
            <div style={{ fontWeight: 700 }}>{t("iAmLostTitle", lang)}</div>
            <div style={{ fontSize: 11, color: "#78716c" }}>{t("weWillFind", lang)}</div>
          </div>
          <LanguageSelector value={lang} onChange={setLang} compact />
        </div>

        <div className="page-body">
          <div className="card">
            <div style={{ fontSize: 12, color: "#78716c", marginBottom: 12, background: "#fff8f4", padding: "8px 10px", borderRadius: 8, borderLeft: "3px solid #f97316" }}>
              ℹ️ Fill in as much as you can — this registers you in the live missing registry so your family can find you.
            </div>

            <div className="form-row">
              <label className="input-label">👤 Your name (optional)</label>
              <input
                value={lostName}
                onChange={e => setLostName(e.target.value)}
                placeholder="e.g. Ramesh Sharma"
                className="input"
              />
            </div>

            <div className="form-row">
              <label className="input-label">🎂 Your age (optional)</label>
              <input
                value={lostAge}
                onChange={e => {
                  setLostAge(e.target.value.replace(/\D/g, "").slice(0, 3));
                  setErrors(ev => ({ ...ev, lostAge: validateAge(e.target.value.replace(/\D/g, "").slice(0, 3)) }));
                }}
                placeholder="e.g. 45"
                className="input"
                style={{ borderColor: errors.lostAge ? "#dc2626" : undefined }}
                type="number"
                min={1}
                max={110}
              />
              {errors.lostAge && <p style={{ fontSize: 11, color: "#dc2626", marginTop: 3 }}>⚠️ {errors.lostAge}</p>}
            </div>

            <div className="form-row">
              <label className="input-label">👗 What are you wearing?</label>
              <textarea
                value={lostDescription}
                onChange={e => {
                  setLostDescription(e.target.value);
                  setErrors(ev => ({ ...ev, lostDescription: validateWearing(e.target.value) }));
                }}
                placeholder="e.g. White kurta and blue dhoti, yellow shawl, glasses"
                className="input"
                rows={2}
                style={{ resize: "none", borderColor: errors.lostDescription ? "#dc2626" : undefined }}
              />
              {errors.lostDescription && <p style={{ fontSize: 11, color: "#dc2626", marginTop: 3 }}>⚠️ {errors.lostDescription}</p>}
            </div>

            <div className="form-row">
              <label className="input-label">{t("phoneOptional", lang)}</label>
              <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
                <span style={{ background: "#f1f0ef", border: "1px solid #d6d3d1", borderRight: "none", padding: "10px 10px", borderRadius: "8px 0 0 8px", fontSize: 14, color: "#57534e", whiteSpace: "nowrap" }}>🇮🇳 +91</span>
                <input
                  type="tel"
                  value={contactNumber}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "").slice(0, 10);
                    setContactNumber(v);
                    setErrors(ev => ({ ...ev, contactNumber: validatePhone(v) }));
                  }}
                  placeholder="9876543210"
                  className="input"
                  style={{ borderRadius: "0 8px 8px 0", borderLeft: "none", borderColor: errors.contactNumber ? "#dc2626" : undefined }}
                  maxLength={10}
                />
              </div>
              {errors.contactNumber && <p style={{ fontSize: 11, color: "#dc2626", marginTop: 3 }}>⚠️ {errors.contactNumber}</p>}
              <p style={{ fontSize: 11, color: "#a8a29e", marginTop: 4 }}>{t("phoneSub", lang)}</p>
            </div>

            {userLocation && (
              <div className="badge badge-green" style={{ marginBottom: 12, display: "inline-flex" }}>
                {t("locationCaptured", lang)} ({userLocation.source})
              </div>
            )}

            <button
              onClick={() => {
                const newErrors = {
                  lostDescription: validateWearing(lostDescription),
                  lostAge: validateAge(lostAge),
                  contactNumber: validatePhone(contactNumber),
                };
                setErrors(newErrors);
                if (Object.values(newErrors).some(e => e)) return;
                setScreen("chat");
              }}
              className="btn btn-primary btn-full mt-16"
            >
              {t("startIAmLost", lang)}
            </button>
          </div>

          {nearbyDesks.length > 0 && (
            <div className="card" style={{ marginTop: 12 }}>
              <div className="card-title">{t("nearestCenter", lang)}</div>
              <div className="desk-item" style={{ marginBottom: 0 }}>
                <div className="desk-icon">🏥</div>
                <div>
                  <div className="desk-name">{nearbyDesks[0].name}</div>
                  <div className="desk-meta">🚶 {nearbyDesks[0].walkingMinutes} min</div>
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
            <div style={{ fontWeight: 700 }}>{t("reportMissingTitle", lang)}</div>
            <div style={{ fontSize: 11, color: "#78716c" }}>{t("reportMissingSubtitle", lang)}</div>
          </div>
          <LanguageSelector value={lang} onChange={setLang} compact />
        </div>

        <div className="page-body">
          <div className="card">
            <div className="form-row">
              <label className="input-label">{t("phoneRequired", lang)}</label>
              <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
                <span style={{ background: "#f1f0ef", border: "1px solid #d6d3d1", borderRight: "none", padding: "10px 10px", borderRadius: "8px 0 0 8px", fontSize: 14, color: "#57534e", whiteSpace: "nowrap" }}>🇮🇳 +91</span>
                <input
                  type="tel"
                  value={contactNumber}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "").slice(0, 10);
                    setContactNumber(v);
                    setErrors(ev => ({ ...ev, reportPhone: validatePhoneRequired(v) }));
                  }}
                  placeholder="9876543210"
                  className="input"
                  style={{ borderRadius: "0 8px 8px 0", borderLeft: "none", borderColor: errors.reportPhone ? "#dc2626" : undefined }}
                  maxLength={10}
                />
              </div>
              {errors.reportPhone && <p style={{ fontSize: 11, color: "#dc2626", marginTop: 3 }}>⚠️ {errors.reportPhone}</p>}
            </div>

            <div className="form-row">
              <label className="input-label">📝 {t("describePersonLabel", lang)}</label>
              <textarea
                value={missingDescription}
                onChange={(e) => {
                  setMissingDescription(e.target.value);
                  setErrors(ev => ({ ...ev, missingDescription: validateDescription(e.target.value) }));
                }}
                placeholder={t("describePersonPlaceholder", lang)}
                className="input"
                rows={4}
                style={{ resize: "none", lineHeight: 1.5, borderColor: errors.missingDescription ? "#dc2626" : undefined }}
              />
              {errors.missingDescription && <p style={{ fontSize: 11, color: "#dc2626", marginTop: 3 }}>⚠️ {errors.missingDescription}</p>}
              <p style={{ fontSize: 11, color: "#a8a29e", marginTop: 4 }}>{t("describePersonHint", lang)}</p>
            </div>

            <div className="form-row">
              <label className="input-label">{t("photoLabel", lang)}</label>
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
                  <p style={{ fontSize: 13 }}>{t("tapToUpload", lang)}</p>
                  <p style={{ fontSize: 11, color: "#a8a29e", marginTop: 4 }}>
                    {t("photoHelps", lang)}
                  </p>
                </div>
              )}
            </div>

            <div className="form-row" style={{ marginTop: 8 }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "#57534e", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={dpdpConsent}
                  onChange={e => setDpdpConsent(e.target.checked)}
                  style={{ marginTop: 2, flexShrink: 0 }}
                />
                <span>
                  I consent to sharing this information with Kumbh Mela authorities and help centers to locate the missing person. Data is retained for 72 hours per DPDP Act 2023 guidelines.
                </span>
              </label>
            </div>

            <button
              onClick={() => {
                const newErrors = {
                  reportPhone: validatePhoneRequired(contactNumber),
                  missingDescription: validateDescription(missingDescription),
                };
                setErrors(newErrors);
                if (Object.values(newErrors).some(e => e)) return;
                if (!dpdpConsent) return;
                // First do a quick client-side registry check before opening chat
                const results = registry.searchFound({ description: missingDescription });
                setPreCheckMatches(results.map(r => r as unknown as FoundPerson));
                setScreen("match-check");
              }}
              className="btn btn-primary btn-full mt-16"
              disabled={!dpdpConsent}
            >
              {t("startReport", lang)}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // MATCH CHECK — instant registry check before opening chat
  if (screen === "match-check") {
    const hasMatches = preCheckMatches.length > 0;
    return (
      <div className="page">
        <div className="page-header">
          <button onClick={() => setScreen("report-missing")} style={{ fontSize: 20, background: "none" }}>←</button>
          <div>
            <div style={{ fontWeight: 700 }}>{hasMatches ? "✅ Possible Matches Found!" : "🔍 Checking all 10 centers…"}</div>
            <div style={{ fontSize: 11, color: "#78716c" }}>Live registry scan</div>
          </div>
          <LanguageSelector value={lang} onChange={setLang} compact />
        </div>

        <div className="page-body">
          {hasMatches ? (
            <>
              <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
                <div style={{ fontWeight: 700, color: "#15803d", fontSize: 14 }}>
                  🎯 {preCheckMatches.length} person{preCheckMatches.length > 1 ? "s" : ""} matching your description found at help center{preCheckMatches.length > 1 ? "s" : ""}
                </div>
                <div style={{ fontSize: 12, color: "#166534", marginTop: 2 }}>Check below — they may already be safe!</div>
              </div>

              {preCheckMatches.map((fp) => {
                const center = registry.getCenterById(fp.centerId);
                return (
                  <div key={fp.id} className="card" style={{ borderColor: "#16a34a", borderWidth: 2 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>
                          {fp.gender === "female" ? "👩" : fp.gender === "male" ? "👨" : "🧑"} {fp.gender} · {fp.ageRange}
                        </div>
                        <div style={{ fontSize: 12, color: "#57534e", marginTop: 2 }}>👗 {fp.clothing}</div>
                        <div style={{ fontSize: 11, color: "#78716c" }}>📍 Found at: {fp.foundZone}</div>
                        <div style={{ fontSize: 11, color: "#78716c" }}>🗣 Speaks: {fp.languageSpoken}</div>
                        <div style={{ fontSize: 11, color: "#57534e", marginTop: 2 }}>💊 Condition: {fp.condition}</div>
                      </div>
                      <span style={{ fontFamily: "monospace", fontSize: 10, background: "#e0f2fe", color: "#0369a1", padding: "2px 6px", borderRadius: 4 }}>{fp.id}</span>
                    </div>

                    {/* Center info — zone-masked, exact desk revealed only in person */}
                    <div style={{ background: "#eff6ff", borderRadius: 8, padding: "8px 10px", marginTop: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 12, color: "#1d4ed8" }}>📍 Last seen in: {maskZone(fp.foundZone || fp.centerName)}</div>
                      <div style={{ fontSize: 11, color: "#57534e", marginTop: 2 }}>Go to any help desk in this area — they can confirm location</div>
                      {center?.contactNumber && (
                        <a href={`tel:${center.contactNumber}`} style={{ fontSize: 12, color: "#1d4ed8", display: "block", marginTop: 2 }}>📞 Area helpline: {center.contactNumber}</a>
                      )}
                    </div>

                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      {center && (
                        <button
                          onClick={() => {
                            setRouteTo({ lat: center.location.lat, lng: center.location.lng, name: center.name });
                            setSelectedDeskId(center.id);
                            setScreen("landing");
                            setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 100);
                          }}
                          className="btn btn-primary flex-1"
                          style={{ fontSize: 12 }}
                        >
                          🗺 Get directions
                        </button>
                      )}
                      <button
                        onClick={() => setScreen("chat")}
                        className="btn btn-ghost flex-1"
                        style={{ fontSize: 12 }}
                      >
                        ❌ Not this person
                      </button>
                    </div>
                  </div>
                );
              })}

              <div style={{ textAlign: "center", marginTop: 12 }}>
                <button onClick={() => setScreen("chat")} className="btn btn-ghost btn-full" style={{ fontSize: 13 }}>
                  None of these match — chat with agent →
                </button>
              </div>
            </>
          ) : (
            // No matches — show spinner then auto-proceed to chat
            <MatchCheckEmpty onProceed={() => setScreen("chat")} />
          )}
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
            <div style={{ fontSize: 11, color: "#78716c" }}>{t("searchingCenters", lang)}</div>
          </div>
          <LanguageSelector value={lang} onChange={setLang} compact />
        </div>

        <ChatAgent
          langCode={lang}
          initialPrompt={initial || undefined}
          photoBase64={photoBase64}
          onResult={handleAgentResult}
          placeholder={
            flowType === "i-am-lost"
              ? t("chatPlaceholderLost", lang)
              : t("chatPlaceholderMissing", lang)
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
            {hasMatch ? t("matchFound", lang) : t("caseRegistered", lang)}
          </div>
        </div>

        <div className="page-body">
          {/* Reunion map */}
          <MapView
            userLocation={userLocation}
            markers={markers}
            reunionPoint={reunionPoint}
            showSatellite={false}
            height={220}
          />

          {/* Reference number */}
          {refNumber && (
            <div className="result-box" style={{ marginTop: 16 }}>
              <h2>{hasMatch ? t("matchFound", lang) : t("caseRegistered", lang)}</h2>
              <p style={{ fontSize: 13, color: "#57534e", marginBottom: 8 }}>{t("refNumberLabel", lang)}</p>
              <div className="ref-number">{refNumber}</div>
              {contactNumber && (
                <p style={{ fontSize: 12, color: "#57534e" }}>
                  {t("smsSent", lang)} {contactNumber}
                </p>
              )}
            </div>
          )}

          {/* Registration details card */}
          {registerOutput && (
            <div className="card" style={{ marginTop: 12, background: "#f0fdf4", borderColor: "#86efac" }}>
              <div className="card-title" style={{ color: "#15803d" }}>📋 Report Details</div>
              {typeof registerOutput.referenceId === "string" && (
                <div style={{ fontSize: 13, marginBottom: 6 }}>
                  <strong>Reference ID:</strong> <span style={{ fontFamily: "monospace", color: "#1d4ed8" }}>{registerOutput.referenceId}</span>
                </div>
              )}

              {/* 🔐 Handover PIN — shown prominently */}
              {typeof registerOutput.verificationCode === "string" && (
                <div style={{ background: "#fffbeb", border: "2px solid #f59e0b", borderRadius: 10, padding: "12px 14px", margin: "10px 0" }}>
                  <div style={{ fontSize: 12, color: "#92400e", fontWeight: 700, marginBottom: 4 }}>🔐 Your Handover Code</div>
                  <div style={{ fontFamily: "monospace", fontSize: 36, fontWeight: 900, letterSpacing: 14, color: "#1e293b", textAlign: "center" }}>
                    {registerOutput.verificationCode}
                  </div>
                  <div style={{ fontSize: 11, color: "#92400e", marginTop: 6, textAlign: "center", lineHeight: 1.4 }}>
                    Quote this 4-digit code at any help desk before anyone is released. Keep it private.
                  </div>
                </div>
              )}

              {Array.isArray(registerOutput.alertedCenters) && (registerOutput.alertedCenters as string[]).length > 0 && (
                <div style={{ fontSize: 13, marginBottom: 6 }}>
                  <strong>Centers alerted:</strong>{" "}
                  {(registerOutput.alertedCenters as string[]).join(", ")}
                </div>
              )}
              {typeof registerOutput.volunteersAlerted === "number" && (
                <div style={{ fontSize: 13, marginBottom: 6 }}>
                  <strong>🚨 AMBER Alert sent to:</strong>{" "}
                  <span style={{ color: registerOutput.volunteersAlerted > 0 ? "#dc2626" : "#78716c" }}>
                    {registerOutput.volunteersAlerted} volunteer{registerOutput.volunteersAlerted !== 1 ? "s" : ""} in the area
                  </span>
                </div>
              )}
              <div style={{ fontSize: 12, color: "#15803d", marginTop: 8, fontStyle: "italic" }}>
                ✅ All nearby help centers and volunteers have been notified
              </div>
            </div>
          )}

          {/* Claude's response — re-uses the same markdown renderer as chat */}
          {agentResult?.finalText && (
            <div className="card" style={{ marginTop: 12 }}>
              <div className="card-title">{t("instructions", lang)}</div>
              <MarkdownView text={agentResult.finalText} />
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
            <div className="card-title">{t("nearestCenters", lang)}</div>
            <NearbyDesks centers={nearbyDesks.slice(0, 3)} userLocation={userLocation} />
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
              {t("chatAgain", lang)}
            </button>
            <button onClick={() => setScreen("landing")} className="btn btn-primary flex-1">
              {t("home", lang)}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
