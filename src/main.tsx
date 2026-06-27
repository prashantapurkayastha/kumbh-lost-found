import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { seedRegistry } from "./data/seed";
import { startQueueSync, type QueuedOperation } from "./services/offlineQueue";
import { seedDemoVolunteers } from "./services/volunteers";
import { startRegistrySync } from "./core/backends/registrySync";
import App from "./App";

// ── Seed local registry (fallback while server is unreachable) ────────────────
seedRegistry();
seedDemoVolunteers();

// ── Sync with server — server is canonical; overwrites seed on first response ─
startRegistrySync(3000);

// ── Start offline queue sync ──────────────────────────────────────────────────
startQueueSync(async (op: QueuedOperation) => {
  // Retry queued SMS
  if (op.type === "sms") {
    const res = await fetch("/api/sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(op.payload),
    });
    return res.ok;
  }
  return false;
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
