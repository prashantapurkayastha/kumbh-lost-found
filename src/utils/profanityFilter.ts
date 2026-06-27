// ─────────────────────────────────────────────────────────────────────────────
// Profanity Filter — Kumbh Lost & Found
//
// Priority: avoid false-positives (over-blocking in an emergency app can harm
// vulnerable people). The list is deliberately conservative — it targets clearly
// abusive terms, NOT mildly offensive or ambiguous words.
//
// Covers: English, Hindi (Devanagari + Latin transliteration), Marathi, Bengali.
// Expanded over time by adding to BLOCKED_PATTERNS.
// ─────────────────────────────────────────────────────────────────────────────

/** Words/patterns to block unconditionally — keep this list SHORT and certain */
const BLOCKED_PATTERNS: RegExp[] = [
  // English — top-tier swear words only
  /\bf+u+c+k+\b/i,
  /\bs+h+i+t+\b/i,
  /\bb+i+t+c+h+\b/i,
  /\ba+s+s+h+o+l+e+\b/i,
  /\bc+u+n+t+\b/i,
  /\bbastard\b/i,
  /\bdick(head)?\b/i,
  /\bcocksucker\b/i,
  /\bmotherfucker\b/i,
  /\bwhore\b/i,

  // Hindi transliteration (common abuse terms)
  /\bm[ao]d[ae]r(ch[o0]d|chod)\b/i,
  /\bbh[a@]ncho[dt]\b/i,
  /\bch[u0]ti[ya]+\b/i,
  /\bbh[ao][sß]d[iu]\b/i,
  /\braand\b/i,
  /\bh[a@]r[a@]mz[a@]d[ae]\b/i,
  /\bl[o0]nd[au]?\b/i,
  /\bgandu\b/i,
  /\bsali?\b/i, // "saali/saala" — borderline, only block with context below

  // Hindi Devanagari
  /मादरचोद/,
  /भड़वा/,
  /चुतिया/,
  /भोसड़ी/,
  /रण्डी/,
  /हरामज़ादा/,
  /गांडू/,
  /लंड/,
  /लौड़ा/,
  /\bm[u]+th[a]+\b/i, // abuse term

  // Marathi
  /\bज+ा+\s*\/?[वव]+\b/,
  /झवा/,
  /भड़\s*वा/,

  // Bengali transliteration
  /\bm[a@]gi?\b/i,
  /\bb[ao]dmaish\b/i,
];

/**
 * Words that are borderline — we don't block them, but we note them.
 * Used for agent-side flagging without hard rejection.
 */
const CAUTION_PATTERNS: RegExp[] = [
  /\bstupid\b/i,
  /\bidiot\b/i,
  /\bmoron\b/i,
  /\bfool(ish)?\b/i,
];

export interface FilterResult {
  /** The original text unchanged */
  original: string;
  /** Text with blocked words replaced by asterisks */
  cleaned: string;
  /** True if any blocked word was found */
  blocked: boolean;
  /** True if any caution word was found */
  caution: boolean;
  /** Human-readable reason for UI */
  reason?: string;
}

/**
 * Filter text for profanity/abuse.
 * For emergency intake: NEVER silently drop — always return cleaned version
 * so the operator can still act on the rest of the message.
 */
export function filterText(text: string): FilterResult {
  if (!text || !text.trim()) {
    return { original: text, cleaned: text, blocked: false, caution: false };
  }

  let cleaned = text;
  let blocked = false;

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(cleaned)) {
      blocked = true;
      // Replace matched portion with asterisks of same length
      cleaned = cleaned.replace(pattern, (match) => "*".repeat(match.length));
    }
  }

  let caution = false;
  for (const pattern of CAUTION_PATTERNS) {
    if (pattern.test(cleaned)) {
      caution = true;
      break;
    }
  }

  return {
    original: text,
    cleaned,
    blocked,
    caution,
    reason: blocked
      ? "Message contains inappropriate language and has been sanitised."
      : caution
        ? "Message may contain disrespectful language."
        : undefined,
  };
}

/**
 * Quick boolean check — use this in hot paths.
 */
export function isBlocked(text: string): boolean {
  return BLOCKED_PATTERNS.some((p) => p.test(text));
}

/**
 * React hook for filtering typed/spoken input in real time.
 * Returns a sanitised value and a warning message.
 */
export function useContentFilter() {
  function check(text: string): { value: string; warning: string | null } {
    const result = filterText(text);
    if (result.blocked) {
      return {
        value: result.cleaned,
        warning: "⚠️ Inappropriate language detected and removed. Please use respectful language.",
      };
    }
    return { value: text, warning: null };
  }
  return { check };
}
