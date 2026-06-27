# Milan — Walkthrough Video Script
### AI-Powered Lost & Found Reunification for Kumbh Mela 2027

**Total runtime:** ~8–10 minutes  
**Format:** Screen recording + voiceover. No camera needed. Use the in-app demo buttons where noted.  
**Tip:** Record each section separately and cut together. The three sections are self-contained.

---

## [COLD OPEN — 30 seconds]

> *Show a still photo of a dense Kumbh Mela crowd — Mauni Amavasya, sea of saffron. Then cut to the app home screen.*

**[VOICEOVER]**

"Kumbh Mela 2025. 660 million pilgrims. 50,000 to 100,000 people separated from their families on peak days.

The current system: a loudspeaker, a paper register, and a volunteer who speaks Marathi but not Tamil.

This is Milan. AI-powered reunification. Lets walk through how it works."

---

---

## SECTION 1: PUBLIC APP
### "A family searches for their missing child"
**[~3 minutes]**

---

### 1.1 — Home Screen Overview [30 sec]

> *Show the PublicApp home screen. Scroll gently so the viewer sees all three CTAs.*

**[VOICEOVER]**

"This is the public-facing app — what a family sees when they arrive at any kiosk, help desk tablet, or their own phone.

Three paths. Report a missing person. Say you're lost yourself. Or — for pilgrims who can't read — press and hold to speak. No typing required."

> *Point to each CTA as you mention it.*

---

### 1.2 — Voice-First Screen for Illiterate Users [45 sec]

> *Tap "🎙 Speak for Help". The VoiceFirstScreen takes over — large microphone button, dark background.*

**[VOICEOVER]**

"Let's start with the voice-first screen, because a significant portion of Kumbh pilgrims are functionally illiterate.

One big button. Press and hold. Speak. Release."

> *Press and hold the microphone. Speak in Hindi: "मेरी बेटी खो गई है। वो आठ साल की है। उसने लाल कमीज़ और नीली साड़ी पहनी थी।" (My daughter is lost. She is eight years old. She was wearing a red shirt and a blue sari.)*

**[VOICEOVER]**

"The transcript appears in real time as they speak. No reading. No forms. When they release, they tap Send, and the AI takes over — registering the report, searching for matches, booking a reunion point."

> *Show the transcript appearing. Tap Send. Watch the chat agent activate.*

---

### 1.3 — Report Missing Flow [60 sec]

> *Go back to home screen. Tap "🔍 Report Missing".*

**[VOICEOVER]**

"For families with a smartphone, the Report Missing screen. Name, phone number, a description, and — critically — a photo."

> *Fill in: Name "Priya Sharma", Phone "9876543210". Tap the photo upload button and select a seed photo.*

**[VOICEOVER]**

"When the photo is uploaded, watch what happens."

> *A spinner appears over the thumbnail. After 2–3 seconds it disappears.*

**[VOICEOVER]**

"Claude Vision has just extracted the child's age range, gender, clothing color, and distinguishing features from the photo. These are sent to the matching engine alongside the text description — giving us a much more precise search than text alone."

> *Tap Submit / Search. The chat agent activates and shows a tool call indicator.*

**[VOICEOVER]**

"Claude calls 'search found persons' with the combined text-plus-vision features. Watch the tool use chain."

> *Show Claude's response: a match at 78% confidence at Ramkund Center.*

**[VOICEOVER]**

"Claude found a match. It tells the family exactly why — 'Blue shirt matches, age range consistent, both near Ramkund at the same time.' Then it books Reunion Point 3, fires an SMS to the family's phone, and alerts the desk volunteer. All in one agentic step.

No human had to coordinate this."

---

### 1.4 — Registry Search with Photo [30 sec]

> *Navigate to the Registry tab (bottom nav). Show the registry cards.*

**[VOICEOVER]**

"The public registry is a live view of every person currently waiting at any help desk — updated every 3 seconds. Families can scroll and visually scan.

They can also search with a photo."

> *Tap the photo search banner. Upload a photo.*

**[VOICEOVER]**

