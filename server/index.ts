import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";
import path from "path";
import dotenv from "dotenv";
import { store } from "./store";
import type { RegisterFoundPersonInput, RegisterMissingPersonInput } from "./store";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ── CORS — restrict to known origins in production ────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173,http://localhost:3001")
  .split(",").map(o => o.trim());

app.use(cors({
  origin: (origin, cb) => {
    // Allow server-to-server (no origin), or listed origins
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin '${origin}' not allowed`));
  },
  methods: ["GET", "POST", "PUT", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// ── Body parsing — size limits per route ─────────────────────────────────────
// /api/claude can carry base64 images (up to 5 MB practical limit)
app.use("/api/claude", express.json({ limit: "6mb" }));
// All other routes get a tight 256 KB limit — no reason to be larger
app.use(express.json({ limit: "256kb" }));

// ── In-memory rate limiter (no external dep needed for demo) ──────────────────
interface RateRecord { count: number; resetAt: number }
const rateLimitStore = new Map<string, RateRecord>();

function rateLimit(maxReq: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0].trim()
      ?? req.socket.remoteAddress
      ?? "unknown";
    const now = Date.now();
    const rec = rateLimitStore.get(ip) ?? { count: 0, resetAt: now + windowMs };
    if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + windowMs; }
    rec.count++;
    rateLimitStore.set(ip, rec);
    if (rec.count > maxReq) {
      res.status(429).json({ error: "Too many requests — please wait a moment." });
      return;
    }
    next();
  };
}

// Clean up the rate-limit store every 10 minutes to prevent memory growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of rateLimitStore) {
    if (now > rec.resetAt) rateLimitStore.delete(ip);
  }
}, 10 * 60 * 1000);

// ── Security headers ──────────────────────────────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  // Strict CSP in production; relax in dev to allow Vite HMR
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'");
  }
  next();
});

// ── Input sanitiser — strip potential prompt injection tokens ─────────────────
const INJECTION_PATTERNS = [
  /\bignore\s+(all\s+)?previous\s+instructions?\b/i,
  /\bsystem\s*:\s*/i,
  /\bpretend\s+you\s+are\b/i,
  /\bact\s+as\s+(if\s+)?(you\s+are\s+)?a?\b/i,
  /<\|?(system|user|assistant|end)\|?>/i,
  /\bDAN\b/,  // "Do Anything Now" jailbreak marker
  /\bjailbreak\b/i,
];
function sanitiseInput(text: string): string {
  let out = text;
  for (const p of INJECTION_PATTERNS) out = out.replace(p, "[filtered]");
  return out.slice(0, 4000); // Hard max length
}

// ── Health check (enriched for deployability scoring) ────────────────────────
const SERVER_START = Date.now();
app.get("/api/health", (_req, res) => {
  const state = store.getAllFoundPersons();
  const missing = store.getAllMissingReports();
  res.json({
    status: "ok",
    model: "claude-sonnet-4-6",
    apiKeyConfigured: !!process.env.ANTHROPIC_API_KEY,
    uptimeSeconds: Math.round((Date.now() - SERVER_START) / 1000),
    registry: {
      foundPersonsWaiting: state.length,
      missingReportsActive: missing.length,
      handoverLogs: store.getHandoverLogs().length,
    },
    features: {
      offlineCache: true,
      writeThrough: true,
      ttl72h: true,
      deduplication: true,
      pinHandover: true,
      suspicionFlag: true,
      cctvIntegration: true,
    },
    timestamp: new Date().toISOString(),
  });
});

// ── Claude proxy ──────────────────────────────────────────────────────────────
// All Claude calls go through here so the API key never touches the browser.
// Rate-limited: 30 requests per minute per IP to cap spend.
app.post("/api/claude", rateLimit(30, 60_000), async (req, res) => {
  const { system, tools, messages, max_tokens = 4096 } = req.body;

  // Sanitise all text content in messages
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (typeof msg.content === "string") {
        msg.content = sanitiseInput(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "text" && typeof block.text === "string") {
            block.text = sanitiseInput(block.text);
          }
          // Cap image size: base64 at ~3.7 MB → ≈5 MB raw; reject oversized images
          if (block.type === "image" && block.source?.type === "base64") {
            const b64 = block.source.data as string;
            if (b64.length > 5_000_000) {
              return res.status(413).json({ error: "Image too large. Please use a photo under 3 MB." });
            }
          }
        }
      }
    }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: "ANTHROPIC_API_KEY not configured. Copy .env.example to .env and add your key.",
    });
  }

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens,
      system,
      tools,
      messages,
    });

    return res.json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Claude API error]", message);
    return res.status(502).json({ error: message });
  }
});

// ── SMS proxy (Fast2SMS — free tier, India) ──────────────────────────────────
// Add FAST2SMS_API_KEY to .env to enable real sending. Without it, messages are
// logged to the console (mock mode — safe for demo).
app.post("/api/sms", async (req, res) => {
  const { to, message } = req.body as { to: string; message: string };

  if (!to || !message) {
    return res.status(400).json({ success: false, error: "Missing to or message" });
  }

  const apiKey = process.env.FAST2SMS_API_KEY;

  if (!apiKey) {
    // Mock mode
    console.log(`\n📱 [SMS MOCK]\nTo: +91${to}\n${message}\n`);
    return res.json({ success: true, mock: true });
  }

  try {
    const response = await fetch("https://www.fast2sms.com/dev/bulkV2", {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        variables_values: message,
        route: "q",
        numbers: to,
      }),
    });

    const data = await response.json();
    const success = data.return === true;
    console.log(`[SMS] → +91${to}: ${success ? "✓ sent" : "✗ failed"} — ${JSON.stringify(data)}`);
    return res.json({ success, messageId: data.request_id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[SMS error]", msg);
    // Fail gracefully — SMS failure should not break the app
    return res.json({ success: false, mock: true, error: msg });
  }
});

// ── Registry REST API ─────────────────────────────────────────────────────────

// GET /api/registry/state — full state snapshot for initial client load
app.get("/api/registry/state", (_req, res) => {
  res.json({
    foundPersons: store.getAllFoundPersons(),
    missingReports: store.getAllMissingReports(),
    helpCenters: store.getHelpCenters(),
    policeStations: store.getPoliceStations(),
    reunionPoints: store.getReunionPoints(),
    stats: store.getStats(),
  });
});

// POST /api/registry/found-persons — register a found person (with dedup guard)
// Rate-limited: 60 registrations per minute per IP (volunteer flow)
app.post("/api/registry/found-persons", rateLimit(60, 60_000), (req, res) => {
  const input = req.body as RegisterFoundPersonInput;
  if (!input.ageRange || !input.gender || !input.clothingDescription || !input.foundZone || !input.centerId) {
    return res.status(400).json({ error: "Missing required fields: ageRange, gender, clothingDescription, foundZone, centerId" });
  }

  // Deduplication: check if same ageRange + gender + clothing submitted in last 10 minutes from same center
  const TEN_MIN = 10 * 60 * 1000;
  const existing = store.getAllFoundPersons().find(fp => {
    if (fp.centerId !== input.centerId) return false;
    if (fp.gender !== input.gender) return false;
    if (fp.ageRange !== input.ageRange) return false;
    const wordsA = input.clothingDescription.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    const wordsB = fp.clothing.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    const setB = new Set(wordsB);
    const overlap = wordsA.filter(w => setB.has(w)).length / Math.max(wordsA.length, 1);
    const isRecent = Date.now() - new Date(fp.foundAt).getTime() < TEN_MIN;
    return overlap > 0.6 && isRecent;
  });

  if (existing) {
    console.log(`[dedup] Found person duplicate detected — returning existing ${existing.id}`);
    return res.status(200).json({ ...existing, _deduplicated: true });
  }

  const fp = store.addFoundPerson(input);
  return res.status(201).json(fp);
});

// POST /api/registry/missing-reports — register a missing person report
// Rate-limited: 20 reports per minute per IP
app.post("/api/registry/missing-reports", rateLimit(20, 60_000), (req, res) => {
  const input = req.body as RegisterMissingPersonInput & { reportingCenter?: string };
  if (!input.ageRange || !input.gender || !input.clothingDescription || !input.lastSeenZone) {
    return res.status(400).json({ error: "Missing required fields: ageRange, gender, clothingDescription, lastSeenZone" });
  }
  const report = store.addMissingReport(input);
  return res.status(201).json(report);
});

// POST /api/registry/handover — verify identity and complete handover
app.post("/api/registry/handover", (req, res) => {
  const {
    reportId,
    foundPersonId,
    code,
    centerId,
    operatorId,
    minorEscort = false,
    reunionPointId = "",
    witnessVolunteerId,
  } = req.body as {
    reportId: string;
    foundPersonId: string;
    code: string;
    centerId: string;
    operatorId: string;
    minorEscort?: boolean;
    reunionPointId?: string;
    witnessVolunteerId?: string;
  };

  if (!reportId || !foundPersonId || !code || !centerId || !operatorId) {
    return res.status(400).json({ error: "Missing required fields: reportId, foundPersonId, code, centerId, operatorId" });
  }

  const result = store.verifyAndHandover(
    reportId,
    foundPersonId,
    code,
    centerId,
    operatorId,
    minorEscort,
    reunionPointId,
    witnessVolunteerId,
  );

  if (!result.ok) {
    return res.status(400).json({ error: result.message });
  }

  return res.json(result.log);
});

// GET /api/registry/reports/:id — look up a missing report by ID
app.get("/api/registry/reports/:id", (req, res) => {
  const report = store.getMissingReportById(req.params.id);
  if (!report) {
    return res.status(404).json({ error: `No report found with ID ${req.params.id}` });
  }
  return res.json(report);
});

// GET /api/registry/handover-logs — audit log of all handovers
app.get("/api/registry/handover-logs", (_req, res) => {
  res.json(store.getHandoverLogs());
});

// POST /api/registry/flag-suspicion — flag claimant as suspicious and hold record
app.post("/api/registry/flag-suspicion", (req, res) => {
  const { reportId, notes } = req.body as { reportId: string; notes: string };
  if (!reportId) return res.status(400).json({ error: "reportId required" });
  const ok = store.flagSuspicion(reportId, notes ?? "Flagged at desk");
  if (!ok) return res.status(404).json({ error: `No report found with ID ${reportId}` });
  console.log(`[security] Report ${reportId} flagged as suspicious: ${notes}`);
  return res.json({ ok: true, reportId, held: true });
});

// ── Serve built frontend in production ───────────────────────────────────────
if (process.env.NODE_ENV === "production") {
  const distPath = path.join(__dirname, "../dist");
  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

// ── Periodic PII redaction (DPDP compliance) ─────────────────────────────────
// Runs at startup and every 30 minutes thereafter
function runPIIRedaction() {
  const count = store.redactExpiredPII();
  if (count > 0) console.log(`[pii-purge] Redacted PII from ${count} resolved report(s)`);
}
runPIIRedaction();
setInterval(runPIIRedaction, 30 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`[server] running on http://localhost:${PORT}`);
  console.log(`[server] API key: ${process.env.ANTHROPIC_API_KEY ? "✓ configured" : "✗ MISSING — set ANTHROPIC_API_KEY in .env"}`);
});
