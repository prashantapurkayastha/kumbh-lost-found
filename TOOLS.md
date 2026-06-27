# Tools — Lost & Found / Reunification

Five tools. Implement them in `src/modules/lost-and-found/tools.ts`. Each `run()` function hits the in-memory mock backend in `src/core/backends/registry.ts`.

---

## Tool 1: search_found_persons

### What Claude sees (description)
```
Search the found-persons registry for a possible match. Use when a family is looking for a missing person. Provide as much detail as available: age range, gender, clothing description, location where last seen, language spoken. If a photo was provided, include extracted visual features (clothing color, estimated age, hair). Returns a list of possible matches with confidence scores.
```

### JSON Schema (input_schema)
```json
{
  "type": "object",
  "properties": {
    "description": {
      "type": "string",
      "description": "Free-text description of the missing person. Include all known details."
    },
    "ageRange": {
      "type": "string",
      "description": "Approximate age or age range, e.g. '6-10', 'elderly 70s', 'young woman 20s'"
    },
    "gender": {
      "type": "string",
      "enum": ["male", "female", "unknown"]
    },
    "clothingDescription": {
      "type": "string",
      "description": "Color and type of clothing, e.g. 'blue kurta, white dhoti'"
    },
    "lastSeenZone": {
      "type": "string",
      "description": "Area or ghat where last seen, e.g. 'Ramkund', 'Panchvati', 'Tapovan'"
    },
    "languageSpoken": {
      "type": "string",
      "description": "Language the missing person speaks, e.g. 'Marathi', 'Bengali', 'Telugu'"
    },
    "photoProvided": {
      "type": "boolean",
      "description": "True if a photo was uploaded and visual features are included in description"
    }
  },
  "required": ["description"]
}
```

### TypeScript implementation
```typescript
// src/modules/lost-and-found/tools.ts
import { registry } from "../../core/backends/registry";

export const searchFoundPersons: AgentTool = {
  name: "search_found_persons",
  description: "Search the found-persons registry for a possible match...",  // use full description above
  input_schema: { /* schema above */ },
  run: async (input) => {
    const results = registry.searchFound({
      description: input.description,
      ageRange: input.ageRange,
      gender: input.gender,
      clothingDescription: input.clothingDescription,
      lastSeenZone: input.lastSeenZone,
      languageSpoken: input.languageSpoken,
      photoProvided: input.photoProvided ?? false,
    });
    return {
      matchesFound: results.length,
      matches: results,
      searchTimestamp: new Date().toISOString(),
    };
  },
};
```

### Mock backend function (registry.ts)
```typescript
searchFound(query: SearchFoundQuery): FoundPersonMatch[] {
  return foundPersons
    .map(person => {
      let score = 0;
      if (query.gender && person.gender === query.gender) score += 0.20;
      if (query.ageRange && ageOverlaps(person.ageRange, query.ageRange)) score += 0.25;
      if (query.clothingDescription && descriptionOverlap(person.clothing, query.clothingDescription)) score += 0.25;
      if (query.lastSeenZone && person.foundZone === query.lastSeenZone) score += 0.15;
      if (query.languageSpoken && person.languageSpoken === query.languageSpoken) score += 0.10;
      if (query.photoProvided) score += person.photoMatchConfidence ?? 0; // simulated photo match

      return {
        ...person,
        confidence: Math.min(score, 1.0),
        matchReason: buildMatchReason(person, query),
      };
    })
    .filter(r => r.confidence >= 0.40)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);
}
```

### Expected output (what Claude receives)
```json
{
  "matchesFound": 2,
  "matches": [
    {
      "id": "FP-001",
      "ageRange": "7-9",
      "gender": "male",
      "clothing": "blue kurta with white embroidery, grey shorts",
      "lastSeenLocation": "Ramkund Ghat",
      "foundZone": "Ramkund",
      "foundAt": "2027-07-28T09:15:00Z",
      "centerId": "CENTER-RAMKUND",
      "centerName": "Ramkund Kho-Ya-Paya Kendra",
      "centerLocation": { "lat": 20.0039, "lng": 73.7894 },
      "languageSpoken": "Marathi",
      "photoMatchConfidence": 0.82,
      "confidence": 0.87,
      "matchReason": "Age range matches, clothing color matches (blue kurta), zone matches (Ramkund Ghat), photo confidence 82%",
      "is_potential_duplicate": false
    },
    {
      "id": "FP-005",
      "ageRange": "10-13",
      "gender": "male",
      "clothing": "blue and white striped shirt, dark blue trousers",
      "lastSeenLocation": "Gauri Patangan",
      "foundZone": "Panchavati",
      "foundAt": "2027-07-28T08:55:00Z",
      "centerId": "CENTER-PANCHAVATI",
      "centerName": "Panchavati Center",
      "centerLocation": { "lat": 20.0022, "lng": 73.7883 },
      "languageSpoken": "Telugu",
      "confidence": 0.62,
      "matchReason": "Age range close, clothing is blue but different style, different zone",
      "is_potential_duplicate": false
    }
  ],
  "duplicateReportsDetected": [],
  "searchTimestamp": "2027-07-28T09:32:00Z"
}
```