"Photo similarity search. Claude ranks found persons by how closely their extracted visual features match the uploaded photo. The confidence score tells the family which lead to follow first."

---

---

## SECTION 2: VOLUNTEER PANEL
### "A volunteer registers a found child"
**[~2.5 minutes]**

---

### 2.1 — Login [10 sec]

> *Show the login screen. Enter: Username "volunteer", Password "kumbh2027". Tap Login.*

**[VOICEOVER]**

"Volunteers log in with their event credentials. In production this would use JWT authentication with the event's volunteer management system."

---

### 2.2 — Photo AI Auto-Fill [60 sec]

> *The VolunteerQuickForm (found-person mode) is showing. Tap the photo upload area and select a photo of a child.*

**[VOICEOVER]**

"A volunteer has found an unaccompanied child near Tapkeshwar Ghat. They open the volunteer panel and tap to add a photo first."

> *Watch the AI loading overlay appear on the thumbnail.*

**[VOICEOVER]**

"Watch the form."

> *Fields start populating: Age Range "Child (0-12)", Gender "Female", Clothing "Red kurta, blue leggings".*

**[VOICEOVER]**

"Claude Vision read the photo and filled the intake form in about 3 seconds. What would normally take a stressed volunteer 3 minutes of typing — age estimate, clothing description, gender — is done automatically and accurately.

The volunteer just confirms and adds any details Claude missed."

> *Scroll down. Show the child-specific fields have appeared.*

**[VOICEOVER]**

"Because the registered age is under 12, child-protection fields appear automatically: Does the child know their own name? Did they mention a school or hometown? These feed the matching algorithm."

---

### 2.3 — Icon Mode for Non-Verbal Subjects [30 sec]

> *Tap the "Icon Mode" toggle near the top of the form. The form switches to a tap-grid of icons.*

**[VOICEOVER]**

"What if the child is too frightened to speak, or the volunteer can't communicate verbally? Icon Mode.

Age range, gender, and condition — all tappable icons. No typing. No language barrier."

> *Tap: 👶 Child, 👧 Girl, 😟 Distressed.*

**[VOICEOVER]**

"Toggle back to normal mode when needed. Both modes share the same submission flow."

> *Toggle back.*

---

### 2.4 — Voice Input for Clothing [20 sec]

> *Tap the 🎤 Speak button next to the Clothing Description field.*

**[VOICEOVER]**

"Voice input is also available for the description field — for volunteers who are moving through a crowd and can't type."

> *The button turns purple and shows a spinner with "Listening…"*

**[VOICEOVER]**

"The button shows live feedback while listening, handles the app's current language — not just Hindi — and resets properly when the mic cuts out. We fixed several real bugs in the Web Speech API layer to get this right."

---

### 2.5 — Submit and Auto-Match [20 sec]

> *Tap Submit.*

**[VOICEOVER]**

"On submit, the server checks for matching missing reports using 60% word overlap on clothing + time window + zone. In this demo there's a pending family report for a girl matching this description.

An SMS fires to that family immediately: 'We found someone matching your description at Tapkeshwar Help Desk. Reference FP-4821. A handover PIN has been sent to your number.'"

---

---

## SECTION 3: HELP DESK PANEL
### "An operator manages the desk queue and completes a handover"
**[~2.5 minutes]**

---

### 3.1 — Login [10 sec]

> *Show login screen. Enter: Username "helpdesk", Password "kumbh2027".*

**[VOICEOVER]**

"Help Desk operators — the people physically staffing the 200+ help desks across the ghats — have a separate panel."

---

### 3.2 — CCTV Tab [30 sec]

> *The CCTV tab is the default. Show the camera index.*

**[VOICEOVER]**

"The default view is CCTV — indexed cameras by zone. When a family says 'we were near the third bathing ghat when we lost him,' the operator searches by zone and pulls up the closest cameras."

> *Type "Ramkund" in the search box. Filtered cameras appear.*

**[VOICEOVER]**

"30 indexed camera locations with coordinates. In production this connects to the ICCC's camera feed API. For the demo, the coordinates are real — the feeds would be live."

---

