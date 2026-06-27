import express from "express";
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

app.use(cors());
app.use(express.json({ limit: "20mb" })); // large limit for base64 photos

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    model: "claude-sonnet-4-6",
    apiKeyConfigured: !!process.env.ANTHROPIC_API_KEY,
  });
});

// ── Claude proxy ──────────────────────────────────────────────────────────────
// All Claude calls go through here so the API key never touches the browser.
app.post("/api/claude", async (req, res) => {
  const { system, tools, messages, max_tokens = 4096 } = req.body;

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

// POST /api/registry/found-persons — register a found person
app.post("/api/registry/found-persons", (req, res) => {
  const input = req.body as RegisterFoundPersonInput;
  if (!input.ageRange || !input.gender || !input.clothingDescription || !input.foundZone || !input.centerId) {
    return res.status(400).json({ error: "Missing required fields: ageRange, gender, clothingDescription, foundZone, centerId" });
  }
  const fp = store.addFoundPerson(input);
  return res.status(201).json(fp);
});

// POST /api/registry/missing-reports — register a missing person report
app.post("/api/registry/missing-reports", (req, res) => {
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

// ── Serve built frontend in production ───────────────────────────────────────
if (process.env.NODE_ENV === "production") {
  const distPath = path.join(__dirname, "../dist");
  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`[server] running on http://localhost:${PORT}`);
  console.log(`[server] API key: ${process.env.ANTHROPIC_API_KEY ? "✓ configured" : "✗ MISSING — set ANTHROPIC_API_KEY in .env"}`);
});
