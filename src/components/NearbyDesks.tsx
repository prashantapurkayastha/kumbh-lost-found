import { getLoadColor, type NearbyCenter, type UserLocation } from "../services/location";
import { useLanguage } from "../context/LanguageContext";
import { t } from "../i18n/translations";

interface Props {
  centers: NearbyCenter[];
  userLocation?: UserLocation | null;
  onSelect?: (center: NearbyCenter) => void;
  selectedId?: string | null;
}

export default function NearbyDesks({ centers, onSelect, selectedId }: Props) {
  const { lang } = useLanguage();

  if (centers.length === 0) {
    return (
      <p style={{ fontSize: 13, color: "#a8a29e", textAlign: "center", padding: "12px 0" }}>
        {t("locatingCenters", lang)}
      </p>
    );
  }

  return (
    <div>
      {centers.map((c) => {
        const loadColor = getLoadColor(c.currentLoad, c.capacity);
        const isSelected = c.id === selectedId;
        return (
          <div
            key={c.id}
            className="desk-item"
            onClick={() => onSelect?.(c)}
            style={{
              cursor: onSelect ? "pointer" : "default",
              background: isSelected ? "#eff6ff" : undefined,
              border: isSelected ? "1px solid #93c5fd" : undefined,
              borderRadius: isSelected ? 10 : undefined,
            }}
          >
            <div className="desk-icon">🏥</div>
            <div style={{ flex: 1 }}>
              <div className="desk-name">{c.name}</div>
              <div className="desk-meta">
                📍 {c.distanceKm} {t("km", lang)} · 🚶 {c.walkingMinutes} {t("min", lang)}
              </div>
              <div className="desk-meta" style={{ marginTop: 4 }}>
                {c.languages.slice(0, 3).join(", ")}
                {c.languages.length > 3 && ` +${c.languages.length - 3} more`}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              <span style={{ fontSize: 12, color: loadColor, fontWeight: 700 }}>
                {c.currentLoad}/{c.capacity}
              </span>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: loadColor }} />
              {c.contactNumber && (
                <a
                  href={`tel:${c.contactNumber}`}
                  onClick={(e) => e.stopPropagation()}
                  style={{ fontSize: 11, color: "#2563eb", textDecoration: "underline" }}
                >
                  {t("call", lang)}
                </a>
              )}
              {onSelect && (
                <span style={{ fontSize: 11, color: "#2563eb" }}>
                  {isSelected ? `📍 ${t("shown", lang)}` : `🗺 ${t("getDirections", lang)}`}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
