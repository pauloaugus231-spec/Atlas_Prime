import { CONTENT_CHANNEL_STATUSES, CONTENT_PLATFORMS } from "../types/content-ops.js";
import { defineToolPlugin } from "../types/plugin.js";

interface ListContentChannelsParameters {
  platform?: (typeof CONTENT_PLATFORMS)[number];
  status?: (typeof CONTENT_CHANNEL_STATUSES)[number];
  limit?: number;
}

export default defineToolPlugin<ListContentChannelsParameters>({
  name: "list_content_channels",
  description: "Lists editorial channels configured in the local content operating system.",
  parameters: {
    type: "object",
    properties: {
      platform: { type: "string", enum: [...CONTENT_PLATFORMS] },
      status: { type: "string", enum: [...CONTENT_CHANNEL_STATUSES] },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
    },
    additionalProperties: false,
  },
  execute(parameters, context) {
    const channels = context.contentOps.listChannels({
      platform: parameters.platform,
      status: parameters.status,
      limit: parameters.limit,
    });

    return {
      ok: true,
      total: channels.length,
      channels,
    };
  },
});
