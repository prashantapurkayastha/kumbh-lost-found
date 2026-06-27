import type { AgentTool } from "../types";
import { registry } from "../core/backends/registry";
import { addFoundPersonSync, addMissingReportSync } from "../core/backends/registrySync";
import { notifyBackend } from "../core/backends/notify";
import { getActiveVolunteers } from "../services/volunteers";
import { haversineKm, zoneToLatLng } from "../core/backends/geo";

// ── AMBER alert helper ────────────────────────────────────────────────────────
function fireAmberAlert(zone: string, refId: string, description: string) {
  const loc = zoneToLatLng(zone);
  if (!loc) return;
  const vols = getActiveVolunteers().filter((v) =>
    haversineKm({ lat: v.lat, lng: v.lng }, loc) < 3
  );
  const seen = new Set<string>();
  vols.forEach((v) => {
    if (seen.has(v.centerId)) return;
    seen.add(v.centerId);
    notifyBackend.send({
      centerId: v.centerId,
      centerName: v.centerName,
      message: `🚨 AMBER ALERT — Ref ${refId}: ${description}. Last seen near ${zone}. Volunteers in your area — please assist.`,
      urgency: "high",
    });
  });
  return vols.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool 1: search_found_persons
// ─────────────────────────────────────────────────────────────────────────────
const searchFoundPersons: AgentTool = {
  name: "search_found_persons",
  description:
    "Search the found-persons registry for a possible match. Searches across ALL help centers simultaneously — this is the key capability. Use when a family is looking for a missing person. Provide as much detail as available: age range, gender, clothing description, location where last seen, language spoken. If a photo was provided, include extracted visual features (clothing color, estimated age, hair). Returns a list of possible matches with confidence scores.",
  input_schema: {
    type: "object",
    properties: {
      description: {
        type: "string",
        description: "Free-text description of the missing person. Include all known details.",
      },
      ageRange: {
        type: "string",
        description: "Approximate age or age range, e.g. '6-10', 'elderly 70s', 'young woman 20s'",
      },
      gender: {
        type: "string",
        enum: ["male", "female", "unknown"],
      },
      clothingDescription: {
        type: "string",
        description: "Color and type of clothing, e.g. 'blue kurta, white dhoti'",
      },
      lastSeenZone: {
        type: "string",
        description:
          "Area or ghat where last seen, e.g. 'Ramkund', 'Panchavati Circle', 'Sadhugram Gate 1'",
      },
      languageSpoken: {
        type: "string",
        description: "Language the missing person speaks, e.g. 'Marathi', 'Bengali', 'Telugu'",
      },
      photoProvided: {
        type: "boolean",
        description:
          "True if a photo was uploaded and visual features are included in description",
      },
    },
    required: ["description"],
  },
  run: async (input) => {
    const results = registry.searchFound({
      description: (input.description as string) ?? "",
      ageRange: input.ageRange as string | undefined,
      gender: input.gender as "male" | "female" | "unknown" | undefined,
      clothingDescription: input.clothingDescription as string | undefined,
      lastSeenZone: input.lastSeenZone as string | undefined,
      languageSpoken: input.languageSpoken as string | undefined,
      photoProvided: (input.photoProvided as boolean) ?? false,
    });

    return {
      matchesFound: results.length,
      matches: results.map((r) => ({
        id: r.id,
        ageRange: r.ageRange,
        gender: r.gender,
        clothing: r.clothing,
        lastSeenLocation: r.lastSeenLocation,
        foundZone: r.foundZone,
        foundAt: r.foundAt,
        centerId: r.centerId,
        centerName: r.centerName,
        languageSpoken: r.languageSpoken,
        condition: r.condition,
        physicalDescription: r.physicalDescription,
        confidence: r.confidence,
        matchReason: r.matchReason,
      })),
      note:
        results.length === 0
          ? "No matches found above 40% confidence. Recommend registering a missing person report."
          : `Found ${results.length} possible match(es). Top match confidence: ${Math.round(results[0].confidence * 100)}%.`,
      searchTimestamp: new Date().toISOString(),
      centersSearched: registry.getHelpCenters().length,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Tool 2: register_missing_person
// ─────────────────────────────────────────────────────────────────────────────
const registerMissingPerson: AgentTool = {
  name: "register_missing_person",
  description:
    "Register a new missing person report when no match is found in the found-persons registry, or when a family wants to file a report even before searching. Returns a reference number the family can use to follow up. Automatically alerts all help centers in the area and checks for duplicate reports filed at other centers.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Name if known, or omit if unknown" },
      ageRange: { type: "string", description: "e.g. '7-9', '65-75', '80+'" },
      gender: { type: "string", enum: ["male", "female", "unknown"] },
      clothingDescription: {
        type: "string",
        description: "Full clothing description",
      },
      lastSeenZone: {
        type: "string",
        description:
          "Where last seen, e.g. 'Ramkund Ghat', 'Panchavati Circle', 'Sadhugram Gate 1'",
      },
      lastSeenTime: {
        type: "string",
        description: "Approximate time, e.g. '9:00 AM', 'about an hour ago'",
      },
      languageSpoken: { type: "string" },
      contactNumber: {
        type: "string",
        description: "Phone number of reporting family member, or omit if none",
      },
      reporterName: { type: "string" },
      additionalDetails: { type: "string" },
    },
    required: ["ageRange", "gender", "clothingDescription", "lastSeenZone"],
  },
  run: async (input) => {
    const report = await addMissingReportSync({
      name: input.name as string | undefined,
      ageRange: input.ageRange as string,
      gender: input.gender as "male" | "female" | "unknown",
      clothingDescription: input.clothingDescription as string,
      lastSeenZone: input.lastSeenZone as string,
      lastSeenTime: input.lastSeenTime as string | undefined,
      languageSpoken: input.languageSpoken as string | undefined,
      contactNumber: input.contactNumber as string | undefined,
      reporterName: input.reporterName as string | undefined,
      additionalDetails: input.additionalDetails as string | undefined,
    });

    const nearbyZoneCenters = registry.getCentersInZone(input.lastSeenZone as string);
    const alertedCenters = nearbyZoneCenters.length > 0
      ? nearbyZoneCenters.map((c) => c.name)
      : registry.getHelpCenters().slice(0, 3).map((c) => c.name);

    // Notify each alerted center
    for (const center of nearbyZoneCenters.slice(0, 3)) {
      notifyBackend.send({
        centerId: center.id,
        centerName: center.name,
        message: `New missing person report: ${report.id}. ${input.clothingDescription}, last seen ${input.lastSeenZone}.`,
        urgency: "high",
      });
    }

    // Fire AMBER alerts to volunteers near last-seen zone
    const amberDesc = `${input.gender} person, age ${input.ageRange}, wearing ${input.clothingDescription}`;
    const volsAlerted = fireAmberAlert(input.lastSeenZone as string, report.id, amberDesc) ?? 0;

    const result: Record<string, unknown> = {
      referenceId: report.id,
      verificationCode: report.verificationCode,
      status: "registered",
      alertedCenters,
      volunteersAlerted: volsAlerted,
      message: `Report ${report.id} registered. Verification code: ${report.verificationCode} — the family must quote this at the help desk before any person is released. ${alertedCenters.length} centers and ${volsAlerted} nearby volunteers alerted.`,
    };

    if (report.is_duplicate_report && report.duplicate_of) {
      result.duplicate_report_warning = {
        possible_duplicate_of: report.duplicate_of,
        note: `A similar report was already filed. Reports have been linked. If either center finds a match, the family will be notified.`,
      };
    }

    return result;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Tool 3: register_found_person
// ─────────────────────────────────────────────────────────────────────────────
const registerFoundPerson: AgentTool = {
  name: "register_found_person",
  description:
    "Used by help desk volunteers to register an unaccompanied person they have found. Creates a record in the shared found-persons registry visible to all centers, and immediately checks the missing persons registry for a match. Returns the record ID and any potential matches found.",
  input_schema: {
    type: "object",
    properties: {
      ageRange: { type: "string" },
      gender: { type: "string", enum: ["male", "female", "unknown"] },
      clothingDescription: { type: "string" },
      foundZone: {
        type: "string",
        description: "Where the person was found",
      },
      foundTime: { type: "string" },
      centerId: {
        type: "string",
        description:
          "ID of the help center where the person is currently. Use CENTER-RAMKUND, CENTER-PANCHAVATI, CENTER-TRIMBAK, CENTER-NASHIKROAD, CENTER-BHARATBHARATI, CENTER-CENTRAL, CENTER-POLICE, CENTER-ADGAON, CENTER-SADHUGRAM, or CENTER-RAJURBAHULA",
      },
      languageSpoken: { type: "string" },
      condition: {
        type: "string",
        enum: ["calm", "distressed", "injured", "non-verbal"],
        default: "calm",
      },
      photoProvided: { type: "boolean" },
    },
    required: ["ageRange", "gender", "clothingDescription", "foundZone", "centerId"],
  },
  run: async (input) => {
    const fp = await addFoundPersonSync({
      ageRange: input.ageRange as string,
      gender: input.gender as "male" | "female" | "unknown",
      clothingDescription: input.clothingDescription as string,
      foundZone: input.foundZone as string,
      foundTime: input.foundTime as string | undefined,
      centerId: input.centerId as string,
      languageSpoken: input.languageSpoken as string | undefined,
      condition: input.condition as "calm" | "distressed" | "injured" | "non-verbal" | undefined,
      photoProvided: (input.photoProvided as boolean) ?? false,
    });

    // Immediately check for matching missing reports
    const matches = registry.searchMissingReports(fp);

    // AMBER alert to volunteers near found zone
    const foundDesc = `Found ${input.gender} person, age ${input.ageRange}, wearing ${input.clothingDescription}`;
    const volsAlerted = fireAmberAlert(input.foundZone as string, fp.id, foundDesc) ?? 0;

    return {
      recordId: fp.id,
      status: "registered",
      registeredAtCenter: fp.centerName,
      volunteersAlerted: volsAlerted,
      potentialMissingMatches: matches.map((m) => ({
        missingReportId: m.missingReportId,
        reportedBy: m.reportedBy,
        reportingCenter: m.reportingCenter,
        // contactNumber intentionally excluded — PII, visible to desk operators only
        confidence: m.confidence,
        matchReason: m.matchReason,
        is_cross_center_match: m.is_cross_center_match,
      })),
      message:
        matches.length > 0
          ? `Found person registered as ${fp.id}. ${matches.length} potential match(es) found in missing reports.`
          : `Found person registered as ${fp.id}. No matches in missing reports yet. Record is now visible to all centers.`,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Tool 4: notify_help_desk
// ─────────────────────────────────────────────────────────────────────────────
const notifyHelpDesk: AgentTool = {
  name: "notify_help_desk",
  description:
    "Send an alert notification to a specific help center. Use after finding a match between a missing person and a found person. The notification tells the center volunteer to expect the family and to confirm they still have the found person. Returns confirmation that the message was sent.",
  input_schema: {
    type: "object",
    properties: {
      centerId: {
        type: "string",
        description: "The center ID, e.g. CENTER-RAMKUND",
      },
      message: {
        type: "string",
        description: "The alert message to send to the center",
      },
      urgency: {
        type: "string",
        enum: ["low", "medium", "high"],
        default: "high",
      },
      expectedArrivalMinutes: {
        type: "number",
        description: "How many minutes until the family is expected to arrive",
      },
    },
    required: ["centerId", "message"],
  },
  run: async (input) => {
    const center = registry.getCenterById(input.centerId as string);
    if (!center) {
      return {
        sent: false,
        error: `Center ${input.centerId} not found. Available: ${registry.getHelpCenters().map((c) => c.id).join(", ")}`,
      };
    }

    const result = notifyBackend.send({
      centerId: center.id,
      centerName: center.name,
      message: input.message as string,
      urgency: (input.urgency as "low" | "medium" | "high") ?? "high",
    });

    return {
      sent: result.success,
      centerId: center.id,
      centerName: center.name,
      centerLocation: center.location,
      contactNumber: center.contactNumber,
      timestamp: new Date().toISOString(),
      messagePreview: input.message,
      notificationId: result.notificationId,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Tool 5: get_reunion_point
// ─────────────────────────────────────────────────────────────────────────────
const getReunionPoint: AgentTool = {
  name: "get_reunion_point",
  description:
    "Book a physical reunion meeting point (Milan Kendra) at the mela ground and return its exact location and walking directions. Use after a match has been confirmed and the help center has been notified. Returns the reunion point name, coordinates, and walking directions in the user's language.",
  input_schema: {
    type: "object",
    properties: {
      nearestZone: {
        type: "string",
        description:
          "The zone closest to both parties, to pick the most convenient point. e.g. 'Ramkund', 'Panchavati', 'Trimbakeshwar'",
      },
      foundPersonCenterId: {
        type: "string",
        description: "The center ID where the found person is waiting",
      },
      familyCurrentZone: {
        type: "string",
        description: "The current zone of the family (if known)",
      },
    },
    required: ["nearestZone"],
  },
  run: async (input) => {
    const rp = registry.getReunionPointForZone(input.nearestZone as string);

    if (!rp) {
      return {
        error: "No reunion point available for this zone. Direct the family to the nearest help center.",
        nearestCenters: registry.getHelpCenters().slice(0, 2).map((c) => ({
          name: c.name,
          location: c.location,
          contactNumber: c.contactNumber,
        })),
      };
    }

    return {
      reunionPointId: rp.id,
      name: rp.name,
      location: rp.location,
      landmark: rp.landmark,
      landmark_mr: rp.landmark_mr,
      landmark_hi: rp.landmark_hi,
      zone_type: rp.zone_type,
      volunteerId: rp.volunteerAssigned,
      walkingTimes: {
        fromRamkundCenter: rp.walkingTimeFromRamkundCenter,
        fromPanchavatiCenter: rp.walkingTimeFromPanchavatiCenter,
        fromNashikRoadCenter: rp.walkingTimeFromNashikRoadCenter,
        fromTrimbakCenter: rp.walkingTimeFromTrimbakCenter,
      },
      instructions: `Go to ${rp.name}. ${rp.landmark} Look for the green MILAN KENDRA (मिलन केंद्र) banner and a volunteer in a yellow vest.`,
      referenceToShow: "Show your reference number LP-XXXXX to the volunteer on arrival.",
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Tool 6: verify_handover
// ─────────────────────────────────────────────────────────────────────────────
const verifyHandover: AgentTool = {
  name: "verify_handover",
  description:
    "Verify a 4-digit handover PIN to confirm identity before releasing a found person to a claimant. Use when a help desk operator or family member wants to resolve/close a case after reunion. Returns ok:true if the PIN matches the report, and marks the case as resolved.",
  input_schema: {
    type: "object",
    properties: {
      reportId: {
        type: "string",
        description: "The missing person report reference number (e.g. LP-1234567890-ABCD)",
      },
      verificationCode: {
        type: "string",
        description: "The 4-digit PIN the claimant quotes (shown on their registration result screen)",
      },
      foundPersonId: {
        type: "string",
        description: "The ID of the found person at the center (optional, helps log the match)",
      },
    },
    required: ["reportId", "verificationCode"],
  },
  run: async (input) => {
    const result = registry.verifyHandover(
      input.reportId as string,
      (input.foundPersonId as string) ?? "",
      input.verificationCode as string,
    );
    if (result.ok) {
      registry.logHandover(
        input.reportId as string,
        (input.foundPersonId as string) ?? "",
        "help-desk",
        "operator",
      );
    }
    return result;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Export all tools
// ─────────────────────────────────────────────────────────────────────────────
export const allTools: AgentTool[] = [
  searchFoundPersons,
  registerMissingPerson,
  registerFoundPerson,
  notifyHelpDesk,
  getReunionPoint,
  verifyHandover,
];
