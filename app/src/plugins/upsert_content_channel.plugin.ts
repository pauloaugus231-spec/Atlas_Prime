import { CONTENT_CHANNEL_STATUSES, CONTENT_PLATFORMS } from "../types/content-ops.js";
import { defineToolPlugin } from "../types/plugin.js";

interface UpsertContentChannelParameters {
  key: string;
  name: string;
  platform: (typeof CONTENT_PLATFORMS)[number];
  niche?: string;
  persona?: string;
  frequency_per_week?: number;
  status?: (typeof CONTENT_CHANNEL_STATUSES)[number];
  primary_goal?: string;
  style_notes?: string;
  voice_profile?: string;
  language?: string;
}

export default defineToolPlugin<UpsertContentChannelParameters>({
  name: "upsert_content_channel",
  description: "Creates or updates an editorial channel configuration for content operations.",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", minLength: 1 },
      name: { type: "string", minLength: 1 },
      platform: { type: "string", enum: [...CONTENT_PLATFORMS] },
      niche: { type: "string" },
      persona: { type: "string" },
      frequency_per_week: { type: "integer", minimum: 1, maximum: 30 },
      status: { type: "string", enum: [...CONTENT_CHANNEL_STATUSES], default: "active" },
      primary_goal: { type: "string" },
      style_notes: { type: "string" },
      voice_profile: { type: "string" },
      language: { type: "string" },
    },
    required: ["key", "name", "platform"],
    additionalProperties: false,
  },
  execute(parameters, context) {
    const channel = context.contentOps.upsertChannel({
      key: parameters.key,
      name: parameters.name,
      platform: parameters.platform,
      niche: parameters.niche,
      persona: parameters.persona,
      frequencyPerWeek: parameters.frequency_per_week,
      status: parameters.status,
      primaryGoal: parameters.primary_goal,
      styleNotes: parameters.style_notes,
      voiceProfile: parameters.voice_profile,
      language: parameters.language,
    });

    return {
      ok: true,
      channel,
    };
  },
});
