import {
  MEMORY_HORIZONS,
  MEMORY_PRIORITIES,
  MEMORY_STAGES,
  MEMORY_STATUSES,
} from "../types/operational-memory.js";
import { defineToolPlugin } from "../types/plugin.js";

interface UpdateMemoryItemParameters {
  id: number;
  title?: string;
  details?: string;
  status?: (typeof MEMORY_STATUSES)[number];
  priority?: (typeof MEMORY_PRIORITIES)[number];
  horizon?: (typeof MEMORY_HORIZONS)[number];
  stage?: (typeof MEMORY_STAGES)[number];
  project?: string;
  tags?: string[];
  cash_potential?: number;
  asset_value?: number;
  automation_value?: number;
  scale_value?: number;
  authority_value?: number;
  effort?: number;
  confidence?: number;
}

export default defineToolPlugin<UpdateMemoryItemParameters>({
  name: "update_memory_item",
  description:
    "Updates an existing item in the user's operational memory, including business scoring factors.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "integer",
        description: "Numeric id of the memory item to update.",
      },
      title: {
        type: "string",
        description: "Optional replacement title.",
      },
      details: {
        type: "string",
        description: "Optional replacement details.",
      },
      status: {
        type: "string",
        enum: [...MEMORY_STATUSES],
        description: "Optional new workflow status.",
      },
      priority: {
        type: "string",
        enum: [...MEMORY_PRIORITIES],
        description: "Optional new priority.",
      },
      horizon: {
        type: "string",
        enum: [...MEMORY_HORIZONS],
        description: "Optional new time horizon.",
      },
      stage: {
        type: "string",
        enum: [...MEMORY_STAGES],
        description: "Optional new execution stage.",
      },
      project: {
        type: "string",
        description: "Optional project label.",
      },
      tags: {
        type: "array",
        items: {
          type: "string",
        },
        description: "Optional replacement tag list.",
      },
      cash_potential: {
        type: "integer",
        minimum: 1,
        maximum: 5,
      },
      asset_value: {
        type: "integer",
        minimum: 1,
        maximum: 5,
      },
      automation_value: {
        type: "integer",
        minimum: 1,
        maximum: 5,
      },
      scale_value: {
        type: "integer",
        minimum: 1,
        maximum: 5,
      },
      authority_value: {
        type: "integer",
        minimum: 1,
        maximum: 5,
      },
      effort: {
        type: "integer",
        minimum: 1,
        maximum: 5,
      },
      confidence: {
        type: "integer",
        minimum: 1,
        maximum: 5,
      },
    },
    required: ["id"],
    additionalProperties: false,
  },
  execute(parameters, context) {
    const item = context.memory.updateItem({
      id: parameters.id,
      title: parameters.title,
      details: parameters.details,
      status: parameters.status,
      priority: parameters.priority,
      horizon: parameters.horizon,
      stage: parameters.stage,
      project: parameters.project,
      tags: parameters.tags,
      cashPotential: parameters.cash_potential,
      assetValue: parameters.asset_value,
      automationValue: parameters.automation_value,
      scaleValue: parameters.scale_value,
      authorityValue: parameters.authority_value,
      effort: parameters.effort,
      confidence: parameters.confidence,
    });

    return {
      ok: true,
      item,
    };
  },
});
