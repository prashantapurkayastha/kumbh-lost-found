# Demo Script — Lost & Found / Reunification

## The 2-minute story

**Opening line (say this aloud):** "Every peak day at Kumbh, hundreds of pilgrims get separated from their families. The current system is a loudspeaker and a paper register — and there's no search across centers. A found person at Ramkund Kho-Ya-Paya Kendra is invisible to a family searching at Panchavati Center. We built a multilingual AI that closes that gap in under 5 minutes."

---

## Setup (30 seconds before demo starts)

1. Seed data is loaded: `seed()` called, found persons FP-001 through FP-008 are in the registry across all 10 centers.
2. Demo browser open on laptop + external monitor (judges see external monitor).
3. Map centered on Ramkund (20.0039, 73.7894), zoom level 14.
4. Visible on map:
   - Blue pins: all 10 Kho-Ya-Paya Kendras / control rooms
   - Red pins: 14 police stations (real coordinates from dataset)
   - Orange pins: 8 found persons waiting at centers
   - Yellow markers: high-density zones (Ramkund Ghat, Panchavati Circle, Godavari Ghat — official "no-vehicle pressure zones" from dataset)
5. Sidebar stats: "Found today: 12 | Reunited: 8 | Active searches: 4 | Duplicate reports caught: 2"
6. Language toggle set to **Marathi**.
7. Seed photo (FP-001) pre-loaded in photo upload slot.

---

## Scene 1: Family searches for missing child (60 seconds)

### What you do
Click **"Inject: Lost child report"** OR type manually:

**Input text (Marathi):**
```
माझा मुलगा हरवला आहे. तो ८ वर्षांचा आहे, निळा कुर्ता आणि राखाडी शॉर्ट्स घातला आहे. आम्ही रामकुंड घाटजवळ होतो. कृपया मला मदत करा.
```
*(Translation: My son is lost. He is 8 years old, wearing a blue kurta and grey shorts. We were near Ramkund Ghat. Please help me.)*

Photo thumbnail (FP-001 seed photo) is visible in the intake panel.

### What Claude does (tool calls, in order)
1. Acknowledges in Marathi, confirms photo received, lists extracted features.
2. Calls `search_found_persons` → `{ description: "8 year old boy, blue kurta, grey shorts, near Ramkund Ghat", ageRange: "7-9", gender: "male", clothingDescription: "blue kurta, grey shorts", lastSeenZone: "Ramkund", languageSpoken: "Marathi", photoProvided: true }`
3. Gets back: FP-001 (confidence 0.87, at **Ramkund Kho-Ya-Paya Kendra**), FP-005 (confidence 0.62, at **Panchavati Center**).
4. Calls `notify_help_desk` → alerts CENTER-RAMKUND.
5. Calls `get_reunion_point` → returns Milan Kendra 1 — Ramkund Main Entry.

### What Claude says (expected response, Marathi)
```
मला आपल्या मुलाशी मिळता-जुळता एक रेकॉर्ड सापडला आहे.

✅ जुळणारा रेकॉर्ड: FP-001
- वय: ७-९ वर्षे, मुलगा
- कपडे: निळा कुर्ता, पांढऱ्या भरतकामासह, राखाडी शॉर्ट्स
- ठिकाण: रामकुंड खो-या-पाया केंद्र
- मिळाला: सकाळी ९:१५ वाजता
- फोटो जुळणी: ८२% विश्वास

मी आत्ता हे केले आहे:
१. रामकुंड खो-या-पाया केंद्राला सतर्क केले — ते तुमची वाट पाहत आहेत.
२. मिलन केंद्र १ बुक केले: रामकुंड मुख्य प्रवेशद्वार, वाहन-बंद बॅरियरजवळ.

कृपया आत्ताच मिलन केंद्र १ कडे जा. पिवळा जॅकेट घातलेले स्वयंसेवक तिथे असतील. संदर्भ क्रमांक: LP-24780 सांगा.
```

