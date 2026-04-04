import { CONTENT_FORMATS, CONTENT_PLATFORMS, CONTENT_STATUSES } from "../types/content-ops.js";
import { defineToolPlugin } from "../types/plugin.js";

interface UpdateContentItemParameters {
  id: number;
  title?: string;
  platform?: (typeof CONTENT_PLATFORMS)[number];
  format?: (typeof CONTENT_FORMATS)[number];
  status?: (typeof CONTENT_STATUSES)[number];
  pillar?: string;
  audience?: string;
  hook?: string;
  call_to_action?: string;
  notes?: string;
  target_date?: string;
  asset_path?: string;
}

export default defineToolPlugin<UpdateContentItemParameters>({
  name: "update_content_item",
  description: "Updates a content item status, date or metadata in the local content operations store.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "integer", minimum: 1 },
      title: { type: "string" },
      platform: { type: "string", enum: [...CONTENT_PLATFORMS] },
      format: { type: "string", enum: [...CONTENT_FORMATS] },
      status: { type: "string", enum: [...CONTENT_STATUSES] },
      pillar: { type: "string" },
      audience: { type: "string" },
      hook: { type: "string" },
      call_to_action: { type: "string" },
      notes: { type: "string" },
      target_date: { type: "string" },
      asset_path: { type: "string" },
    },
    required: ["id"],
    additionalProperties: false,
  },
  execute(parameters, context) {
    const item = context.contentOps.updateItem({
      id: parameters.id,
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
