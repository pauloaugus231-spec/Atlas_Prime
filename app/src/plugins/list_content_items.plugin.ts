import { CONTENT_PLATFORMS, CONTENT_STATUSES } from "../types/content-ops.js";
import { defineToolPlugin } from "../types/plugin.js";

interface ListContentItemsParameters {
  platform?: (typeof CONTENT_PLATFORMS)[number];
  status?: (typeof CONTENT_STATUSES)[number];
  search?: string;
  limit?: number;
}

export default defineToolPlugin<ListContentItemsParameters>({
  name: "list_content_items",
  description: "Lists persisted social media and content items for planning or execution.",
  parameters: {
    type: "object",
    properties: {
      platform: { type: "string", enum: [...CONTENT_PLATFORMS] },
      status: { type: "string", enum: [...CONTENT_STATUSES] },
      search: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
    },
    additionalProperties: false,
  },
  execute(parameters, context) {
    const items = context.contentOps.listItems({
      platform: parameters.platform,
      status: parameters.status,
      search: parameters.search,
      limit: parameters.limit,
    });

    return {
      ok: true,
      total: items.length,
      items,
    };
  },
});
