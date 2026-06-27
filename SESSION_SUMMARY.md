# Lost & Found Module — Session Summary
**Date:** 2026-06-27 | **Event:** Kumbh 2027 Claude Impact Lab, Nashik/Trimbakeshwar

---

## What Was Built

A full-stack hackathon demo for pilgrim reunification at Kumbh Mela. Stack: Vite + React + TypeScript + Express proxy → Claude Sonnet 4.6 with agentic tool-use.

---

## File Structure

```
src/
  types.ts                    ← All shared interfaces
  App.tsx                     ← Routes: / /volunteer /help-desk /registry
  main.tsx
  core/
    agent.ts                  ← Agentic tool-use loop (already built)
    backends/
      registry.ts             ← Single in-memory DB, all centers share it
      notify.ts               ← Fake SMS/push, renders in UI
      geo.ts                  ← Haversine, nearest-N, zone lookup
  components/
    ChatAgent.tsx             ← Tool-use chat UI + markdown renderer
    MapView.tsx               ← Leaflet + OSRM routing
    LanguageSelector.tsx
    NearbyDesks.tsx
    VoiceInput.tsx
  pages/
    PublicApp.tsx             ← Main pilgrim-facing app
    HelpDeskPanel.tsx         ← Operator kiosk
    VolunteerPanel.tsx        ← Volunteer tracking
    MissingRegistry.tsx       ← Live public registry /registry
  services/
    hotspots.ts               ← NEW: separation hotspot prediction
    location.ts               ← GPS with 80km Nashik sanity check
    volunteers.ts             ← localStorage cross-tab volunteer store
    offlineQueue.ts           ← Retry queue on navigator.online
    sms.ts                    ← Mock SMS (Twilio-ready stub)
    speech.ts
  tools/
    index.ts                  ← All 5 Claude tools
  data/
    seed.ts                   ← Loads SEED_DATA.json into registry
    cctv.json                 ← 208 camera locations
    chokepoints.json          ← 85 chokepoint locations
  i18n/
    translations.ts           ← mr/hi/en/gu/bn (others fall back to hi)
  hooks/
    useOnline.ts
  context/
    LanguageContext.tsx
```

---

## The 5 Claude Tools

| Tool | Purpose |
|---|---|
| `search_found_persons` | Searches across ALL centers simultaneously by description/age/clothing/zone/language/photo |
| `register_missing_person` | Creates report + 4-digit PIN + fires AMBER alerts to nearby volunteers |
| `register_found_person` | Registers found person at a desk + cross-checks missing reports |
| `notify_help_desk` | Sends alert to a specific center (e.g. "family en route") |
| `get_reunion_point` | Books a Milan Kendra meeting point, returns walking directions |

---

## Key Features Implemented

### Public App (`/`)
- **Screens:** landing → language → i-am-lost / report-missing → match-check → chat → result
- Pre-chat match-check: client-side `registry.searchFound()` before opening Claude
- `buildInitialPrompt()` packs all form data so Claude acts immediately (no re-asking)
- Photo attachment → base64 → sent in Claude message
- i18n: language persists across all screens; compact selector in every header
- SOS flow: shows status card + "Chat with agent" button (does NOT jump to result)
- AMBER alert fires on every new registration
- **🔵 Matching locally** badge always visible in header (offline-first signal)
- Offline banner shows queue count: "📵 Offline — matching locally · N reports queued"
- **Handover PIN** shown prominently on result screen (large monospace, amber box)
- Zone-masking on pre-check matches: shows "Ramkund area" not exact center name

### Help Desk Panel (`/help-desk`)
- **Tabs:** Queue · Register · Search · 🔐 Verify · 🧠 Intel · 🔔 Notifications · 📢 PSA
- Dummy auth: `helpdesk` / `kumbh2027`
- Queue tab: cross-references found↔missing in real time, shows ⚡ MATCH / ✅ FOUND badges
- **🔐 Verify tab:** operator enters Report ID + Found Person ID + 4-digit PIN → ✅/❌ result → "Confirm Release & Log Handover" button → marks report resolved
- **🧠 Intel tab:** hotspot map (risk circles + purple "DESK HERE" pins) + underserved zone list + suggested placement cards with coordinates
- **📢 PSA tab:** multilingual text-to-speech broadcaster (Web Speech API, 7 languages, templates for missing child/elder/general)

### Volunteer Panel (`/volunteer`)
- Dummy auth: `volunteer` / `kumbh2027`
- Shares location via localStorage (TTL 30 min), visible to all tabs
- Receives AMBER alerts when new case registered nearby

