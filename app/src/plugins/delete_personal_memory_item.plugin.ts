import { defineToolPlugin } from "../types/plugin.js";

interface DeletePersonalMemoryItemParameters {
  id: number;
}

export default defineToolPlugin<DeletePersonalMemoryItemParameters>({
  name: "delete_personal_memory_item",
  description: "Deletes an item from the user's personal operational memory store.",
  exposeToModel: false,
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "integer",
        description: "Numeric id of the personal memory item.",
      },
    },
    required: ["id"],
    additionalProperties: false,
  },
  execute(parameters, context) {
    const item = context.personalMemory.deleteItem(parameters.id);
    return {
      ok: true,
      item,
    };
  },
});