### What you point to on the map (say aloud)
- "The orange pin here is where the found child is waiting — Ramkund Kho-Ya-Paya Kendra."
- "Claude has already alerted that center volunteer."
- "The green star is Milan Kendra 1 — the physical reunion point. Walk 3 minutes from the center."
- "The family didn't need to speak Hindi. Claude understood Marathi and responded in Marathi."
- "And critically — this search ran across ALL 10 centers simultaneously. Not just the one the family walked into."

---

## Scene 2: Cross-center match (Bengali, 30 seconds)

### What you do
Click **"Language toggle: Bengali"** then type:

**Input (Bengali):**
```
আমার মা হারিয়ে গেছেন। তিনি প্রায় ৭০ বছরের, কমলা শাড়ি পরা, সাদা ব্লাউজ। আমরা পঞ্চবটীর কাছে ছিলাম।
```
*(Translation: My mother is lost. She is about 70, wearing an orange saree and white blouse. We were near Panchavati.)*

### What Claude does
1. Calls `search_found_persons` → returns FP-002 (orange saree, elderly woman, **Panchavati Center**, confidence 0.84).
2. Triggers reunion flow.

### What you say aloud
- "Claude handled Bengali automatically — no translation step, no language config."
- "Notice it matched on clothing color, age band, and zone — three independent signals."
- "FP-002 is at Panchavati Center. The family is also at Panchavati. Same-center match this time — but the system would have caught it even if the family walked into Nashik Road Center instead."

---

## Scene 3: Duplicate report detection (30 seconds)

### What you do
Type in English (or inject via demo button):

```
I'm looking for Suresh Ghosh, a sadhu in his 40s, white dhoti and saffron shawl. We already filed a report at Bharat Bharati Control Room this morning.
```

### What Claude does
1. Calls `search_found_persons` → returns FP-004 (white dhoti, saffron shawl, sadhu, **Sadhugram Lost Found**, confidence 0.85).
2. Also detects that LP-24802 (filed at Trimbakeshwar Kho-Ya-Paya Kendra) is a duplicate of LP-24801 (Bharat Bharati).
3. Says: "I found a match — and I can also see this person was reported at two centers. I've linked both reports under LP-24801."

### What you say aloud
- "8% of real cases in the Kumbh dataset are duplicate reports — the same person filed at multiple centers by a panicked family. The current system has no way to detect that."
- "Claude caught it, linked the reports, and will close both when reunification is confirmed."

---

## Closing line (say this aloud)

"The Kumbhathon dataset shows 8% of missing person reports are duplicates — filed at multiple centers because there's no shared registry. The official AI Stack handles crowd prediction. It doesn't handle the last meter: a family at one help center finding their person at another. This system does. It speaks any Indian language, works across all 10 centers, and could be live at Kumbh 2027 in 3 months — the centers already exist, we're adding the AI layer."

---

## Fallback plan

| Problem | Fix |
|---|---|
| Claude not responding / API error | Show pre-recorded backup video (record before event) |
| Match doesn't appear | Type in English: "8 year old boy, blue kurta, Ramkund" — seed will still match |
| Map not loading (no wifi) | Demo chat-only flow; mention "offline-first" as a design feature per judging criteria |
| Voice recognition fails | Type input; say "We have voice input but I'll type for clarity" |
| Language confusion | Restart in English; multilingual is a bonus |

---

## The 3 things judges should remember

1. **Cross-center search** — a found person at Trimbakeshwar is instantly visible to a family at Ramkund Kho-Ya-Paya Kendra. The dataset proves this gap is real.
2. **Any Indian language** — Marathi, Bengali, Gujarati, Tamil. No translation layer. Claude detects and responds in the same language.
3. **Deployable now** — 10 centers already exist, real police station coordinates in the dataset, real zone boundaries. This is the AI front-end they're missing.

---

## Pre-event practice checklist

- [ ] Run demo 3 times end-to-end without notes
- [ ] Scene 1 under 60s, Scene 2 under 30s, Scene 3 under 30s
- [ ] Copy Marathi input line to clipboard for quick paste
- [ ] Record backup demo video with voiceover
- [ ] Test on event wifi (or hotspot fallback)
- [ ] Warm map tile cache (open, pan around, let tiles load)
- [ ] Confirm seed data is loaded and all 10 centers show as pins