### Live Registry (`/registry`)
- Live-refresh every 3 seconds
- Missing tab: shows ALL entries including incomplete ones (blank fields render as "—")
- Found tab: **zone-masked** — shows "Ramkund area" not "Ramkund Help Center"
- Cross-match scoring: gender(0.25) + age(0.30) + clothing(0.30) + language(0.15)
- "Go there" buttons draw OSRM route on embedded map, scroll to top

### MapView (embedded Leaflet)
- CartoDB tiles, no API key
- OSRM walking routes (free, no key)
- Layers: user · centers · police · CCTV (208 cameras) · chokepoints (85) · hotspots · suggested desks · reunion points
- Route info pill (bottom-left): duration + distance

---

## Predator-Proofing (4-digit PIN system)

**How it works:**
1. `register_missing_person` calls `gen4PIN()` → stored as `report.verificationCode`
2. Claude returns PIN in tool output → shown on result screen as big bold code
3. Family must quote PIN in person at help desk
4. Operator enters it in 🔐 Verify tab → `registry.verifyHandover()` checks match
5. On confirm: `registry.logHandover()` marks report resolved, person released
6. `HandoverLog` records operator name, timestamp, center

**Public registry safety:** Found person cards show zone only ("Ramkund area"), not exact desk name or ID.

---

## Separation Hotspot Prediction (`src/services/hotspots.ts`)

**Algorithm:**
1. For each of 85 chokepoints, count neighbours (other chokepoints + sampled CCTV) within 400m
2. Normalise counts → density score 0–1 → risk: high (≥0.65) / medium (≥0.35) / low
3. Underserved = risk ≠ low AND nearest help center >600m away
4. Group underserved points into 600m clusters → centroid = suggested desk placement

**Demo story:** "We loaded official KML data. The algorithm predicted 3 zones where separations cluster and no center exists within 600m. These purple pins are where we'd place pop-up desks."

---

## Offline-First Architecture

- Registry is in-memory (intentional) — survives network loss
- `offlineQueue.ts` queues failed API calls, retries on `navigator.online` event
- All matching runs client-side via `registry.searchFound()` before any Claude call
- Offline banner + "Matching locally" badge make this **visible** to judges

---

## Credentials (demo)
| Role | Username | Password |
|---|---|---|
| Volunteer | `volunteer` | `kumbh2027` |
| Help Desk | `helpdesk` | `kumbh2027` |

---

## Key Coordinates
```
Ramkund (main ghat):         20.0039° N, 73.7894° E
Panchavati area:             20.0022° N, 73.7883° E
Tapovan:                     20.0156° N, 73.7918° E
Kushavarta Kund (Trimbak):   19.9333° N, 73.5284° E
Nashik Bus Stand:            20.0059° N, 73.7898° E
```

---

## Running the App

```bash
cd lost-and-found
cp .env.example .env          # add ANTHROPIC_API_KEY
npm install
npm run dev                   # Vite on :5173 + Express proxy on :3001
```

Routes:
- `/` — Public pilgrim app
- `/registry` — Live missing/found registry
- `/volunteer` — Volunteer login + tracking
- `/help-desk` — Operator kiosk

---

## Demo Script (2 min)

1. **Open `/`** → select Marathi → tap "I Am Lost" → fill name/age/description → "Search all centers →"
2. Pre-check runs locally ("Matching locally" badge visible) → if match found, zone-masked card appears
3. Tap "Chat with agent" → Claude searches registry, registers report, fires AMBER alert
4. **Result screen:** shows Reference ID + big handover PIN (e.g. **4729**) + centers alerted
5. **Open `/help-desk`** → login → 🔐 Verify tab → enter Report ID + PIN → ✅ verified → log handover
6. **Intel tab** → show hotspot map → "These purple pins predict where we'd place pop-up desks"
7. **PSA tab** → select Marathi → broadcast missing child announcement via TTS
8. **Open `/registry`** → show live cross-matches, zone-masked found persons, incomplete entries with "—"

---

## Win Conditions Addressed

| Criterion | How |
|---|---|
| Real-world impact | Phoneless pilgrim → operator kiosk → PIN handover → no smartphone needed |
| Technical execution | 5 Claude tools with real tool-use actions visible in UI |
| Creativity | Hotspot prediction from KML data + predator-proof PIN system |
| Deployability | In-memory → swap registry.ts for a DB; SMS stub → swap sms.ts for Twilio |

---

## Pending / Nice-to-Have (if time)
- Twilio SMS integration (stub ready in `src/services/sms.ts`)
- Real photo ML matching (currently simulated `photoMatchConfidence`)
- Volunteer panel enhancements (user mentioned coming changes)
- Push notifications for AMBER alerts (currently in-app only)