---

## Tool 2: register_missing_person

### What Claude sees (description)
```
Register a new missing person report when no match is found in the found-persons registry, or when a family wants to file a report even before searching. Returns a reference number the family can use to follow up. Also automatically alerts all help desks in the area.
```

### JSON Schema
```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string", "description": "Name if known, or 'Unknown'" },
    "ageRange": { "type": "string" },
    "gender": { "type": "string", "enum": ["male", "female", "unknown"] },
    "clothingDescription": { "type": "string" },
    "lastSeenZone": { "type": "string" },
    "lastSeenTime": { "type": "string", "description": "Approximate time, e.g. '9:00 AM', 'about an hour ago'" },
    "languageSpoken": { "type": "string" },
    "contactNumber": { "type": "string", "description": "Phone number of reporting family member, or null if none" },
    "reporterName": { "type": "string" },
    "additionalDetails": { "type": "string" }
  },
  "required": ["ageRange", "gender", "clothingDescription", "lastSeenZone"]
}
```

### TypeScript implementation
```typescript
export const registerMissingPerson: AgentTool = {
  name: "register_missing_person",
  description: "Register a new missing person report...",
  input_schema: { /* schema above */ },
  run: async (input) => {
    const referenceId = `LP-${Date.now().toString().slice(-5)}`;
    const record = {
      id: referenceId,
      ...input,
      registeredAt: new Date().toISOString(),
      status: "active",
    };
    registry.addMissingReport(record);
    // Alert all help desks in the zone
    const nearbyDesks = registry.getDesksInZone(input.lastSeenZone);
    nearbyDesks.forEach(desk => notify.alert(desk.id, `New missing person report: ${referenceId}. ${input.clothingDescription}, last seen ${input.lastSeenZone}.`));
    return {
      referenceId,
      status: "registered",
      alertedDesks: nearbyDesks.map(d => d.name),
      message: `Report ${referenceId} registered and ${nearbyDesks.length} nearby desks alerted.`,
    };
  },
};
```

### Expected output
```json
{
  "referenceId": "LP-24847",
  "status": "registered",
  "alertedCenters": ["Ramkund Kho-Ya-Paya Kendra", "Panchavati Center", "Bharat Bharati Control Room"],
  "message": "Report LP-24847 registered and 3 nearby centers alerted.",
  "duplicate_check": {
    "possible_duplicate_of": null,
    "note": "No existing report found for this person at other centers."
  }
}
```

---

## Tool 3: register_found_person

### What Claude sees (description)
```
Used by help desk volunteers to register an unaccompanied person they have found. Creates a record in the found-persons registry and immediately checks the missing persons registry for a match. Returns the record ID and any potential matches found.
```

### JSON Schema
```json
{
  "type": "object",
  "properties": {
    "ageRange": { "type": "string" },
    "gender": { "type": "string", "enum": ["male", "female", "unknown"] },
    "clothingDescription": { "type": "string" },
    "foundZone": { "type": "string" },
    "foundTime": { "type": "string" },
    "deskId": { "type": "string", "description": "ID of the help desk where the person is currently located" },
    "languageSpoken": { "type": "string" },
    "condition": { "type": "string", "enum": ["calm", "distressed", "injured", "non-verbal"], "default": "calm" },
    "photoProvided": { "type": "boolean" }
  },
  "required": ["ageRange", "gender", "clothingDescription", "foundZone", "deskId"]
}
```

### Expected output
```json
{
  "recordId": "FP-031",
  "status": "registered",
  "registeredAtCenter": "Panchavati Center",
  "potentialMissingMatches": [
    {
      "missingReportId": "LP-24795",
      "confidence": 0.81,
      "reportedBy": "Dilip Patel",
      "reportingCenter": "Panchavati Center",
      "contactNumber": "+91-9876512345",
      "matchReason": "Age, clothing color (pink frock), and zone match",
      "is_cross_center_match": false
    }
  ],
  "duplicate_report_warning": null
}
```

---

## Tool 4: notify_help_desk

### What Claude sees (description)
```
Send an alert notification to a specific help desk. Use after finding a match between a missing person and a found person. The notification tells the desk volunteer to expect the family and to confirm they still have the found person. Returns confirmation that the message was sent.
```

### JSON Schema
```json
{
  "type": "object",
  "properties": {
    "deskId": { "type": "string" },
    "message": { "type": "string", "description": "The alert message to send to the desk" },
    "urgency": { "type": "string", "enum": ["low", "medium", "high"], "default": "high" },
    "expectedArrivalMinutes": { "type": "number", "description": "How many minutes until the family is expected to arrive" }
  },
  "required": ["deskId", "message"]
}
```

