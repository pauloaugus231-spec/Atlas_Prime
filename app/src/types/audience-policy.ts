import type { BriefingDeliveryChannel } from "./briefing-profile.js";

export const AUDIENCE_POLICY_MODES = ["self_only", "team_briefer", "mixed"] as const;
export type AudiencePolicyMode = (typeof AUDIENCE_POLICY_MODES)[number];

export interface AudiencePolicyProfile {
  mode: AudiencePolicyMode;
  defaultAudience: "self" | "team";
  allowSharedBriefings: boolean;
  requireReviewForTeamDestinations: boolean;
  allowedChannels: BriefingDeliveryChannel[];
}
