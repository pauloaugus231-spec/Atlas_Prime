export const BRIEFING_PROFILE_STYLES = ["auto", "compact", "executive", "detailed"] as const;
export type BriefingProfileStyle = (typeof BRIEFING_PROFILE_STYLES)[number];

export const BRIEFING_PURPOSES = ["daily_prep", "team_update", "operational_snapshot", "shared_brief"] as const;
export type BriefingPurpose = (typeof BRIEFING_PURPOSES)[number];

export const BRIEFING_PRESENTATION_HIERARCHIES = ["daily_prep_v1"] as const;
export type BriefingPresentationHierarchy = (typeof BRIEFING_PRESENTATION_HIERARCHIES)[number];

export const BRIEFING_PRESENTATION_TONES = ["human_firm", "human_light", "compact_direct"] as const;
export type BriefingPresentationTone = (typeof BRIEFING_PRESENTATION_TONES)[number];

export interface BriefingPresentationConfig {
  hierarchy?: BriefingPresentationHierarchy;
  tone?: BriefingPresentationTone;
  maxPrimaryCommitments?: number;
  weatherMode?: "inline" | "field_only" | "hidden";
  workflowMode?: "hidden" | "if_priority" | "normal";
  emailMode?: "hidden" | "if_critical" | "normal";
  approvalMode?: "hidden" | "if_urgent" | "normal";
  watchpointMode?: "operational_risk_first" | "balanced";
  compactWhenFieldMode?: boolean;
}

export const BRIEFING_DELIVERY_CHANNELS = ["telegram", "whatsapp", "email"] as const;
export type BriefingDeliveryChannel = (typeof BRIEFING_DELIVERY_CHANNELS)[number];

export const BRIEFING_AUDIENCES = ["self", "team"] as const;
export type BriefingAudience = (typeof BRIEFING_AUDIENCES)[number];

export const BRIEFING_DELIVERY_MODES = ["scheduled", "manual", "both"] as const;
export type BriefingDeliveryMode = (typeof BRIEFING_DELIVERY_MODES)[number];

export const BRIEFING_SECTION_KEYS = [
  "weather",
  "focus",
  "next_action",
  "autonomy",
  "goals",
  "agenda",
  "emails",
  "tasks",
  "approvals",
  "workflows",
  "mobility",
  "motivation",
] as const;
export type BriefingSectionKey = (typeof BRIEFING_SECTION_KEYS)[number];

export interface BriefingProfile {
  id: string;
  name: string;
  aliases: string[];
  enabled: boolean;
  deliveryMode: BriefingDeliveryMode;
  deliveryChannel: BriefingDeliveryChannel;
  audience: BriefingAudience;
  targetRecipientIds: string[];
  targetLabel?: string;
  time: string;
  weekdays: number[];
  timezone?: string;
  style: BriefingProfileStyle;
  sections: BriefingSectionKey[];
  purpose?: BriefingPurpose;
  presentation?: BriefingPresentationConfig;
}
