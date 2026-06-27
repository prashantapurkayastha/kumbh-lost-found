import { useState, useRef } from "react";
import { addFoundPersonSync, addMissingReportSync } from "../core/backends/registrySync";
import type { RegisterFoundPersonInput, RegisterMissingPersonInput } from "../types";

// ── Icon mode grids ──────────────────────────────────────────────────────────
const AGE_ICONS: { value: string; icon: string; label: string }[] = [
  { value: "child (0-12)", icon: "👶", label: "Child" },
  { value: "teen (13-17)", icon: "🧒", label: "Teen" },
  { value: "young adult (18-35)", icon: "🧑", label: "Young Adult" },
  { value: "adult (36-60)", icon: "👤", label: "Adult" },
  { value: "elderly (60+)", icon: "👴", label: "Elder" },
];
const GENDER_ICONS: { value: string; icon: string; label: string }[] = [
  { value: "male", icon: "👨", label: "Male" },
  { value: "female", icon: "👩", label: "Female" },
  { value: "unknown", icon: "🧑", label: "Unknown" },
];
const CONDITION_ICONS: { value: string; icon: string; label: string }[] = [
  { value: "calm", icon: "😊", label: "Calm" },
  { value: "distressed", icon: "😟", label: "Distressed" },
  { value: "injured", icon: "🤕", label: "Injured" },
  { value: "non-verbal", icon: "😶", label: "Non-verbal" },
];

interface VolunteerQuickFormProps {
  mode: "found-person" | "help-family" | "help-person";
  centerId: string;
  onSubmitted: (result: { refId: string; type: string }) => void;
}

type AgeRange = "child (0-12)" | "teen (13-17)" | "young adult (18-35)" | "adult (36-60)" | "elderly (60+)";
type Gender = "male" | "female" | "unknown";
type Language = "Hindi" | "Marathi" | "Tamil" | "Telugu" | "Bengali" | "Gujarati" | "Punjabi" | "Other/Unknown";
type Condition = "calm" | "distressed" | "injured" | "non-verbal";

interface VisionResult {
  ageRange?: string;
  gender?: string;
  clothing?: string;
  features?: string;
}

