import { CONTENT_SERIES_STATUSES } from "../types/content-ops.js";
import { defineToolPlugin } from "../types/plugin.js";

interface UpsertContentSeriesParameters {
  key: string;
  channel_key: string;
  title: string;
  premise?: string;
  cadence?: string;
  status?: (typeof CONTENT_SERIES_STATUSES)[number];
}

export default defineToolPlugin<UpsertContentSeriesParameters>({
  name: "upsert_content_series",
  description: "Creates or updates a content series in the editorial operating system.",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", minLength: 1 },
      channel_key: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1 },
      premise: { type: "string" },
      cadence: { type: "string" },
      status: { type: "string", enum: [...CONTENT_SERIES_STATUSES], default: "testing" },
    },
    required: ["key", "channel_key", "title"],
    additionalProperties: false,
  },
  execute(parameters, context) {
    const series = context.contentOps.upsertSeries({
      key: parameters.key,
      channelKey: parameters.channel_key,
      title: parameters.title,
      premise: parameters.premise,
      cadence: parameters.cadence,
      status: parameters.status,
    });

    return {
      ok: true,
      series,
    };
  },
});
