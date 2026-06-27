// ─────────────────────────────────────────────────────────────────────────────
// Icons — inline SVG components for consistent, illustration-quality graphics.
// All icons accept size (default 48) and color. No external dependencies.
// ─────────────────────────────────────────────────────────────────────────────

interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

// ── Person silhouettes ────────────────────────────────────────────────────────

export function PersonMaleIcon({ size = 48, color = "#1d4ed8" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="13" r="8" fill={color} fillOpacity=".15" stroke={color} strokeWidth="2"/>
      <path d="M10 44c0-7.732 6.268-14 14-14s14 6.268 14 14" stroke={color} strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

export function PersonFemaleIcon({ size = 48, color = "#db2777" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="12" r="8" fill={color} fillOpacity=".15" stroke={color} strokeWidth="2"/>
      <path d="M16 28h16M24 20v20M18 48h12" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      {/* skirt */}
      <path d="M14 30c0 0 2 10 10 10s10-10 10-10" stroke={color} strokeWidth="2" strokeLinecap="round" fill={color} fillOpacity=".1"/>
    </svg>
  );
}

export function PersonUnknownIcon({ size = 48, color = "#78716c" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="13" r="8" fill={color} fillOpacity=".12" stroke={color} strokeWidth="2" strokeDasharray="4 2"/>
      <path d="M10 44c0-7.732 6.268-14 14-14s14 6.268 14 14" stroke={color} strokeWidth="2" strokeLinecap="round" strokeDasharray="4 2"/>
      <text x="24" y="15" textAnchor="middle" fontSize="10" fill={color} fontWeight="700">?</text>
    </svg>
  );
}

// ── Search person — family looking for someone ────────────────────────────────
export function SearchPersonIcon({ size = 56, color = "#1d4ed8" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* person circle */}
      <circle cx="22" cy="22" r="14" fill={color} fillOpacity=".08" stroke={color} strokeWidth="2.5"/>
      {/* person */}
      <circle cx="22" cy="17" r="5" fill={color} fillOpacity=".2" stroke={color} strokeWidth="1.5"/>
      <path d="M13 30c0-5 4-8 9-8s9 3 9 8" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
      {/* magnifier handle */}
      <line x1="32" y1="32" x2="44" y2="44" stroke={color} strokeWidth="3" strokeLinecap="round"/>
      {/* magnifier glass */}
      <circle cx="22" cy="22" r="14" stroke={color} strokeWidth="2.5"/>
    </svg>
  );
}

// ── Lost person — person with question mark ───────────────────────────────────
export function LostPersonIcon({ size = 56, color = "#f97316" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* body */}
      <circle cx="24" cy="16" r="7" fill={color} fillOpacity=".15" stroke={color} strokeWidth="2"/>
      <path d="M10 40c0-7.7 6.3-14 14-14s14 6.3 14 14" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      {/* question bubble */}
      <circle cx="42" cy="14" r="10" fill="#fff7ed" stroke={color} strokeWidth="2"/>
      <text x="42" y="19" textAnchor="middle" fontSize="13" fill={color} fontWeight="800">?</text>
    </svg>
  );
}

