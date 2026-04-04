import { CONTENT_SERIES_STATUSES } from "../types/content-ops.js";
import { defineToolPlugin } from "../types/plugin.js";

interface ListContentSeriesParameters {
  channel_key?: string;
  status?: (typeof CONTENT_SERIES_STATUSES)[number];
  limit?: number;
}

export default defineToolPlugin<ListContentSeriesParameters>({
  name: "list_content_series",
  description: "Lists content series configured for editorial channels.",
  parameters: {
    type: "object",
    properties: {
      channel_key: { type: "string" },
      status: { type: "string", enum: [...CONTENT_SERIES_STATUSES] },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
    },
    additionalProperties: false,
  },
  execute(parameters, context) {
    const series = context.contentOps.listSeries({
      channelKey: parameters.channel_key,
      status: parameters.status,
      limit: parameters.limit,
    });

    return {
      ok: true,
      total: series.length,
      series,
    };
  },
});
