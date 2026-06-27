# Module: Lost & Found / Reunification

## TL;DR for the event

**The problem:** Pilgrims — especially children and elderly — get separated from their families in crowds of 10-40 million. Current system is loudspeakers and paper registers at help desks. There is no searchable database, no multilingual intake, no photo matching, and no way to close the loop (notify the family when their person is found).

**Your demo in one sentence:** A family speaks a description of their missing child in Marathi, uploads a photo, Claude searches a "found persons" database using vision + language understanding, finds a match, and dispatches a reunion notification to both the family and the help desk where the child is waiting.

**Why this wins judges:** It's emotionally resonant (every judge has seen a lost child at a mela), it clearly demonstrates Dimensional-AI (Claude *acts* — it files a report, sends a notification, books a reunion desk), and it's the exact gap the official Kumbh AI Stack doesn't fill (they do crowd flow; they don't do last-mile human reconnection).

---

## Deep problem context

### The scale of the problem at Kumbh

- Kumbh 2025 (Prayagraj) saw 660 million total visitors, with single-day peaks of 50-70 million (Mauni Amavasya).
- The Nashik Kumbh (Simhastha) draws 30-50 million over 6-8 weeks.
- Separated persons at a single bathing ghat peak can number in the hundreds simultaneously.
- The most vulnerable: children under 10, elderly (65+), pilgrims from distant states who don't speak Marathi or Hindi well, pilgrims with cognitive impairment.

### Why the current system fails

1. **Loudspeaker announcements** are in Hindi/Marathi only, can't be heard over crowd noise, and the family has to be near a speaker to hear it.
2. **Paper registers** at help desks are not searchable. If the child is at Ramkund desk and the family is searching at Tapovan desk, there's no connection.
3. **No photo**: The register says "8-year-old boy, blue shirt." There may be 50 such entries.
4. **No closure**: Even when a match is made by phone, there's no way to verify the reunion happened or that the family found the right desk.
5. **Language barrier**: A Tamil family can't communicate with a Marathi-speaking help desk volunteer.

### What the official Kumbh AI Stack provides (and what it doesn't)

The government's official stack (Integrated Command & Control Centre, AI-based crowd monitoring via CCTV) handles:
- Crowd density prediction
- Vehicle flow management
- CCTV monitoring for incidents

It does **not** handle:
- Individual person search/matching
- Multilingual citizen intake
- Closing the loop on reunifications

This module sits at exactly the gap.

---

## User journey (step by step)

### Scenario A: Family searching for a found child

1. Family member arrives at any help desk, kiosk, or uses the app.
2. Describes the missing person in their language (text or voice): age, clothing, where they were last seen, name if known, language spoken.
3. Optionally uploads a photo from their phone.
4. Claude calls `search_found_persons` with the description + photo features extracted.
5. If 1+ match found with > 70% confidence:
   - Claude shows the matches with reasoning ("I found a possible match: boy ~8 years old, blue shirt, found at Ramkund ghat at 9:15 AM").
   - Claude calls `notify_help_desk` to alert the desk where the found person is waiting.
   - Claude calls `get_reunion_point` to assign a physical meeting location.
   - Claude tells the family: "Go to Reunion Point 3, near Ramkund gate B. The volunteer there has been alerted and will have your child."
6. If no match found:
   - Claude calls `register_missing_person` to create a new missing person record.
   - Gives the family a reference number.
   - Tells them: "No match yet. Your report is registered as #LP-247. We will notify you at this number when we find a match."

### Scenario B: Volunteer registering a found person

1. Volunteer at a help desk finds an unaccompanied person.
2. Describes the person (age, clothing, language spoken, where found).
3. Optionally uploads a photo.
4. Claude calls `register_found_person` to add them to the found registry.
5. Claude searches the missing persons registry for a match.
6. If match found: triggers the same notification flow as above.

---

## What makes the Claude moves powerful here

1. **Vision**: Photo + text description together give much better match confidence than text alone. Claude can extract features from the photo (approximate age, hair, clothing color/type) and combine with the spoken description.
2. **Multilingual**: Claude handles Hindi, Marathi, Bengali, Telugu, Tamil, Gujarati, Odia, Bhojpuri without any separate translation layer. The family speaks their language; Claude responds in it.
3. **Reasoning**: Claude explains *why* it thinks a record is a match ("The clothing description matches, the age is close, and both were near Ramkund at the same time"). This builds trust.
4. **Action chain**: Claude doesn't just return a result — it fires the notification, books the desk, and tells the family exactly where to go.

