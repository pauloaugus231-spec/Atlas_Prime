import type { BriefingProfile } from "./briefing-profile.js";

export interface IdentityProfile {
  displayName: string;
  primaryRole: string;
  routineSummary: string[];
  timezone: string;
  preferredChannels: string[];
  preferredAlertChannel?: string;
  homeAddress?: string;
  homeLocationLabel?: string;
  defaultVehicle?: {
    name?: string;
    consumptionKmPerLiter?: number;
    fuelType?: "gasolina" | "etanol" | "diesel" | "flex" | "eletrico" | "outro";
  };
  defaultFuelPricePerLiter?: number;
  priorityAreas: string[];
  defaultAgendaScope: "primary" | "work" | "both";
  workCalendarAliases: string[];
  responseStyle: string;
  briefingPreference: "curto" | "executivo" | "detalhado";
  morningBriefTime?: string;
  briefingProfiles?: BriefingProfile[];
  detailLevel: "resumo" | "equilibrado" | "detalhado";
  tonePreference: "objetivo" | "humano" | "firme" | "acolhedor" | "executivo";
  defaultOperationalMode: "normal" | "field";
  mobilityPreferences: string[];
  autonomyPreferences: string[];
  savedFocus: string[];
  routineAnchors: string[];
  operationalRules: string[];
  attire: {
    umbrellaProbabilityThreshold: number;
    coldTemperatureC: number;
    lightClothingTemperatureC: number;
    carryItems: string[];
  };
  fieldModeHours: number;
}

export interface UpdateIdentityProfileInput {
  displayName?: string;
  primaryRole?: string;
  routineSummary?: string[];
  timezone?: string;
  preferredChannels?: string[];
  preferredAlertChannel?: string;
  homeAddress?: string;
  homeLocationLabel?: string;
  defaultVehicle?: Partial<IdentityProfile["defaultVehicle"]>;
  defaultFuelPricePerLiter?: number;
  priorityAreas?: string[];
  defaultAgendaScope?: IdentityProfile["defaultAgendaScope"];
  workCalendarAliases?: string[];
  responseStyle?: string;
  briefingPreference?: IdentityProfile["briefingPreference"];
  morningBriefTime?: string;
  briefingProfiles?: BriefingProfile[];
  detailLevel?: IdentityProfile["detailLevel"];
  tonePreference?: IdentityProfile["tonePreference"];
  defaultOperationalMode?: IdentityProfile["defaultOperationalMode"];
  mobilityPreferences?: string[];
  autonomyPreferences?: string[];
  savedFocus?: string[];
  routineAnchors?: string[];
  operationalRules?: string[];
  attire?: Partial<IdentityProfile["attire"]>;
  fieldModeHours?: number;
}
