import type { BriefingProfile } from "../types/briefing-profile.js";
import type { DeliveryDestinationPrivacyLevel } from "../types/delivery-destination.js";
import type { PersonalOperationalProfile } from "../types/personal-operational-memory.js";
import { BriefRenderer } from "./brief-renderer.js";
import type { ExecutiveMorningBrief } from "./personal-os.js";
import { BriefingPrivacyPolicy } from "./briefing-privacy-policy.js";

export class SharedBriefingComposer {
  private readonly renderer = new BriefRenderer();

  constructor(private readonly privacyPolicy: BriefingPrivacyPolicy) {}

  compose(input: {
    profile: BriefingProfile;
    brief: ExecutiveMorningBrief;
    personalProfile: PersonalOperationalProfile;
    maxPrivacyLevel?: DeliveryDestinationPrivacyLevel;
  }): { reply: string; effectiveProfile: BriefingProfile; removedSections: string[]; blocked: boolean } {
    const maxPrivacyLevel = input.maxPrivacyLevel ?? (input.profile.audience === "team" ? "team_shareable" : "private");
    const filtered = this.privacyPolicy.filterSections({
      profile: input.personalProfile,
      requestedSections: input.profile.sections,
      maxPrivacyLevel,
      audience: input.profile.audience,
    });

    if (filtered.blocked) {
      return {
        reply: "O perfil atual bloqueia compartilhamento automático deste briefing. Ajuste a política de audiência antes de enviar para equipe.",
        effectiveProfile: { ...input.profile, sections: [] },
        removedSections: filtered.removedSections,
        blocked: true,
      };
    }

    const effectiveProfile: BriefingProfile = {
      ...input.profile,
      sections: filtered.allowedSections,
    };
    const reply = this.renderer.renderForProfile(input.brief, effectiveProfile);
    return {
      reply,
      effectiveProfile,
      removedSections: filtered.removedSections,
      blocked: false,
    };
  }
}
