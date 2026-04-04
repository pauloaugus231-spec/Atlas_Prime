import { defineToolPlugin } from "../types/plugin.js";

interface ListContentHookTemplatesParameters {
  category?: string;
  limit?: number;
}

export default defineToolPlugin<ListContentHookTemplatesParameters>({
  name: "list_content_hook_templates",
  description: "Lists hook templates used to generate and optimize opening lines for short-form content.",
  parameters: {
    type: "object",
    properties: {
      category: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
    },
    additionalProperties: false,
  },
  execute(parameters, context) {
    const hooks = context.contentOps.listHookTemplates({
      category: parameters.category,
      limit: parameters.limit,
    });

    return {
      ok: true,
      total: hooks.length,
      hooks,
    };
  },
});
