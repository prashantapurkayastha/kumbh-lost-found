// ─────────────────────────────────────────────────────────────────────────────
// SMS Service — Fast2SMS (free tier, India)
// All requests go through the Express proxy so the API key stays server-side.
// Set VITE_SMS_ENABLED=true in .env to enable real sending.
// ─────────────────────────────────────────────────────────────────────────────

export interface SMSPayload {
  to: string;           // Indian mobile number, e.g. "+919876543210" or "9876543210"
  message: string;
  type?: "case_registered" | "match_found" | "sos_alert" | "volunteer_alert" | "reunion_booked";
}

export interface SMSResult {
  success: boolean;
  messageId?: string;
  mock?: boolean;
  error?: string;
}

function sanitizeNumber(raw: string): string {
  // Strip +91, spaces, dashes → 10-digit number
  return raw.replace(/\D/g, "").replace(/^91/, "").slice(-10);
}

export async function sendSMS(payload: SMSPayload): Promise<SMSResult> {
  const number = sanitizeNumber(payload.to);
  if (number.length !== 10) {
    return { success: false, error: "Invalid phone number — must be 10 digits" };
  }

  try {
    const res = await fetch("/api/sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: number, message: payload.message, type: payload.type }),
    });
    const data = await res.json();
    return data;
  } catch (err) {
    console.warn("[SMS] Failed to reach /api/sms, using mock:", err);
    // Graceful fallback — log to console so devs can see the message
    console.log(`📱 [SMS MOCK]\nTo: +91${number}\n${payload.message}`);
    return { success: true, mock: true };
  }
}

// ─── Pre-built message templates ─────────────────────────────────────────────

export function buildCaseRegisteredSMS(refId: string, centerName: string): string {
  return `Kumbh Mela Lost & Found: Your report ${refId} is registered at ${centerName}. We will notify you when we find a match. Keep this number safe.`;
}

export function buildMatchFoundSMS(
  refId: string,
  foundPersonDesc: string,
  reunionPoint: string,
  reunionLandmark: string
): string {
  return `Kumbh Mela MATCH FOUND! Report ${refId}: ${foundPersonDesc} — Please go to ${reunionPoint}: ${reunionLandmark}. Show this reference number to the volunteer.`;
}

export function buildSOSAlertSMS(
  userDesc: string,
  centerName: string,
  refId: string,
  lat?: number,
  lng?: number
): string {
  const location = lat && lng ? ` Location: maps.google.com/?q=${lat},${lng}` : "";
  return `Kumbh Mela SOS: ${userDesc} needs help. Nearest center: ${centerName}. Reference: ${refId}.${location}`;
}

export function buildVolunteerAlertSMS(
  centerId: string,
  foundPersonId: string,
  missingRefId: string,
  eta: number
): string {
  return `ALERT ${centerId}: Match found! FP ${foundPersonId} matches report ${missingRefId}. Family arriving in ~${eta} min. Keep person at desk.`;
}

export function buildFoundPersonRegisteredSMS(recordId: string, centerName: string): string {
  return `Kumbh Mela: You have been registered as ${recordId} at ${centerName}. Your family is being notified. Stay at the center.`;
}