// ── Microphone ────────────────────────────────────────────────────────────────
export function MicrophoneIcon({ size = 32, color = "#f97316" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="11" y="2" width="10" height="16" rx="5" fill={color} fillOpacity=".2" stroke={color} strokeWidth="2"/>
      <path d="M6 16a10 10 0 0020 0" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      <line x1="16" y1="26" x2="16" y2="30" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      <line x1="10" y1="30" x2="22" y2="30" stroke={color} strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

// ── Microphone (large, for voice-first button) ────────────────────────────────
export function MicLargeIcon({ size = 48, color = "white" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="16" y="4" width="16" height="24" rx="8" fill={color} fillOpacity=".25" stroke={color} strokeWidth="2.5"/>
      <path d="M8 24c0 8.837 7.163 16 16 16s16-7.163 16-16" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="24" y1="40" x2="24" y2="46" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="14" y1="46" x2="34" y2="46" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  );
}

// ── SOS / Alert ───────────────────────────────────────────────────────────────
export function SOSIcon({ size = 40, color = "white" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 4L4 34h32L20 4z" fill={color} fillOpacity=".2" stroke={color} strokeWidth="2.5" strokeLinejoin="round"/>
      <text x="20" y="30" textAnchor="middle" fontSize="14" fill={color} fontWeight="800">!</text>
    </svg>
  );
}

// ── Help desk / Hospital ──────────────────────────────────────────────────────
export function HelpDeskIcon({ size = 48, color = "#1d4ed8" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* building */}
      <rect x="6" y="16" width="36" height="28" rx="2" fill={color} fillOpacity=".1" stroke={color} strokeWidth="2"/>
      {/* roof */}
      <path d="M3 18L24 6l21 12" stroke={color} strokeWidth="2" strokeLinejoin="round"/>
      {/* cross */}
      <line x1="24" y1="22" x2="24" y2="32" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="19" y1="27" x2="29" y2="27" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  );
}

// ── Volunteer / Hands raised ──────────────────────────────────────────────────
export function VolunteerIcon({ size = 48, color = "#16a34a" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="12" r="7" fill={color} fillOpacity=".15" stroke={color} strokeWidth="2"/>
      {/* raised hand left */}
      <path d="M14 22l-6-4" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      {/* body */}
      <path d="M14 22h20" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      {/* raised hand right */}
      <path d="M34 22l6-4" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      {/* legs */}
      <path d="M18 22l-2 14M30 22l2 14" stroke={color} strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

// ── Heartbeat / Care ──────────────────────────────────────────────────────────
export function CareIcon({ size = 48, color = "#dc2626" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M24 38S8 28 8 16a8 8 0 0116-4l0 0a8 8 0 0116 4c0 12-16 22-16 22z" fill={color} fillOpacity=".15" stroke={color} strokeWidth="2"/>
      <path d="M14 22h5l3-5 4 10 3-5h5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ── Child / Minor ────────────────────────────────────────────────────────────
export function ChildIcon({ size = 36, color = "#f59e0b" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="18" cy="10" r="6" fill={color} fillOpacity=".2" stroke={color} strokeWidth="1.5"/>
      <path d="M8 32c0-5.523 4.477-10 10-10s10 4.477 10 10" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
      {/* star */}
      <path d="M18 2l1 2h2l-1.5 1.5.5 2L18 6.5l-2 1 .5-2L15 4h2l1-2z" fill={color}/>
    </svg>
  );
}

// ── Elderly / Senior ──────────────────────────────────────────────────────────
export function ElderlyIcon({ size = 36, color = "#7c3aed" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="18" cy="9" r="6" fill={color} fillOpacity=".15" stroke={color} strokeWidth="1.5"/>
      <path d="M10 30c0-4.4 3.6-8 8-8s8 3.6 8 8" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
      {/* cane */}
      <path d="M24 22l4 10" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

// ── Camera / CCTV ─────────────────────────────────────────────────────────────
export function CameraIcon({ size = 32, color = "#7c3aed" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="8" width="22" height="16" rx="3" fill={color} fillOpacity=".1" stroke={color} strokeWidth="2"/>
      <circle cx="13" cy="16" r="4" stroke={color} strokeWidth="1.5"/>
      <path d="M24 12l6-4v12l-6-4" stroke={color} strokeWidth="2" strokeLinejoin="round"/>
    </svg>
  );
}

// ── Reunion / Handshake ───────────────────────────────────────────────────────
export function ReunionIcon({ size = 48, color = "#16a34a" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* two people */}
      <circle cx="14" cy="12" r="6" fill={color} fillOpacity=".15" stroke={color} strokeWidth="1.5"/>
      <circle cx="34" cy="12" r="6" fill={color} fillOpacity=".15" stroke={color} strokeWidth="1.5"/>
      {/* arms reaching */}
      <path d="M8 26c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M28 26c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
      {/* handshake */}
      <path d="M20 28h8" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M16 32l4-4h8l4 4" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
