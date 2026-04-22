import process from "node:process";
import { extractPersonalOperationalProfileUpdate } from "../src/core/generic-prompt-helpers.js";
import { ProfessionBootstrapService } from "../src/core/profession-bootstrap-service.js";
import { ProfessionPackService } from "../src/core/profession-pack-service.js";
import { UserRoleProfileService } from "../src/core/user-role-profile-service.js";
import type { PersonalOperationalProfile } from "../src/types/personal-operational-memory.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const baseProfile: PersonalOperationalProfile = {
  displayName: "Paulo",
  primaryRole: "operador",
  userRole: "custom",
  routineSummary: [],
  timezone: "America/Sao_Paulo",
  preferredChannels: ["telegram"],
  audiencePolicy: {
    mode: "mixed",
    defaultAudience: "self",
    allowSharedBriefings: false,
    requireReviewForTeamDestinations: true,
    allowedChannels: ["telegram", "email"],
  },
  priorityAreas: [],
  defaultAgendaScope: "both",
  workCalendarAliases: [],
  responseStyle: "direto e objetivo",
  briefingPreference: "executivo",
  morningBriefTime: "06:30",
  briefingProfiles: [],
  detailLevel: "equilibrado",
  tonePreference: "humano",
  defaultOperationalMode: "normal",
  mobilityPreferences: [],
  autonomyPreferences: [],
  savedFocus: [],
  routineAnchors: [],
  operationalRules: [],
  attire: {
    umbrellaProbabilityThreshold: 60,
    coldTemperatureC: 14,
    lightClothingTemperatureC: 24,
    carryItems: [],
  },
  fieldModeHours: 18,
};

function run(): void {
  const professionPacks = new ProfessionPackService();
  const userRoleProfiles = new UserRoleProfileService();
  const bootstrap = new ProfessionBootstrapService(professionPacks, userRoleProfiles);
  const results: EvalResult[] = [];

  const mechanicUpdate = extractPersonalOperationalProfileUpdate("sou mecânico e lidero equipe", baseProfile);
  results.push({
    name: "human_model_detects_profession_and_role_from_natural_prompt",
    passed: mechanicUpdate?.profile.profession === "mecânico" && mechanicUpdate.profile.professionPackId === "mechanic" && mechanicUpdate.profile.userRole === "team_lead",
    detail: JSON.stringify(mechanicUpdate, null, 2),
  });

  const doctorUpdate = extractPersonalOperationalProfileUpdate("sou médico e isso é só para mim", baseProfile);
  results.push({
    name: "human_model_detects_regulated_profession_and_self_only_policy",
    passed: doctorUpdate?.profile.professionPackId === "doctor" && doctorUpdate.profile.userRole === "regulated_professional" && doctorUpdate.profile.audiencePolicy?.allowSharedBriefings === false,
    detail: JSON.stringify(doctorUpdate, null, 2),
  });

  const bootstrapped = bootstrap.buildBootstrapPatch({
    ...baseProfile,
    profession: "consultor",
    professionPackId: "consultant",
  });
  results.push({
    name: "profession_bootstrap_applies_defaults_for_pack",
    passed: bootstrapped.userRole === "manager" && (bootstrapped.priorityAreas?.length ?? 0) > 0 && (bootstrapped.operationalRules?.length ?? 0) > 0,
    detail: JSON.stringify(bootstrapped, null, 2),
  });

  const failures = results.filter((item) => !item.passed);
  for (const item of results.filter((entry) => entry.passed)) {
    console.log(`PASS ${item.name}`);
  }

  if (failures.length > 0) {
    console.error("");
    for (const failure of failures) {
      console.error(`FAIL ${failure.name}`);
      if (failure.detail) {
        console.error(failure.detail);
      }
      console.error("");
    }
    process.exitCode = 1;
    return;
  }

  console.log(`\nHuman model evals ok: ${results.length}/${results.length}`);
}

run();
