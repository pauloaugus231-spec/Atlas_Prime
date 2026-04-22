import { defineToolPlugin } from "../types/plugin.js";
import type { PersonalOperationalProfile } from "../types/personal-operational-memory.js";

interface UpdatePersonalOperationalProfileParameters {
  displayName?: string;
  primaryRole?: string;
  userRole?: PersonalOperationalProfile["userRole"];
  profession?: string;
  professionPackId?: string;
  routineSummary?: string[];
  timezone?: string;
  preferredChannels?: string[];
  preferredAlertChannel?: string;
  audiencePolicy?: PersonalOperationalProfile["audiencePolicy"];
  homeAddress?: string;
  homeLocationLabel?: string;
  defaultVehicle?: PersonalOperationalProfile["defaultVehicle"];
  defaultFuelPricePerLiter?: number;
  priorityAreas?: string[];
  defaultAgendaScope?: PersonalOperationalProfile["defaultAgendaScope"];
  responseStyle?: string;
  briefingPreference?: PersonalOperationalProfile["briefingPreference"];
  morningBriefTime?: string;
  briefingProfiles?: PersonalOperationalProfile["briefingProfiles"];
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
      userRole: {
        type: "string",
        enum: ["individual_contributor", "team_lead", "manager", "field_operator", "executive", "regulated_professional", "custom"],
      },
      profession: {
        type: "string",
      },
      professionPackId: {
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
      audiencePolicy: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["self_only", "team_briefer", "mixed"],
          },
          defaultAudience: {
            type: "string",
            enum: ["self", "team"],
          },
          allowSharedBriefings: { type: "boolean" },
          requireReviewForTeamDestinations: { type: "boolean" },
          allowedChannels: {
            type: "array",
            items: {
              type: "string",
              enum: ["telegram", "whatsapp", "email"],
            },
          },
        },
        additionalProperties: false,
      },
      homeAddress: {
        type: "string",
      },
      homeLocationLabel: {
        type: "string",
      },
      defaultVehicle: {
        type: "object",
        properties: {
          name: { type: "string" },
          consumptionKmPerLiter: { type: "number", minimum: 0 },
          fuelType: {
            type: "string",
            enum: ["gasolina", "etanol", "diesel", "flex", "eletrico", "outro"],
          },
        },
        additionalProperties: false,
      },
      defaultFuelPricePerLiter: {
        type: "number",
        minimum: 0,
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
      morningBriefTime: {
        type: "string",
        pattern: "^\\d{2}:\\d{2}$",
      },
      briefingProfiles: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            aliases: {
              type: "array",
              items: { type: "string" },
            },
            enabled: { type: "boolean" },
            deliveryMode: {
              type: "string",
              enum: ["scheduled", "manual", "both"],
            },
            deliveryChannel: {
              type: "string",
              enum: ["telegram", "whatsapp", "email"],
            },
            audience: {
              type: "string",
              enum: ["self", "team"],
            },
            targetRecipientIds: {
              type: "array",
              items: { type: "string" },
            },
            targetLabel: { type: "string" },
            time: {
              type: "string",
              pattern: "^\\d{2}:\\d{2}$",
            },
            weekdays: {
              type: "array",
              items: { type: "integer", minimum: 0, maximum: 6 },
            },
            timezone: { type: "string" },
            style: {
              type: "string",
              enum: ["auto", "compact", "executive", "detailed"],
            },
            sections: {
              type: "array",
              items: {
                type: "string",
                enum: [
                  "weather",
                  "focus",
                  "next_action",
                  "autonomy",
                  "goals",
                  "agenda",
                  "emails",
                  "tasks",
                  "approvals",
                  "workflows",
                  "mobility",
                  "motivation",
                ],
              },
            },
          },
          additionalProperties: false,
        },
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
      userRole: parameters.userRole,
      profession: parameters.profession,
      professionPackId: parameters.professionPackId,
      routineSummary: parameters.routineSummary,
      timezone: parameters.timezone,
      preferredChannels: parameters.preferredChannels,
      preferredAlertChannel: parameters.preferredAlertChannel,
      audiencePolicy: parameters.audiencePolicy,
      homeAddress: parameters.homeAddress,
      homeLocationLabel: parameters.homeLocationLabel,
      defaultVehicle: parameters.defaultVehicle,
      defaultFuelPricePerLiter: parameters.defaultFuelPricePerLiter,
      priorityAreas: parameters.priorityAreas,
      defaultAgendaScope: parameters.defaultAgendaScope,
      responseStyle: parameters.responseStyle,
      briefingPreference: parameters.briefingPreference,
      morningBriefTime: parameters.morningBriefTime,
      briefingProfiles: parameters.briefingProfiles,
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
