import { CONTENT_FORMATS, CONTENT_PLATFORMS, CONTENT_STATUSES } from "../types/content-ops.js";
import { defineToolPlugin } from "../types/plugin.js";

interface SaveContentItemParameters {
  title: string;
  platform: (typeof CONTENT_PLATFORMS)[number];
  format: (typeof CONTENT_FORMATS)[number];
  status?: (typeof CONTENT_STATUSES)[number];
  pillar?: string;
  audience?: string;
  hook?: string;
  call_to_action?: string;
  notes?: string;
  target_date?: string;
  asset_path?: string;
}

export default defineToolPlugin<SaveContentItemParameters>({
  name: "save_content_item",
  description:
    "Persists a content idea, draft, scheduled asset or published piece for social media operations.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short working title for the content item." },
      platform: { type: "string", enum: [...CONTENT_PLATFORMS] },
      format: { type: "string", enum: [...CONTENT_FORMATS] },
      status: { type: "string", enum: [...CONTENT_STATUSES], default: "idea" },
      pillar: { type: "string" },
      audience: { type: "string" },
      hook: { type: "string" },
      call_to_action: { type: "string" },
      notes: { type: "string" },
      target_date: { type: "string", description: "ISO date or datetime." },
      asset_path: { type: "string", description: "Optional workspace path to the draft or asset." },
    },
    required: ["title", "platform", "format"],
    additionalProperties: false,
  },
  execute(parameters, context) {
    const item = context.contentOps.createItem({
      title: parameters.title,
      platform: parameters.platform,
      format: parameters.format,
      status: parameters.status,
      pillar: parameters.pillar,
      audience: parameters.audience,
      hook: parameters.hook,
      callToAction: parameters.call_to_action,
      notes: parameters.notes,
      targetDate: parameters.target_date,
      assetPath: parameters.asset_path,
    });

    return {
      ok: true,
      item,
    };
  },
});
