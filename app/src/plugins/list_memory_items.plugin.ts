import {
  MEMORY_CATEGORIES,
  MEMORY_HORIZONS,
  MEMORY_PRIORITIES,
  MEMORY_STAGES,
  MEMORY_STATUSES,
} from "../types/operational-memory.js";
import { defineToolPlugin } from "../types/plugin.js";

interface ListMemoryItemsParameters {
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

export default defineToolPlugin<ListMemoryItemsParameters>({
  name: "list_memory_items",
  description:
    "Lists items from the user's operational memory for prioritization, review and planning.",
  parameters: {
    type: "object",
    properties: {
      category: {
        type: "string",
        enum: [...MEMORY_CATEGORIES],
        description: "Optional category filter.",
      },
      status: {
        type: "string",
        enum: [...MEMORY_STATUSES],
        description: "Optional workflow status filter.",
      },
      priority: {
        type: "string",
        enum: [...MEMORY_PRIORITIES],
        description: "Optional priority filter.",
      },
      horizon: {
        type: "string",
        enum: [...MEMORY_HORIZONS],
        description: "Optional horizon filter.",
      },
      stage: {
        type: "string",
        enum: [...MEMORY_STAGES],
        description: "Optional execution stage filter.",
      },
      project: {
        type: "string",
        description: "Optional project filter.",
      },
      search: {
        type: "string",
        description: "Optional text search in title or details.",
      },
      include_done: {
        type: "boolean",
        description: "Whether done and archived items should be included.",
        default: false,
      },
      limit: {
        type: "integer",
        description: "Maximum number of items to return.",
        default: 20,
      },
    },
    additionalProperties: false,
  },
  execute(parameters, context) {
    const items = context.memory.listItems({
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
      total: items.length,
      items,
    };
  },
});