export default function VolunteerQuickForm({ mode, centerId, onSubmitted }: VolunteerQuickFormProps) {
  // Shared person fields
  const [ageRange, setAgeRange] = useState<AgeRange>("adult (36-60)");
  const [gender, setGender] = useState<Gender>("unknown");
  const [clothing, setClothing] = useState("");
  const [language, setLanguage] = useState<Language>("Hindi");
  const [condition, setCondition] = useState<Condition>("calm");
  const [whereFound, setWhereFound] = useState("");
  const [contactNumber, setContactNumber] = useState("");

  // Photo upload — found-person / help-person mode
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoAnalyzing, setPhotoAnalyzing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Photo upload — help-family mode (fills missing person fields)
  const [missingPhotoPreview, setMissingPhotoPreview] = useState<string | null>(null);
  const [missingPhotoAnalyzing, setMissingPhotoAnalyzing] = useState(false);
  const missingFileInputRef = useRef<HTMLInputElement>(null);

  // Voice input
  const [voiceTooltip, setVoiceTooltip] = useState("");
  const [missingVoiceTooltip, setMissingVoiceTooltip] = useState("");

  // Help-family mode fields
  const [reporterName, setReporterName] = useState("");
  const [reporterPhone, setReporterPhone] = useState("");
  const [missingName, setMissingName] = useState("");
  const [missingAgeRange, setMissingAgeRange] = useState<AgeRange>("adult (36-60)");
  const [missingGender, setMissingGender] = useState<Gender>("unknown");
  const [missingClothing, setMissingClothing] = useState("");
  const [lastSeenZone, setLastSeenZone] = useState("");
  const [missingLanguage, setMissingLanguage] = useState<Language>("Hindi");

  // Icon mode
  const [iconMode, setIconMode] = useState(false);

  // Abandoned elderly / care disposition (help-person mode)
  const [familyExpected, setFamilyExpected] = useState(true);
  const [disposition, setDisposition] = useState<"active" | "care-arranged" | "medical-referral" | "transferred-shelter">("active");
  const [dispositionNotes, setDispositionNotes] = useState("");

  // Child-specific fields (when age is child or teen)
  const [childKnowsName, setChildKnowsName] = useState<boolean | null>(null);
  const [childHometown, setChildHometown] = useState("");

  // Form state
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isChild = ageRange === "child (0-12)" || ageRange === "teen (13-17)";

  const AGE_RANGES: AgeRange[] = ["child (0-12)", "teen (13-17)", "young adult (18-35)", "adult (36-60)", "elderly (60+)"];
  const GENDERS: Gender[] = ["male", "female", "unknown"];
  const LANGUAGES: Language[] = ["Hindi", "Marathi", "Tamil", "Telugu", "Bengali", "Gujarati", "Punjabi", "Other/Unknown"];
  const CONDITIONS: Condition[] = ["calm", "distressed", "injured", "non-verbal"];

  // ── Photo upload & Claude Vision ──────────────────────────────────────────
  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Preview
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);

    // Analyze with Claude Vision via /api/claude
    setPhotoAnalyzing(true);
    try {
      const base64 = await fileToBase64(file);
      const mediaType = file.type as "image/jpeg" | "image/png" | "image/webp" | "image/gif";

      const payload = {
        model: "claude-opus-4-5",
        max_tokens: 512,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: base64 },
              },
              {
                type: "text",
                text: 'Describe this person: approximate age range (child/teen/young adult/adult/elderly), gender, clothing color and type, any distinguishing features. Return JSON: {"ageRange":"...","gender":"...","clothing":"...","features":"..."}',
              },
            ],
          },
        ],
      };

      const res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        const text: string = data?.content?.[0]?.text ?? "";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed: VisionResult = JSON.parse(jsonMatch[0]);
          // Auto-fill fields from Vision response
          if (parsed.ageRange) {
            const normalized = parsed.ageRange.toLowerCase();
            if (normalized.includes("child")) setAgeRange("child (0-12)");
            else if (normalized.includes("teen")) setAgeRange("teen (13-17)");
            else if (normalized.includes("young")) setAgeRange("young adult (18-35)");
            else if (normalized.includes("elderly") || normalized.includes("old")) setAgeRange("elderly (60+)");
            else setAgeRange("adult (36-60)");
          }
          if (parsed.gender) {
            const g = parsed.gender.toLowerCase();
            if (g.includes("male") && !g.includes("female")) setGender("male");
            else if (g.includes("female")) setGender("female");
          }
          if (parsed.clothing || parsed.features) {
            const desc = [parsed.clothing, parsed.features].filter(Boolean).join(". ");
            setClothing((prev) => (prev ? prev + ". " + desc : desc));
          }
        }
      }
    } catch {
      // Silently fail — form still usable
    } finally {
      setPhotoAnalyzing(false);
    }
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ── Voice input ───────────────────────────────────────────────────────────
  function handleVoiceInput() {
    type AnySR = {
      lang: string; interimResults: boolean; maxAlternatives: number;
      onresult: ((e: { results: { [k: number]: { [k: number]: { transcript: string } } } }) => void) | null;
      onerror: (() => void) | null; start: () => void;
    };
    type WW = Window & { SpeechRecognition?: new () => AnySR; webkitSpeechRecognition?: new () => AnySR };
    const w = window as WW;
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) {
      setVoiceTooltip("Voice not supported in this browser");
      setTimeout(() => setVoiceTooltip(""), 3000);
      return;
    }
    const recognition = new Ctor();
    recognition.lang = "hi-IN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setClothing((prev) => (prev ? prev + " " + transcript : transcript));
    };
    recognition.onerror = () => {
      setVoiceTooltip("Could not capture voice. Please try again.");
      setTimeout(() => setVoiceTooltip(""), 3000);
    };
    recognition.start();
  }

  // ── Photo + voice for help-family (fills missing person fields) ──────────
  async function handleMissingPhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setMissingPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
    setMissingPhotoAnalyzing(true);
    try {
      const base64 = await fileToBase64(file);
      const mediaType = file.type as "image/jpeg" | "image/png" | "image/webp" | "image/gif";
      const payload = {
        max_tokens: 512,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: 'Describe this person: approximate age range (child/teen/young adult/adult/elderly), gender, clothing color and type, any distinguishing features. Return JSON: {"ageRange":"...","gender":"...","clothing":"...","features":"..."}' },
          ],
        }],
      };
      const res = await fetch("/api/claude", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (res.ok) {
        const data = await res.json();
        const text: string = data?.content?.[0]?.text ?? "";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed: VisionResult = JSON.parse(jsonMatch[0]);
          if (parsed.ageRange) {
            const n = parsed.ageRange.toLowerCase();
            if (n.includes("child")) setMissingAgeRange("child (0-12)");
            else if (n.includes("teen")) setMissingAgeRange("teen (13-17)");
            else if (n.includes("young")) setMissingAgeRange("young adult (18-35)");
            else if (n.includes("elderly") || n.includes("old")) setMissingAgeRange("elderly (60+)");
            else setMissingAgeRange("adult (36-60)");
          }
          if (parsed.gender) {
            const g = parsed.gender.toLowerCase();
            if (g.includes("male") && !g.includes("female")) setMissingGender("male");
            else if (g.includes("female")) setMissingGender("female");
          }
          if (parsed.clothing || parsed.features) {
            const desc = [parsed.clothing, parsed.features].filter(Boolean).join(". ");
            setMissingClothing((prev) => (prev ? prev + ". " + desc : desc));
          }
        }
      }
    } catch { /* silent */ } finally { setMissingPhotoAnalyzing(false); }
  }

  function handleMissingVoiceInput() {
    type AnySR = { lang: string; interimResults: boolean; maxAlternatives: number; onresult: ((e: { results: { [k: number]: { [k: number]: { transcript: string } } } }) => void) | null; onerror: (() => void) | null; start: () => void; };
    type WW = Window & { SpeechRecognition?: new () => AnySR; webkitSpeechRecognition?: new () => AnySR };
    const w = window as WW;
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) {
      setMissingVoiceTooltip("Voice not supported in this browser");
      setTimeout(() => setMissingVoiceTooltip(""), 3000);
      return;
    }
    const recognition = new Ctor();
    recognition.lang = "hi-IN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setMissingClothing((prev) => (prev ? prev + " " + transcript : transcript));
    };
    recognition.onerror = () => {
      setMissingVoiceTooltip("Could not capture voice. Please try again.");
      setTimeout(() => setMissingVoiceTooltip(""), 3000);
    };
    recognition.start();
  }

  // ── Validation ────────────────────────────────────────────────────────────
  function validate(): boolean {
    const errs: Record<string, string> = {};

    if (mode === "help-family") {
      if (!reporterPhone || !/^\d{10}$/.test(reporterPhone)) {
        errs.reporterPhone = "Phone must be exactly 10 digits";
      }
      if (missingClothing.length < 15) {
        errs.missingClothing = "Clothing description must be at least 15 characters";
      }
    } else {
      if (clothing.length < 15) {
        errs.clothing = "Clothing description must be at least 15 characters";
      }
      if (contactNumber && !/^\d{0,10}$/.test(contactNumber)) {
        errs.contactNumber = "Contact number must be up to 10 digits";
      }
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    try {
      if (mode === "help-family") {
        const input: RegisterMissingPersonInput = {
          name: missingName || undefined,
          ageRange: missingAgeRange,
          gender: missingGender,
          clothingDescription: missingClothing,
          lastSeenZone,
          languageSpoken: missingLanguage,
          contactNumber: reporterPhone,
          reporterName: reporterName || undefined,
          photoBase64: missingPhotoPreview?.split(",")[1] ?? undefined,
        };
        const report = await addMissingReportSync({ ...input, reportingCenter: centerId });
        setSuccess(report.id);
        onSubmitted({ refId: report.id, type: "missing-report" });
      } else {
        const input: RegisterFoundPersonInput = {
          ageRange,
          gender,
          clothingDescription: clothing,
          foundZone: whereFound,
          centerId,
          languageSpoken: language,
          condition,
          photoProvided: !!photoPreview,
          photoBase64: photoPreview?.split(",")[1] ?? undefined,
          // Care disposition
          familyExpected,
          disposition: familyExpected ? "active" : disposition,
          dispositionNotes: familyExpected ? undefined : dispositionNotes,
          // Minor flags
          isMinorUnaccompanied: isChild,
          childKnowsName: isChild ? (childKnowsName ?? undefined) : undefined,
          childHometown: isChild && childHometown ? childHometown : undefined,
        };
        const fp = await addFoundPersonSync(input);
        setSuccess(fp.id);
        onSubmitted({ refId: fp.id, type: "found-person" });
      }
    } catch (err) {
      setErrors({ submit: String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    color: "#374151",
    display: "block",
    marginBottom: 4,
  };

  const fieldStyle: React.CSSProperties = {
    marginBottom: 14,
  };

  const errStyle: React.CSSProperties = {
    fontSize: 12,
    color: "#dc2626",
    marginTop: 3,
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (success) {
    return (
      <div style={{ padding: 20 }}>
        <div style={{
          background: "#f0fdf4",
          border: "1.5px solid #16a34a",
          borderRadius: 10,
          padding: "16px 20px",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}>
          <span style={{ fontSize: 24 }}>✅</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#15803d" }}>Registered: {success}</div>
            <div style={{ fontSize: 13, color: "#166534", marginTop: 2 }}>
              {mode === "help-family" ? "Missing person report filed." : "Found person registered and being matched."}
            </div>
          </div>
        </div>
        <button
          onClick={() => {
            setSuccess(null);
            setClothing("");
            setWhereFound("");
            setContactNumber("");
            setPhotoPreview(null);
            setMissingPhotoPreview(null);
            setMissingClothing("");
            setMissingName("");
            setReporterName("");
            setReporterPhone("");
            setLastSeenZone("");
            setFamilyExpected(true);
            setDisposition("active");
            setDispositionNotes("");
            setChildKnowsName(null);
            setChildHometown("");
            setIconMode(false);
          }}
          style={{ marginTop: 16, padding: "8px 16px", background: "#2563eb", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14 }}
        >
          + Register another
        </button>
      </div>
    );
  }

  // ── Icon mode selector component ────────────────────────────────────────
  function IconGrid<T extends string>({
    options, value, onChange,
  }: {
    options: { value: T; icon: string; label: string }[];
    value: T;
    onChange: (v: T) => void;
  }) {
    return (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {options.map(o => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            style={{
              flex: "1 1 60px",
              padding: "10px 6px",
              background: value === o.value ? "#dbeafe" : "#f3f4f6",
              border: `2px solid ${value === o.value ? "#2563eb" : "#e5e7eb"}`,
              borderRadius: 10,
              cursor: "pointer",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 22 }}>{o.icon}</div>
            <div style={{ fontSize: 10, color: "#374151", marginTop: 2, fontWeight: value === o.value ? 700 : 400 }}>{o.label}</div>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div style={{ padding: 16, overflowY: "auto", flex: 1 }}>
      <form onSubmit={handleSubmit} noValidate>

        {/* ── HELP-FAMILY mode ── */}
        {mode === "help-family" && (
          <>
            <div style={{ marginBottom: 18, padding: "10px 14px", background: "#f0f9ff", borderRadius: 8, fontSize: 13, color: "#0369a1" }}>
              👨‍👩‍👧 A family member is reporting a missing person. Fill in the details below.
            </div>

            <div style={{ fontWeight: 700, fontSize: 13, color: "#374151", marginBottom: 10 }}>Reporter Details</div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Reporter Name</label>
              <input style={inputStyle} value={reporterName} onChange={e => setReporterName(e.target.value)} placeholder="Full name of the person reporting" />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Reporter Phone <span style={{ color: "#dc2626" }}>*</span></label>
              <input
                style={{ ...inputStyle, borderColor: errors.reporterPhone ? "#dc2626" : "#d1d5db" }}
                type="tel"
                maxLength={10}
                value={reporterPhone}
                onChange={e => setReporterPhone(e.target.value.replace(/\D/g, ""))}
                placeholder="10-digit mobile number"
              />
              {errors.reporterPhone && <div style={errStyle}>{errors.reporterPhone}</div>}
            </div>

            <div style={{ fontWeight: 700, fontSize: 13, color: "#374151", margin: "16px 0 10px" }}>Missing Person Details</div>

            {/* Photo upload for missing person */}
            <div style={fieldStyle}>
              <label style={labelStyle}>Photo of Missing Person (optional — AI auto-fills description)</label>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div>
                  <input ref={missingFileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleMissingPhotoUpload} />
                  <button type="button" onClick={() => missingFileInputRef.current?.click()} style={{ padding: "8px 14px", background: "#f3f4f6", border: "1.5px dashed #9ca3af", borderRadius: 6, cursor: "pointer", fontSize: 13, color: "#374151" }}>
                    📷 Upload Photo
                  </button>
                  {missingPhotoAnalyzing && (
                    <div style={{ marginTop: 6, fontSize: 12, color: "#7c3aed", display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="spinner" style={{ width: 14, height: 14 }} /> Analyzing with AI…
                    </div>
                  )}
                </div>
                {missingPhotoPreview && (
                  <img src={missingPhotoPreview} alt="Preview" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 6, border: "1px solid #e5e7eb" }} />
                )}
              </div>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Name (optional)</label>
              <input style={inputStyle} value={missingName} onChange={e => setMissingName(e.target.value)} placeholder="Missing person's name if known" />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={fieldStyle}>
                <label style={labelStyle}>Age Range</label>
                <select style={inputStyle} value={missingAgeRange} onChange={e => setMissingAgeRange(e.target.value as AgeRange)}>
                  {AGE_RANGES.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Gender</label>
                <select style={inputStyle} value={missingGender} onChange={e => setMissingGender(e.target.value as Gender)}>
                  {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Clothing Description <span style={{ color: "#dc2626" }}>*</span></label>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <textarea
                    style={{ ...inputStyle, minHeight: 70, resize: "vertical", borderColor: errors.missingClothing ? "#dc2626" : "#d1d5db" }}
                    value={missingClothing}
                    onChange={e => setMissingClothing(e.target.value)}
                    placeholder="e.g. Blue kurta, white dhoti, orange shawl"
                  />
                  {errors.missingClothing && <div style={errStyle}>{errors.missingClothing}</div>}
                </div>
                <div style={{ position: "relative" }}>
                  <button type="button" onClick={handleMissingVoiceInput} title="Voice input" style={{ padding: "8px 10px", background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer", fontSize: 18, lineHeight: 1 }}>🎤</button>
                  {missingVoiceTooltip && (
                    <div style={{ position: "absolute", right: 0, top: "110%", background: "#1c1917", color: "white", fontSize: 11, padding: "5px 8px", borderRadius: 5, whiteSpace: "nowrap", zIndex: 10 }}>
                      {missingVoiceTooltip}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Last Seen Zone</label>
              <input style={inputStyle} value={lastSeenZone} onChange={e => setLastSeenZone(e.target.value)} placeholder="Where were they last seen?" />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Language Spoken</label>
              <select style={inputStyle} value={missingLanguage} onChange={e => setMissingLanguage(e.target.value as Language)}>
                {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </>
        )}

        {/* ── FOUND-PERSON / HELP-PERSON mode ── */}
        {(mode === "found-person" || mode === "help-person") && (
          <>
            <div style={{ marginBottom: 12, padding: "10px 14px", background: "#fff8f3", borderRadius: 8, fontSize: 13, color: "#92400e", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{mode === "found-person" ? "👤 Registering an unaccompanied person." : "🙋 A person is lost and needs to be registered."}</span>
              <button
                type="button"
                onClick={() => setIconMode(v => !v)}
                style={{ fontSize: 11, padding: "4px 10px", background: iconMode ? "#1d4ed8" : "#e2e8f0", color: iconMode ? "white" : "#374151", border: "none", borderRadius: 20, cursor: "pointer", fontWeight: 700, flexShrink: 0 }}
              >
                {iconMode ? "📝 Text Mode" : "🖼 Icon Mode"}
              </button>
            </div>

            {iconMode && (
              <div style={{ marginBottom: 12, padding: "8px 10px", background: "#f0f9ff", borderRadius: 8, fontSize: 12, color: "#0369a1" }}>
                Icon mode: tap icons for non-verbal / non-literate intake. No reading required.
              </div>
            )}

            {/* Photo upload */}
            <div style={fieldStyle}>
              <label style={labelStyle}>Photo (optional — AI will auto-fill description)</label>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div>
                  <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhotoUpload} />
                  <button type="button" onClick={() => fileInputRef.current?.click()} style={{ padding: "8px 14px", background: "#f3f4f6", border: "1.5px dashed #9ca3af", borderRadius: 6, cursor: "pointer", fontSize: 13, color: "#374151" }}>
                    📷 Upload Photo
                  </button>
                  {photoAnalyzing && (
                    <div style={{ marginTop: 6, fontSize: 12, color: "#7c3aed", display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="spinner" style={{ width: 14, height: 14 }} /> Analyzing with AI…
                    </div>
                  )}
                </div>
                {photoPreview && <img src={photoPreview} alt="Preview" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 6, border: "1px solid #e5e7eb" }} />}
              </div>
            </div>

            {/* Age Range */}
            <div style={fieldStyle}>
              <label style={labelStyle}>Age Range</label>
              {iconMode
                ? <IconGrid options={AGE_ICONS} value={ageRange} onChange={v => setAgeRange(v as AgeRange)} />
                : <select style={inputStyle} value={ageRange} onChange={e => setAgeRange(e.target.value as AgeRange)}>
                    {AGE_RANGES.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
              }
            </div>

            {/* Gender */}
            <div style={fieldStyle}>
              <label style={labelStyle}>Gender</label>
              {iconMode
                ? <IconGrid options={GENDER_ICONS} value={gender} onChange={v => setGender(v as Gender)} />
                : <select style={inputStyle} value={gender} onChange={e => setGender(e.target.value as Gender)}>
                    {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
              }
            </div>

            {/* Condition */}
            <div style={fieldStyle}>
              <label style={labelStyle}>Condition</label>
              {iconMode
                ? <IconGrid options={CONDITION_ICONS} value={condition} onChange={v => setCondition(v as Condition)} />
                : <select style={inputStyle} value={condition} onChange={e => setCondition(e.target.value as Condition)}>
                    {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
              }
            </div>

            {/* Child-specific fields */}
            {isChild && (
              <div style={{ background: "#fef9c3", border: "1px solid #fde047", borderRadius: 8, padding: "12px 14px", marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#854d0e", marginBottom: 8 }}>⚠️ Unaccompanied Minor — Extra Details</div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Does the child know their name?</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    {[{ v: true, l: "✅ Yes" }, { v: false, l: "❌ No" }].map(({ v, l }) => (
                      <button key={String(v)} type="button" onClick={() => setChildKnowsName(v)}
                        style={{ flex: 1, padding: "6px 10px", background: childKnowsName === v ? "#fde047" : "#f3f4f6", border: `2px solid ${childKnowsName === v ? "#ca8a04" : "#e5e7eb"}`, borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: childKnowsName === v ? 700 : 400 }}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>School / city / hometown mentioned?</label>
                  <input style={inputStyle} value={childHometown} onChange={e => setChildHometown(e.target.value)} placeholder="e.g. St Mary's School, Pune" />
                </div>
              </div>
            )}

            <div style={fieldStyle}>
              <label style={labelStyle}>Clothing Description <span style={{ color: "#dc2626" }}>*</span></label>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div style={{ flex: 1, position: "relative" }}>
                  <textarea
                    style={{ ...inputStyle, minHeight: 70, resize: "vertical", borderColor: errors.clothing ? "#dc2626" : "#d1d5db" }}
                    value={clothing}
                    onChange={e => setClothing(e.target.value)}
                    placeholder="e.g. Blue kurta, white dhoti, orange shawl"
                  />
                  {errors.clothing && <div style={errStyle}>{errors.clothing}</div>}
                </div>
                <div style={{ position: "relative" }}>
                  <button type="button" onClick={handleVoiceInput} title="Voice input" style={{ padding: "8px 10px", background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer", fontSize: 18, lineHeight: 1 }}>🎤</button>
                  {voiceTooltip && (
                    <div style={{ position: "absolute", right: 0, top: "110%", background: "#1c1917", color: "white", fontSize: 11, padding: "5px 8px", borderRadius: 5, whiteSpace: "nowrap", zIndex: 10 }}>{voiceTooltip}</div>
                  )}
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={fieldStyle}>
                <label style={labelStyle}>Language Spoken</label>
                <select style={inputStyle} value={language} onChange={e => setLanguage(e.target.value as Language)}>
                  {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Where Found</label>
                <input style={inputStyle} value={whereFound} onChange={e => setWhereFound(e.target.value)} placeholder="Zone or location" />
              </div>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Contact Number (optional)</label>
              <input
                style={{ ...inputStyle, borderColor: errors.contactNumber ? "#dc2626" : "#d1d5db" }}
                type="tel" maxLength={10}
                value={contactNumber}
                onChange={e => setContactNumber(e.target.value.replace(/\D/g, ""))}
                placeholder="Their mobile if they have one"
              />
              {errors.contactNumber && <div style={errStyle}>{errors.contactNumber}</div>}
            </div>

            {/* Abandoned elderly — care disposition */}
            {mode === "help-person" && (
              <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "12px 14px", marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#14532d", marginBottom: 8 }}>♿ Family & Care Status</div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Is family expected to claim this person?</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    {[{ v: true, l: "👨‍👩‍👧 Yes — searching" }, { v: false, l: "🏥 No — needs care" }].map(({ v, l }) => (
                      <button key={String(v)} type="button" onClick={() => setFamilyExpected(v)}
                        style={{ flex: 1, padding: "7px 6px", background: familyExpected === v ? "#dcfce7" : "#f3f4f6", border: `2px solid ${familyExpected === v ? "#16a34a" : "#e5e7eb"}`, borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: familyExpected === v ? 700 : 400 }}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                {!familyExpected && (
                  <>
                    <div style={fieldStyle}>
                      <label style={labelStyle}>Care Disposition</label>
                      <select style={inputStyle} value={disposition} onChange={e => setDisposition(e.target.value as typeof disposition)}>
                        <option value="care-arranged">🏠 Care arranged — shelter</option>
                        <option value="medical-referral">🏥 Medical referral</option>
                        <option value="transferred-shelter">🚌 Transferred to welfare shelter</option>
                      </select>
                    </div>
                    <div style={fieldStyle}>
                      <label style={labelStyle}>Notes (facility name, contact, etc.)</label>
                      <textarea style={{ ...inputStyle, minHeight: 54, resize: "vertical" }} value={dispositionNotes} onChange={e => setDispositionNotes(e.target.value)} placeholder="e.g. Transferred to Nashik Civil Hospital, ward 4" />
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {errors.submit && (
          <div style={{ ...errStyle, marginBottom: 12, padding: "8px 12px", background: "#fef2f2", borderRadius: 6 }}>
            {errors.submit}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          style={{
            width: "100%",
            padding: "11px",
            background: submitting ? "#9ca3af" : "#16a34a",
            color: "white",
            border: "none",
            borderRadius: 8,
            fontSize: 15,
            fontWeight: 700,
            cursor: submitting ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          {submitting ? (
            <>
              <span className="spinner" style={{ width: 16, height: 16, borderColor: "rgba(255,255,255,.3)", borderTopColor: "white" }} />
              Registering…
            </>
          ) : (
            mode === "help-family" ? "📝 Submit Missing Report" : "✅ Register Person"
          )}
        </button>
      </form>
    </div>
  );
}