### 3.3 — Queue Tab [45 sec]

> *Tap the Queue tab. Show the list of found persons waiting at this desk.*

**[VOICEOVER]**

"The Queue tab shows every person currently waiting at this specific desk — registered by any volunteer. Each card shows the photo, reference ID, age, clothing, and match status."

> *Point to a card with a "MINOR" badge.*

**[VOICEOVER]**

"Any person registered with an age under 18 gets a MINOR badge that stays visible through every step of the flow. This ensures no child is processed under the standard adult handover procedure."

> *Point to the match status indicator on a card: "Match Found — Family notified."*

**[VOICEOVER]**

"This person has a confirmed match. The family has been notified by SMS and is on their way."

---

### 3.4 — Handover with PIN Verification [45 sec]

> *Click the Handover button on a matched card. The handover modal opens.*

**[VOICEOVER]**

"When the family arrives, the operator opens the handover modal. A 4-digit PIN was generated at registration time and sent only to the family's phone — never visible in the chat or the registry."

> *Show the PIN entry field.*

**[VOICEOVER]**

"The operator asks the family to quote their PIN. They type it here. The server verifies it and, if it matches, the handover is confirmed and the record is marked resolved.

A 36-hour countdown for PII deletion starts immediately — compliant with India's Digital Personal Data Protection Act 2023."

> *Enter the correct PIN. Show the success confirmation.*

---

### 3.5 — Suspicion Flag [30 sec]

> *Click the flag icon on a card. The suspicion modal appears.*

**[VOICEOVER]**

"What if the claimant seems suspicious? Can't provide the PIN, story doesn't match, or the volunteer has a gut feeling?"

> *Type a note: "Claimant cannot provide PIN. Story changed twice. Physical description of child doesn't match their claimed relationship."*

> *Tap 'Flag and Hold'.*

**[VOICEOVER]**

"The record is immediately placed on HOLD — it cannot be released. A note is logged. And an SMS is automatically sent to the nearest police station with the record details.

The volunteer doesn't have to find a phone, find a number, or leave the desk."

---

### 3.6 — Register Tab [20 sec]

> *Tap the Register tab.*

**[VOICEOVER]**

"Operators can also intake directly — when a family walks up to the desk or a person arrives who can't use the app themselves.

Two modes: reporting a missing family member, or registering a person who is at the desk right now. The same AI-powered form the volunteers use, now in the hands of the desk operator."

---

---

## [CLOSE — 30 seconds]

> *Cut to the home screen of the public app. Then the registry with live cards. Then the map with reunion point pin.*

**[VOICEOVER]**

"Milan. Three panels, one shared registry, updated in 3 seconds.

A family speaks Marathi. Claude understands. Finds a match. Books a reunion. Sends an SMS. The family goes to the right desk. A handover PIN closes the loop.

Under 5 minutes. For the first time in Kumbh's history, every help desk is connected. Every registration is searchable. Every reunion is verified.

The official AI Stack handles the crowd. Milan handles the person."

> *Hold on the app logo / title screen.*

**[VOICEOVER]**

"Milan. Because every second counts."

---

---

## Recording Tips

**Before you start:**
- Set screen to 1080p or higher
- Use a quiet room — voiceover quality matters more than visual polish
- Pre-seed the registry with the demo data (`npm run seed` or the in-app seed button)
- Log in to both the Volunteer and HelpDesk panels in separate browser tabs before recording

**Demo mode for Section 1:**
- Use the "Inject: Lost child report" button (if visible) to pre-fill the Marathi scenario with a seed photo
- The seed data includes a matching found person record so the match flow fires reliably

**Cutting tips:**
- Cut between sections during login screens — natural break point
- Speed up the Claude API response wait time in edit (2–3x) to keep pacing tight
- The CCTV section can be trimmed to 15 seconds if total runtime is too long

**What NOT to show:**
- `.env` file or any terminal window with `ANTHROPIC_API_KEY`
- The `/api/health` response (shows dummy auth is not production-ready)
- Any TypeScript compile errors or console warnings

---

*Script version 1.0 — June 2026*