---

## Architecture decisions for this module

### Mock backend: registry service

The `registry` backend (already in `src/core/backends/registry.ts`) stores both found persons and missing persons reports. For this module, you need two collections:
- `foundPersons`: records added by help-desk volunteers when they find an unaccompanied person
- `missingReports`: records added when families report someone missing

The search function does a simple in-memory fuzzy match on: age range, clothing description, location zone, language spoken. It returns scored results.

**You do NOT need real photo matching.** For the demo, photo matching is simulated: if a photo is uploaded, add a `photoProvided: true` flag to the search and return the seed's `photoMatchConfidence` field. Tell the judges: "In production, this would use a face recognition API or the government's CCTV system. In this demo, the mock backend simulates the confidence score."

### Photo intake

- Accept image upload via file input or camera capture.
- Send the image to Claude as a `base64` image block in the messages array.
- Claude extracts visual features in its reasoning before calling the search tool.
- The search tool receives text features (age estimate, clothing description) that Claude extracted from the photo, not the raw image.

### Language detection

Don't build a separate language detection step. Claude's system prompt instructs it to detect the user's language from their first message and respond in it throughout the conversation. This works reliably for all major Indian languages.

### Map display

On the map, show:
- Help desk locations (all 5 desks as pins)
- Found person location (orange pin)
- Assigned reunion point (green star)
- Route from the family's current location to the reunion point (if location is available)

---

## UI screen spec (Screen.tsx)

The screen has two panels:

### Left panel: Chat/intake
- Text input + voice button (Web Speech API)
- Photo upload button (shows thumbnail preview when an image is selected)
- Conversation thread (shows user messages and Claude responses)
- Loading indicator during Claude processing

### Right panel: Map + status
- MapLibre map centered on Ramkund (20.0039, 73.7894)
- Pins for all help desks (blue)
- "Found persons" pins (orange) — one per seeded found person record
- "Reunion point" pin (green star) — appears when Claude books one
- Sidebar stats: "Found persons registered today: 12 | Reunions completed: 8 | Active searches: 4"
- "Last action" strip at the bottom: shows the most recent tool Claude called

### Demo controls (inject buttons)
- **Inject: Lost child report** — Pre-fills the chat with a Marathi description of a missing child, attaches a seed photo
- **Inject: Volunteer finds person** — Simulates a help desk volunteer reporting a found person
- **Language toggle** — Switch the injected demo text between Hindi / Marathi / Bengali / English

---

## Edge cases to handle

| Case | How to handle |
|---|---|
| No match found in registry | Register missing, give reference number, explicitly tell family what happens next |
| Multiple matches (>1 above threshold) | Show all matches with reasoning, ask family to confirm the most likely one |
| Photo uploaded but low-confidence match | Say "Photo provided but match confidence is low (42%). Registering report and alerting all desks." |
| Family doesn't have a phone number | Use a desk code instead: "Go to Ramkund Desk 2 and say your reference number LP-247" |
| Network drops during demo | Show cached last response; display a "Offline — retrying" banner |
| Volunteer's found person already has a pending missing report | Auto-match and immediately trigger the reunion flow |

---

## Time allocation on the day

Total: ~6 hours. For this module, rough splits:

| Task | Time |
|---|---|
| Seed the found persons + missing reports data (15-20 records) | 20 min |
| Implement the 5 tools in tools.ts (they hit in-memory mock) | 60 min |
| Wire up the Screen.tsx (map pins, chat, photo upload) | 90 min |
| Tune system prompt + test the full journey end-to-end | 30 min |
| Multilingual + photo flow test | 20 min |
| Demo rehearsal + polish | 30 min |
| Buffer | 30 min |

---

## What to say to judges

- **Impact**: "At Nashik Kumbh 2015, hundreds of children were separated on peak days. Reunification took hours because there was no searchable database and no multilingual intake. This system closes the loop in under 5 minutes."
- **Technical**: "Claude uses vision to extract clothing and physical features from a photo, multilingual understanding to take reports in any Indian language, and then takes real actions — filing a record, sending a notification, and booking a reunion point — not just returning a text answer."
- **Deployability**: "This integrates with the existing Integrated Command & Control Centre API. The help desks already exist; we're adding a multilingual AI front-end with a searchable shared database. It could be live at Kumbh 2027 in 3 months."
- **The gap**: "The official AI Stack handles crowd prediction. Nobody built last-mile human reconnection. This fills that gap."
