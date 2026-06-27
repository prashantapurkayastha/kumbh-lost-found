import { getLoadColor, type NearbyCenter } from "../services/location";

interface Props {
  centers: NearbyCenter[];
  onSelect?: (center: NearbyCenter) => void;
}

export default function NearbyDesks({ centers, onSelect }: Props) {
  if (centers.length === 0) {
    return (
      <p style={{ fontSize: 13, color: "#a8a29e", textAlign: "center", padding: "12px 0" }}>
        Locating nearest centers…
      </p>
    );
  }

  return (
    <div>
      {centers.map((c) => {
        const loadColor = getLoadColor(c.currentLoad, c.capacity);
        return (
          <div
            key={c.id}
            className="desk-item"
            onClick={() => onSelect?.(c)}
            style={{ cursor: onSelect ? "pointer" : "default" }}
          >
            <div className="desk-icon">🏥</div>
            <div style={{ flex: 1 }}>
              <div className="desk-name">{c.name}</div>
              <div className="desk-meta">
                📍 {c.distanceKm} km · 🚶 {c.walkingMinutes} min
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
              <div
                style={{
                  width: 8, height: 8,
                  borderRadius: "50%",
                  background: loadColor,
                }}
              />
              {c.contactNumber && (
                <a
                  href={`tel:${c.contactNumber}`}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    fontSize: 11, color: "#2563eb", textDecoration: "underline",
                  }}
                >
                  Call
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
