import { SUPPORTED_LANGUAGES } from "../services/speech";

interface Props {
  value: string;
  onChange: (code: string) => void;
  compact?: boolean;
}

export default function LanguageSelector({ value, onChange, compact }: Props) {
  if (compact) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: "6px 10px",
          borderRadius: 20,
          border: "1.5px solid #e7e5e4",
          fontSize: 13,
          fontWeight: 600,
          background: "white",
          color: "#1c1917",
          cursor: "pointer",
        }}
      >
        {SUPPORTED_LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div>
      <p
        style={{
          fontSize: 12,
          color: "#78716c",
          marginBottom: 10,
          fontWeight: 600,
          textAlign: "center",
        }}
      >
        अपनी भाषा चुनें / Choose your language
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 8,
        }}
      >
        {SUPPORTED_LANGUAGES.map((l) => (
          <button
            key={l.code}
            onClick={() => onChange(l.code)}
            style={{
              padding: "10px 4px",
              borderRadius: 10,
              border: value === l.code ? "2px solid #f97316" : "1.5px solid #e7e5e4",
              background: value === l.code ? "#fff8f4" : "white",
              color: value === l.code ? "#f97316" : "#1c1917",
              fontWeight: value === l.code ? 700 : 500,
              fontSize: 14,
              cursor: "pointer",
              transition: "all .15s",
            }}
          >
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}
