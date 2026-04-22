export const BRIEFING_PROFILE_STYLES = ["auto", "compact", "executive", "detailed"] as const;
export type BriefingProfileStyle = (typeof BRIEFING_PROFILE_STYLES)[number];

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
}