### Expected output
```json
{
  "sent": true,
  "centerId": "CENTER-RAMKUND",
  "centerName": "Ramkund Kho-Ya-Paya Kendra",
  "timestamp": "2027-07-28T09:33:00Z",
  "messagePreview": "ALERT: Family en route to collect child FP-001. Expect arrival in ~8 minutes. Do not let the child leave the center. Reference: LP-24780."
}
```

### TypeScript implementation
```typescript
export const notifyHelpDesk: AgentTool = {
  name: "notify_help_desk",
  description: "Send an alert notification to a specific help desk...",
  input_schema: { /* schema */ },
  run: async (input) => {
    const desk = registry.getDeskById(input.deskId);
    const result = notify.send({
      to: desk,
      message: input.message,
      urgency: input.urgency,
      channel: "desk-terminal",
    });
    return {
      sent: result.success,
      deskId: input.deskId,
      deskName: desk.name,
      timestamp: new Date().toISOString(),
      messagePreview: input.message,
    };
  },
};
```

---

## Tool 5: get_reunion_point

### What Claude sees (description)
```
Book a physical reunion meeting point at the mela ground and return its exact location and directions. Use after a match has been confirmed and the help desk has been notified. Returns the reunion point name, coordinates, and walking directions from the nearest landmark.
```

### JSON Schema
```json
{
  "type": "object",
  "properties": {
    "nearestZone": { "type": "string", "description": "The zone closest to both parties, to pick the most convenient point" },
    "foundPersonDeskId": { "type": "string", "description": "The desk where the found person is waiting" },
    "familyCurrentZone": { "type": "string", "description": "The current zone of the family (if known)" }
  },
  "required": ["nearestZone"]
}
```

### Expected output
```json
{
  "reunionPointId": "RP-1",
  "name": "Milan Kendra 1 — Ramkund Main Entry",
  "location": { "lat": 20.0067, "lng": 73.79062 },
  "landmark": "Panchavati / Ramkund access zone, beside the no-vehicle barrier. Green MILAN KENDRA banner.",
  "landmark_mr": "पंचवटी / रामकुंड प्रवेश क्षेत्र, वाहन-बंद बॅरियरजवळ. हिरवे मिलन केंद्र बॅनर शोधा.",
  "landmark_hi": "पंचवटी / रामकुंड प्रवेश क्षेत्र, नो-व्हीकल बैरियर के पास। हरा मिलन केंद्र बैनर देखें।",
  "walkingTimeFromRamkundCenter": "3 minutes",
  "walkingTimeFromPanchavatiCenter": "6 minutes",
  "instructions": "Go to the Ramkund main access zone. Look for the green MILAN KENDRA (मिलन केंद्र) banner. A volunteer in a yellow vest will be there.",
  "volunteerId": "V-101",
  "referenceToShow": "Show reference number LP-XXXXX to the volunteer",
  "zone_type": "No-vehicle pressure zone — police-controlled access, safe for families to meet"
}
```

---

## Duplicate report detection (important for judging)

The real Kumbh dataset shows **8% of missing person reports are duplicates** — the same family files at multiple centers in a panic. Your mock backend should check for duplicates in `register_missing_person` by fuzzy-matching name + ageRange + clothingDescription against existing reports. If a likely duplicate is found:

```json
{
  "referenceId": "LP-24802",
  "status": "registered",
  "duplicate_report_warning": {
    "possible_duplicate_of": "LP-24801",
    "filed_at_center": "Bharat Bharati Control Room",
    "filed_at": "2027-07-28T08:55:00Z",
    "confidence": 0.88
  },
  "message": "Report LP-24802 registered. WARNING: A similar report LP-24801 was filed at Bharat Bharati Control Room 50 minutes ago. These may be the same person. Reports have been linked."
}
```

Claude should surface this to the family: *"I notice a similar report was already filed at Bharat Bharati Control Room. I've linked both reports — if either center finds a match, you'll be notified."*

---

## Tool chaining pattern (how Claude uses these tools together)

**Happy path for a family searching for a missing child:**
```
User input (Marathi + photo)
  → Claude extracts visual features from photo
  → search_found_persons (with features)
    → match found (confidence 0.87)
  → notify_help_desk (alert Ramkund Desk 2)
  → get_reunion_point (zone: Ramkund)
  → Claude responds: "I found [child description] at Ramkund. I've alerted the desk. Go to Reunion Point 3..."
```

**Happy path for a volunteer registering a found person:**
```
Volunteer input
  → register_found_person
    → automatic check against missing reports → match found
  → notify_help_desk (call the family's number / alert their last contact desk)
  → get_reunion_point
  → Claude responds: "Registered as FP-031. Match found with report LP-24789. Family notified. Reunion Point 3 assigned."
```

**No-match path:**
```
User input
  → search_found_persons → no matches above threshold
  → register_missing_person → LP-24847
  → Claude responds: "No match found yet. Report registered as LP-24847. 3 nearby desks alerted. [Next steps]."
```
