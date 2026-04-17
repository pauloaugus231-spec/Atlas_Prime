import { PERSONAL_MEMORY_ITEM_KINDS } from "../types/personal-operational-memory.js";
import { defineToolPlugin } from "../types/plugin.js";

interface UpdatePersonalMemoryItemParameters {
  id: number;
  kind?: (typeof PERSONAL_MEMORY_ITEM_KINDS)[number];
  title?: string;
  content?: string;
  tags?: string[];
}

export default defineToolPlugin<UpdatePersonalMemoryItemParameters>({
  name: "update_personal_memory_item",
  description: "Updates an existing item in the user's personal operational memory store.",
  exposeToModel: false,
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "integer",
        description: "Numeric id of the personal memory item.",
      },
      kind: {
        type: "string",
        enum: [...PERSONAL_MEMORY_ITEM_KINDS],
        description: "Optional replacement category.",
      },
      title: {
        type: "string",
        description: "Optional replacement title.",
      },
      content: {
        type: "string",
        description: "Optional replacement content.",
      },
      tags: {
        type: "array",
        items: {
          type: "string",
        },
        description: "Optional replacement tag list.",
      },
    },
    required: ["id"],
    additionalProperties: false,
  },
  execute(parameters, context) {
    const item = context.personalMemory.updateItem({
      id: parameters.id,
      kind: parameters.kind,
      title: parameters.title,
      content: parameters.content,
      tags: parameters.tags,
    });

    return {
      ok: true,
      item,
    };
  },
});
