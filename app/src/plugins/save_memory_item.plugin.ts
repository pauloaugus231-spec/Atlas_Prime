import {
  MEMORY_CATEGORIES,
  MEMORY_HORIZONS,
  MEMORY_PRIORITIES,
  MEMORY_STAGES,
  MEMORY_STATUSES,
} from "../types/operational-memory.js";
import { defineToolPlugin } from "../types/plugin.js";

interface SaveMemoryItemParameters {
  category: (typeof MEMORY_CATEGORIES)[number];
  title: string;
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

export default defineToolPlugin<SaveMemoryItemParameters>({
  name: "save_memory_item",
  description:
    "Persists an objective, initiative, task, opportunity or note in the user's operational memory, including business scoring factors.",
  parameters: {
    type: "object",
    properties: {
      category: {
        type: "string",
        enum: [...MEMORY_CATEGORIES],
        description: "Type of memory item to save.",
      },
      title: {
        type: "string",
        description: "Short title for the memory item.",
      },
      details: {
        type: "string",
        description: "Optional details that give more context.",
      },
      status: {
        type: "string",
        enum: [...MEMORY_STATUSES],
        description: "Workflow state for the item.",
        default: "open",
      },
      priority: {
        type: "string",
        enum: [...MEMORY_PRIORITIES],
        description: "Relative importance of the item.",
        default: "medium",
      },
      horizon: {
        type: "string",
        enum: [...MEMORY_HORIZONS],
        description: "Expected time horizon for acting on the item.",
        default: "short",
      },
      stage: {
        type: "string",
        enum: [...MEMORY_STAGES],
        description: "Current execution stage for the item.",
        default: "capture",
      },
      project: {
        type: "string",
        description: "Optional project or context label.",
      },
      tags: {
        type: "array",
        items: {
          type: "string",
        },
        description: "Optional tags to classify the item.",
      },
      cash_potential: {
        type: "integer",
        minimum: 1,
        maximum: 5,
        description: "Cash generation potential from 1 to 5.",
      },
      asset_value: {
        type: "integer",
        minimum: 1,
        maximum: 5,
        description: "Long-term asset value from 1 to 5.",
      },
      automation_value: {
        type: "integer",
        minimum: 1,
        maximum: 5,
        description: "Manual-work reduction potential from 1 to 5.",
      },
      scale_value: {
        type: "integer",
        minimum: 1,
        maximum: 5,
        description: "Selling, delivery or scaling leverage from 1 to 5.",
      },
      authority_value: {
        type: "integer",
        minimum: 1,
        maximum: 5,
        description: "Authority and distribution value from 1 to 5.",
      },
      effort: {
        type: "integer",
        minimum: 1,
        maximum: 5,
        description: "Effort required from 1 to 5. Lower is better.",
      },
      confidence: {
        type: "integer",
        minimum: 1,
        maximum: 5,
        description: "Confidence in execution or demand from 1 to 5.",
      },
    },
    required: ["category", "title"],
    additionalProperties: false,
  },
  execute(parameters, context) {
    const item = context.memory.addItem({
      category: parameters.category,
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
      source: "tool:save_memory_item",
    });

    return {
      ok: true,
      item,
    };
  },
});
