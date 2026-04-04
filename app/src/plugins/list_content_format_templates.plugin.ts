import { defineToolPlugin } from "../types/plugin.js";

interface ListContentFormatTemplatesParameters {
  active_only?: boolean;
  limit?: number;
}

export default defineToolPlugin<ListContentFormatTemplatesParameters>({
  name: "list_content_format_templates",
  description: "Lists editorial format templates available for content generation.",
  parameters: {
    type: "object",
    properties: {
      active_only: { type: "boolean", default: true },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
    },
    additionalProperties: false,
  },
  execute(parameters, context) {
    const templates = context.contentOps.listFormatTemplates({
      activeOnly: parameters.active_only,
      limit: parameters.limit,
    });

    return {
      ok: true,
      total: templates.length,
      templates,
    };
  },
});
