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
  channel_key?: string;
  series_key?: string;
  format_template_key?: string;
  idea_score?: number;
  score_reason?: string;
  queue_priority?: number;
  review_feedback_category?: string;
  review_feedback_reason?: string;
  last_reviewed_at?: string;
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
      channel_key: { type: "string" },
      series_key: { type: "string" },
      format_template_key: { type: "string" },
      idea_score: { type: "number", minimum: 0, maximum: 100 },
      score_reason: { type: "string" },
      queue_priority: { type: "integer", minimum: 0, maximum: 100 },
      review_feedback_category: { type: "string" },
      review_feedback_reason: { type: "string" },
      last_reviewed_at: { type: "string" },
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
      channelKey: parameters.channel_key,
      seriesKey: parameters.series_key,
      formatTemplateKey: parameters.format_template_key,
      ideaScore: parameters.idea_score,
      scoreReason: parameters.score_reason,
      queuePriority: parameters.queue_priority,
      reviewFeedbackCategory: parameters.review_feedback_category,
      reviewFeedbackReason: parameters.review_feedback_reason,
      lastReviewedAt: parameters.last_reviewed_at,
    });

    return {
      ok: true,
      item,
    };
  },
});
