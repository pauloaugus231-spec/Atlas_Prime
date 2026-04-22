import type { PersonalOperationalProfile, UpdatePersonalOperationalProfileInput } from "../types/personal-operational-memory.js";
import type { UserRole } from "../types/user-role.js";
import type { AudiencePolicyProfile } from "../types/audience-policy.js";
import { getBriefingTemplatePack } from "./briefing-template-packs.js";

const DEFAULT_AUDIENCE_BY_ROLE: Record<UserRole, AudiencePolicyProfile> = {
  individual_contributor: {
    mode: "self_only",
    defaultAudience: "self",
    allowSharedBriefings: false,
    requireReviewForTeamDestinations: true,
    allowedChannels: ["telegram", "email"],
  },
  team_lead: {
    mode: "team_briefer",
    defaultAudience: "team",
    allowSharedBriefings: true,
    requireReviewForTeamDestinations: true,
    allowedChannels: ["telegram", "email", "whatsapp"],
  },
  manager: {
    mode: "mixed",
    defaultAudience: "self",
    allowSharedBriefings: true,
    requireReviewForTeamDestinations: true,
    allowedChannels: ["telegram", "email"],
  },
  field_operator: {
    mode: "self_only",
    defaultAudience: "self",
    allowSharedBriefings: false,
    requireReviewForTeamDestinations: true,
    allowedChannels: ["telegram", "whatsapp"],
  },
  executive: {
    mode: "mixed",
    defaultAudience: "self",
    allowSharedBriefings: true,
    requireReviewForTeamDestinations: true,
    allowedChannels: ["telegram", "email"],
  },
  regulated_professional: {
    mode: "self_only",
    defaultAudience: "self",
    allowSharedBriefings: false,
    requireReviewForTeamDestinations: true,
    allowedChannels: ["telegram", "email"],
  },
  custom: {
    mode: "mixed",
    defaultAudience: "self",
    allowSharedBriefings: false,
    requireReviewForTeamDestinations: true,
    allowedChannels: ["telegram", "email"],
  },
};

export class UserRoleProfileService {
  inferRole(profile: PersonalOperationalProfile): UserRole {
    return profile.userRole ?? "custom";
  }

  getAudiencePolicy(role: UserRole | undefined): AudiencePolicyProfile {
    return DEFAULT_AUDIENCE_BY_ROLE[role ?? "custom"];
  }

  buildRoleDefaults(role: UserRole | undefined): Pick<UpdatePersonalOperationalProfileInput, "audiencePolicy" | "briefingPreference" | "detailLevel" | "tonePreference"> {
    const effectiveRole = role ?? "custom";
    const briefingPack = getBriefingTemplatePack(effectiveRole);
    return {
      audiencePolicy: this.getAudiencePolicy(effectiveRole),
      briefingPreference: briefingPack.style === "compact" ? "curto" : briefingPack.style === "detailed" ? "detalhado" : "executivo",
      detailLevel: briefingPack.style === "compact" ? "resumo" : briefingPack.style === "detailed" ? "detalhado" : "equilibrado",
      tonePreference: effectiveRole === "field_operator" ? "objetivo" : effectiveRole === "executive" ? "executivo" : "humano",
    };
  }
}
