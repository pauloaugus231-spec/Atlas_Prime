import type { BriefingSectionKey } from "../types/briefing-profile.js";
import type { DeliveryDestinationPrivacyLevel } from "../types/delivery-destination.js";
import type { PersonalOperationalProfile } from "../types/personal-operational-memory.js";

const SECTION_LEVEL: Record<BriefingSectionKey, DeliveryDestinationPrivacyLevel> = {
  weather: "public",
  focus: "team_shareable",
  next_action: "team_shareable",
  autonomy: "private",
  goals: "team_shareable",
  agenda: "team_shareable",
  emails: "private",
  tasks: "private",
  approvals: "restricted",
  workflows: "restricted",
  mobility: "restricted",
  motivation: "public",
};

const PRIVACY_ORDER: Record<DeliveryDestinationPrivacyLevel, number> = {
  public: 0,
  team_shareable: 1,
  restricted: 2,
  private: 3,
};

export class BriefingPrivacyPolicy {
  classifySection(section: BriefingSectionKey): DeliveryDestinationPrivacyLevel {
    return SECTION_LEVEL[section] ?? "private";
  }

  filterSections(input: {
    profile: Pick<PersonalOperationalProfile, "audiencePolicy">;
    requestedSections: BriefingSectionKey[];
    maxPrivacyLevel: DeliveryDestinationPrivacyLevel;
    audience: "self" | "team";
  }): { allowedSections: BriefingSectionKey[]; removedSections: BriefingSectionKey[]; blocked: boolean } {
    if (input.audience === "team" && input.profile.audiencePolicy?.allowSharedBriefings === false) {
      return {
        allowedSections: [],
        removedSections: [...input.requestedSections],
        blocked: true,
      };
    }

    const allowedSections = input.requestedSections.filter((section) => {
      const level = this.classifySection(section);
      return PRIVACY_ORDER[level] <= PRIVACY_ORDER[input.maxPrivacyLevel];
    });
    const removedSections = input.requestedSections.filter((section) => !allowedSections.includes(section));
    return {
      allowedSections,
      removedSections,
      blocked: false,
    };
  }
}
