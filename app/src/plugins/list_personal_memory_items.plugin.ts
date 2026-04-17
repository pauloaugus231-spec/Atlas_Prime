import { PERSONAL_MEMORY_ITEM_KINDS } from "../types/personal-operational-memory.js";
import { defineToolPlugin } from "../types/plugin.js";

interface ListPersonalMemoryItemsParameters {
  kind?: (typeof PERSONAL_MEMORY_ITEM_KINDS)[number];
  search?: string;
  limit?: number;
}

export default defineToolPlugin<ListPersonalMemoryItemsParameters>({
  name: "list_personal_memory_items",
  description: "Lists items from the user's personal operational memory store.",
  exposeToModel: false,
  parameters: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: [...PERSONAL_MEMORY_ITEM_KINDS],
        description: "Optional personal memory item category filter.",
      },
      search: {
        type: "string",
        description: "Optional search string in title or content.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 50,
        description: "Maximum number of items to return.",
      },
    },
    additionalProperties: false,
  },
  execute(parameters, context) {
    const items = context.personalMemory.listItems({
      kind: parameters.kind,
      search: parameters.search,
      limit: parameters.limit,
    });

    return {
      ok: true,
      total: items.length,
      items,
      profile: context.personalMemory.getProfile(),
    };
  },
});
