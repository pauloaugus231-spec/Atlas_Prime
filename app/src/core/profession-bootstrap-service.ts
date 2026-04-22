import type { PersonalOperationalProfile, UpdatePersonalOperationalProfileInput } from "../types/personal-operational-memory.js";
import type { ProfessionPack } from "../types/profession-pack.js";
import { ProfessionPackService } from "./profession-pack-service.js";
import { UserRoleProfileService } from "./user-role-profile-service.js";

export class ProfessionBootstrapService {
  constructor(
    private readonly professions: ProfessionPackService,
    private readonly roles: UserRoleProfileService,
  ) {}

  resolvePack(profile: PersonalOperationalProfile): ProfessionPack | undefined {
    return this.professions.getById(profile.professionPackId) ?? this.professions.detectByProfession(profile.profession);
  }

  buildBootstrapPatch(profile: PersonalOperationalProfile): UpdatePersonalOperationalProfileInput {
    const pack = this.resolvePack(profile);
    const shouldBootstrapRole = !profile.userRole || profile.userRole === "custom";
    const role = shouldBootstrapRole ? (pack?.suggestedRole ?? "custom") : profile.userRole;
    const roleDefaults = this.roles.buildRoleDefaults(role);

    return {
      ...(shouldBootstrapRole ? { userRole: role } : {}),
      ...(pack?.id && !profile.professionPackId ? { professionPackId: pack.id } : {}),
      ...(profile.audiencePolicy ? {} : { audiencePolicy: roleDefaults.audiencePolicy }),
      ...(profile.priorityAreas.length > 0 || !pack ? {} : { priorityAreas: pack.priorityAreas }),
      ...(profile.routineAnchors.length > 0 || !pack ? {} : { routineAnchors: pack.routineAnchors }),
      ...(profile.operationalRules.length > 0 || !pack ? {} : { operationalRules: pack.operationalRules }),
      ...(profile.briefingPreference ? {} : { briefingPreference: roleDefaults.briefingPreference }),
      ...(profile.detailLevel ? {} : { detailLevel: roleDefaults.detailLevel }),
      ...(profile.tonePreference ? {} : { tonePreference: roleDefaults.tonePreference }),
    };
  }

  summarize(profile: PersonalOperationalProfile): string | undefined {
    const pack = this.resolvePack(profile);
    if (!profile.userRole && !pack) {
      return undefined;
    }
    return [
      profile.userRole ? `papel ${profile.userRole}` : undefined,
      profile.profession ? `profissão ${profile.profession}` : undefined,
      pack ? `pack ${pack.label}` : undefined,
    ].filter(Boolean).join(" | ");
  }
}
