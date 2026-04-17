import { PERSONAL_MEMORY_ITEM_KINDS } from "../types/personal-operational-memory.js";
import { defineToolPlugin } from "../types/plugin.js";

interface SavePersonalMemoryItemParameters {
  kind?: (typeof PERSONAL_MEMORY_ITEM_KINDS)[number];
  title: string;
  content: string;
  tags?: string[];
}

export default defineToolPlugin<SavePersonalMemoryItemParameters>({
  name: "save_personal_memory_item",
  description: "Saves an item in the user's personal operational memory store.",
  exposeToModel: false,
  parameters: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: [...PERSONAL_MEMORY_ITEM_KINDS],
        description: "Optional personal memory item category.",
      },
      title: {
        type: "string",
        description: "Short label for the memory item.",
      },
      content: {
        type: "string",
        description: "Operational content to persist.",
      },
      tags: {
        type: "array",
        items: {
          type: "string",
        },
        description: "Optional tags for the personal memory item.",
      },
    },
    required: ["title", "content"],
    additionalProperties: false,
  },
  execute(parameters, context) {
    const item = context.personalMemory.saveItem({
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
