// ─────────────────────────────────────────────────────────────────────────────
// Shared types for the Lost & Found module
// ─────────────────────────────────────────────────────────────────────────────

export interface LatLng {
  lat: number;
  lng: number;
}

export interface HelpCenter {
  id: string;
  name: string;
  zone: string;
  location: LatLng;
  contactNumber: string;
  openHours: string;
  languages: string[];
  capacity: number;
  currentLoad: number;
}

export interface PoliceStation {
  id: string;
  name: string;
  location: LatLng;
}

export interface ReunionPoint {
  id: string;
  name: string;
  zone: string;
  location: LatLng;
  landmark: string;
  landmark_mr?: string;
  landmark_hi?: string;
  volunteerAssigned: string;
  walkingTimeFromRamkundCenter?: string;
  walkingTimeFromPanchavatiCenter?: string;
  walkingTimeFromNashikRoadCenter?: string;
  walkingTimeFromTrimbakCenter?: string;
  zone_type?: string;
}

export interface FoundPerson {
  id: string;
  ageRange: string;
  gender: "male" | "female" | "unknown";
  name: string;
  clothing: string;
  clothing_features: string[];
  foundZone: string;
  lastSeenLocation: string;
  foundAt: string; // ISO timestamp
  centerId: string;
  centerName: string;
  languageSpoken: string;
  condition: "calm" | "distressed" | "injured" | "non-verbal";
  physicalDescription: string;
  photoMatchConfidence: number; // 0–1, simulated
  photoBase64?: string; // base64 JPEG/PNG for display in cards
  status: "waiting" | "reunited" | "transferred";
  is_potential_duplicate: boolean;
  expiresAt?: string; // ISO timestamp — record auto-expires after 72 hours
  // Abandoned elderly / care disposition
  disposition?: "active" | "care-arranged" | "medical-referral" | "transferred-shelter";
  dispositionNotes?: string;
  familyExpected?: boolean;
  // Child / minor flags
  isMinorUnaccompanied?: boolean;
  childKnowsName?: boolean;
  childHometown?: string;
}

export interface MissingPersonInfo {
  name?: string;
  ageRange: string;
  gender: "male" | "female" | "unknown";
  clothing: string;
  lastSeenLocation: string;
  lastSeenTime: string;
  languageSpoken: string;
  additionalDetails?: string;
}

export interface MissingReport {
  id: string;
  reportedBy: string;
  contactNumber?: string;
  reportingCenter: string;
  photoBase64?: string; // base64 photo of the missing person for display
  missingPerson: MissingPersonInfo;
  registeredAt: string;
  status: "active" | "resolved" | "duplicate_closed";
  matchedFoundPersonId: string | null;
  is_duplicate_report: boolean;
  duplicate_of?: string;
  /** 4-digit PIN shown to family; must be quoted in-person at desk before handover */
  verificationCode: string;
  expiresAt?: string; // ISO timestamp — record auto-expires after 72 hours
  // Adversarial claimant flags
  suspicionFlag?: boolean;
  suspicionNotes?: string;
  held?: boolean; // record put on hold pending police review
  /** ISO timestamp: when to redact PII (36h after resolution) */
  piiDeletesAt?: string;
  /** True once PII has been redacted */
  piiRedacted?: boolean;
}

export interface HandoverLog {
  id: string;
  reportId: string;
  foundPersonId: string;
  verifiedBy: string; // desk operator name/ID
  verifiedAt: string;
  centerId: string;
}

export interface Notification {
  id: string;
  centerId: string;
  centerName: string;
  message: string;
  urgency: "low" | "medium" | "high";
  sentAt: string;
  read: boolean;
}

export interface CompletedReunion {
  id: string;
  foundPersonId: string;
  missingReportId: string;
  completedAt: string;
  reunionPointId: string;
  centerWhereFoundPersonWas: string;
  centerWhereFamilyReported: string;
  timeToReunion: string;
  cross_center: boolean;
  note?: string;
}

// ─── Tool input/output types ──────────────────────────────────────────────────

export interface SearchFoundPersonsInput {
  description: string;
  ageRange?: string;
  gender?: "male" | "female" | "unknown";
  clothingDescription?: string;
  lastSeenZone?: string;
  languageSpoken?: string;
  photoProvided?: boolean;
}

export interface FoundPersonMatch extends FoundPerson {
  confidence: number;
  matchReason: string;
  is_cross_center_match?: boolean;
}

export interface RegisterMissingPersonInput {
  name?: string;
  ageRange: string;
  gender: "male" | "female" | "unknown";
  clothingDescription: string;
  lastSeenZone: string;
  lastSeenTime?: string;
  languageSpoken?: string;
  contactNumber?: string;
  reporterName?: string;
  additionalDetails?: string;
  photoBase64?: string;
}

export interface RegisterFoundPersonInput {
  ageRange: string;
  gender: "male" | "female" | "unknown";
  clothingDescription: string;
  foundZone: string;
  foundTime?: string;
  centerId: string;
  languageSpoken?: string;
  condition?: "calm" | "distressed" | "injured" | "non-verbal";
  photoProvided?: boolean;
  photoBase64?: string;
  // Care disposition for abandoned persons
  disposition?: "active" | "care-arranged" | "medical-referral" | "transferred-shelter";
  dispositionNotes?: string;
  familyExpected?: boolean;
  // Minor flags
  isMinorUnaccompanied?: boolean;
  childKnowsName?: boolean;
  childHometown?: string;
}

export interface NotifyHelpDeskInput {
  centerId: string;
  message: string;
  urgency?: "low" | "medium" | "high";
  expectedArrivalMinutes?: number;
}

export interface GetReunionPointInput {
  nearestZone: string;
  foundPersonCenterId?: string;
  familyCurrentZone?: string;
}

// ─── Anthropic message types ──────────────────────────────────────────────────

export type MessageRole = "user" | "assistant";

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ImageBlock {
  type: "image";
  source: {
    type: "base64";
    media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    data: string;
  };
}

export type ContentBlock = TextBlock | ImageBlock;

export interface Message {
  role: MessageRole;
  content: string | ContentBlock[];
}

export interface AgentTool {
  name: string;
  description: string;
  input_schema: object;
  run: (input: Record<string, unknown>) => Promise<unknown>;
}
