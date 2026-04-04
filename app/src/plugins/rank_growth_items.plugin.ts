import {
  MEMORY_CATEGORIES,
  MEMORY_HORIZONS,
  MEMORY_PRIORITIES,
  MEMORY_STAGES,
  MEMORY_STATUSES,
} from "../types/operational-memory.js";
import { defineToolPlugin } from "../types/plugin.js";

interface RankGrowthItemsParameters {
  category?: (typeof MEMORY_CATEGORIES)[number];
  status?: (typeof MEMORY_STATUSES)[number];
  priority?: (typeof MEMORY_PRIORITIES)[number];
  horizon?: (typeof MEMORY_HORIZONS)[number];
  stage?: (typeof MEMORY_STAGES)[number];
  project?: string;
  search?: string;
  include_done?: boolean;
  limit?: number;
}

export default defineToolPlugin<RankGrowthItemsParameters>({
  name: "rank_growth_items",
  description:
    "Ranks operational memory items by business impact using cash, asset, automation, scale, authority, effort and confidence.",
  parameters: {
    type: "object",
    properties: {
      category: {
        type: "string",
        enum: [...MEMORY_CATEGORIES],
      },
      status: {
        type: "string",
        enum: [...MEMORY_STATUSES],
      },
      priority: {
        type: "string",
        enum: [...MEMORY_PRIORITIES],
      },
      horizon: {
        type: "string",
        enum: [...MEMORY_HORIZONS],
      },
      stage: {
        type: "string",
        enum: [...MEMORY_STAGES],
      },
      project: {
        type: "string",
      },
      search: {
        type: "string",
      },
      include_done: {
        type: "boolean",
        default: false,
      },
      limit: {
        type: "integer",
        default: 10,
      },
    },
    additionalProperties: false,
  },
  execute(parameters, context) {
    const ranked = context.memory.rankItems({
      category: parameters.category,
      status: parameters.status,
      priority: parameters.priority,
      horizon: parameters.horizon,
      stage: parameters.stage,
      project: parameters.project,
      search: parameters.search,
      includeDone: parameters.include_done,
      limit: parameters.limit,
    });

    return {
      ok: true,
      total: ranked.length,
      ranked,
    };
  },
});
