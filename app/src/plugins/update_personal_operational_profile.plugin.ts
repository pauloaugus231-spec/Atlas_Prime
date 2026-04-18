import { defineToolPlugin } from "../types/plugin.js";
import type { PersonalOperationalProfile } from "../types/personal-operational-memory.js";

interface UpdatePersonalOperationalProfileParameters {
  displayName?: string;
  primaryRole?: string;
  routineSummary?: string[];
  timezone?: string;
  preferredChannels?: string[];
  preferredAlertChannel?: string;
  priorityAreas?: string[];
  defaultAgendaScope?: PersonalOperationalProfile["defaultAgendaScope"];
  responseStyle?: string;
  briefingPreference?: PersonalOperationalProfile["briefingPreference"];
  detailLevel?: PersonalOperationalProfile["detailLevel"];
  tonePreference?: PersonalOperationalProfile["tonePreference"];
  defaultOperationalMode?: PersonalOperationalProfile["defaultOperationalMode"];
  mobilityPreferences?: string[];
  autonomyPreferences?: string[];
  savedFocus?: string[];
  routineAnchors?: string[];
  operationalRules?: string[];
  carryItems?: string[];
  fieldModeHours?: number;
}

export default defineToolPlugin<UpdatePersonalOperationalProfileParameters>({
  name: "update_personal_operational_profile",
  description: "Updates the user's personal operational base profile.",
  exposeToModel: false,
  parameters: {
    type: "object",
    properties: {
      displayName: {
        type: "string",
      },
      primaryRole: {
        type: "string",
      },
      routineSummary: {
        type: "array",
        items: {
          type: "string",
        },
      },
      timezone: {
        type: "string",
      },
      preferredChannels: {
        type: "array",
        items: {
          type: "string",
        },
      },
      preferredAlertChannel: {
        type: "string",
      },
      priorityAreas: {
        type: "array",
        items: {
          type: "string",
        },
      },
      defaultAgendaScope: {
        type: "string",
        enum: ["primary", "work", "both"],
      },
      responseStyle: {
        type: "string",
      },
      briefingPreference: {
        type: "string",
        enum: ["curto", "executivo", "detalhado"],
      },
      detailLevel: {
        type: "string",
        enum: ["resumo", "equilibrado", "detalhado"],
      },
      tonePreference: {
        type: "string",
        enum: ["objetivo", "humano", "firme", "acolhedor", "executivo"],
      },
      defaultOperationalMode: {
        type: "string",
        enum: ["normal", "field"],
      },
      mobilityPreferences: {
        type: "array",
        items: {
          type: "string",
        },
      },
      autonomyPreferences: {
        type: "array",
        items: {
          type: "string",
        },
      },
      savedFocus: {
        type: "array",
        items: {
          type: "string",
        },
      },
      routineAnchors: {
        type: "array",
        items: {
          type: "string",
        },
      },
      operationalRules: {
        type: "array",
        items: {
          type: "string",
        },
      },
      carryItems: {
        type: "array",
        items: {
          type: "string",
        },
      },
      fieldModeHours: {
        type: "integer",
        minimum: 1,
      },
    },
    additionalProperties: false,
  },
  execute(parameters, context) {
    const profile = context.personalMemory.updateProfile({
      displayName: parameters.displayName,
      primaryRole: parameters.primaryRole,
      routineSummary: parameters.routineSummary,
      timezone: parameters.timezone,
      preferredChannels: parameters.preferredChannels,
      preferredAlertChannel: parameters.preferredAlertChannel,
      priorityAreas: parameters.priorityAreas,
      defaultAgendaScope: parameters.defaultAgendaScope,
      responseStyle: parameters.responseStyle,
      briefingPreference: parameters.briefingPreference,
      detailLevel: parameters.detailLevel,
      tonePreference: parameters.tonePreference,
      defaultOperationalMode: parameters.defaultOperationalMode,
      mobilityPreferences: parameters.mobilityPreferences,
      autonomyPreferences: parameters.autonomyPreferences,
      savedFocus: parameters.savedFocus,
      routineAnchors: parameters.routineAnchors,
      operationalRules: parameters.operationalRules,
      attire: parameters.carryItems ? { carryItems: parameters.carryItems } : undefined,
      fieldModeHours: parameters.fieldModeHours,
    });

    return {
      ok: true,
      profile,
    };
  },
});
