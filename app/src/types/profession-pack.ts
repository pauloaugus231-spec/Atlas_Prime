import type { BriefingProfileStyle, BriefingSectionKey } from "./briefing-profile.js";
import type { UserRole } from "./user-role.js";

export interface ProfessionPack {
  id: string;
  label: string;
  aliases: string[];
  suggestedRole: UserRole;
  summary: string;
  priorityAreas: string[];
  routineAnchors: string[];
  operationalRules: string[];
  defaultBriefingStyle: BriefingProfileStyle;
  defaultBriefingSections: BriefingSectionKey[];
}
