import type { Logger } from "../types/logger.js";
import type { PersonalOperationalProfile } from "../types/personal-operational-memory.js";
import type { BriefingDeliveryChannel, BriefingProfile } from "../types/briefing-profile.js";
import { BriefRenderer } from "./brief-renderer.js";
import type { ExecutiveMorningBrief } from "./personal-os.js";
import {
  findDefaultBriefingProfile,
  findMatchingBriefingProfile,
  syncBriefingProfilesWithLegacyProfile,
} from "./briefing-profile-helpers.js";

interface PersonalMemoryLike {
  getProfile(): PersonalOperationalProfile;
}

interface PersonalOsLike {
  getExecutiveMorningBrief(): Promise<ExecutiveMorningBrief>;
}

interface SharedBriefingComposerLike {
  compose(input: {
    profile: BriefingProfile;
    brief: ExecutiveMorningBrief;
    personalProfile: PersonalOperationalProfile;
  }): {
    reply: string;
    effectiveProfile: BriefingProfile;
    removedSections: string[];
    blocked: boolean;
  };
}

export class BriefingProfileService {
  private readonly renderer = new BriefRenderer();

  constructor(
    private readonly personalMemory: PersonalMemoryLike,
    private readonly personalOs: PersonalOsLike,
    private readonly logger: Logger,
    private readonly sharedBriefingComposer?: SharedBriefingComposerLike,
  ) {}

  listProfiles(): BriefingProfile[] {
    return syncBriefingProfilesWithLegacyProfile(this.personalMemory.getProfile());
  }

  listScheduledProfiles(channel?: BriefingDeliveryChannel): BriefingProfile[] {
    return this.listProfiles().filter((profile) => {
      if (!profile.enabled) {
        return false;
      }
      if (profile.deliveryMode === "manual") {
        return false;
      }
      if (channel && profile.deliveryChannel !== channel) {
        return false;
      }
      return true;
    });
  }

  resolveProfileForPrompt(prompt: string): BriefingProfile | undefined {
    return findMatchingBriefingProfile(this.listProfiles(), prompt);
  }

  getProfile(profileId: string | undefined): BriefingProfile | undefined {
    const profiles = this.listProfiles();
    if (profileId) {
      return profiles.find((item) => item.id === profileId);
    }
    return findDefaultBriefingProfile(profiles);
  }

  async render(input?: { profileId?: string; prompt?: string }): Promise<{
    profile: BriefingProfile;
    brief: ExecutiveMorningBrief;
    reply: string;
  }> {
    const profile = input?.profileId
      ? this.getProfile(input.profileId)
      : input?.prompt
        ? this.resolveProfileForPrompt(input.prompt) ?? this.getProfile(undefined)
        : this.getProfile(undefined);

    if (!profile) {
      throw new Error("No briefing profile is configured.");
    }

    const brief = await this.personalOs.getExecutiveMorningBrief();
    const personalProfile = this.personalMemory.getProfile();
    const sharedResult = profile.audience === "team" && this.sharedBriefingComposer
      ? this.sharedBriefingComposer.compose({
          profile,
          brief,
          personalProfile,
        })
      : undefined;
    const reply = sharedResult?.reply ?? this.renderer.renderForProfile(brief, profile, personalProfile);

    this.logger.debug("Rendered briefing profile", {
      profileId: profile.id,
      name: profile.name,
      deliveryChannel: profile.deliveryChannel,
      audience: profile.audience,
      style: profile.style,
    });

    return {
      profile,
      brief,
      reply,
    };
  }
}
