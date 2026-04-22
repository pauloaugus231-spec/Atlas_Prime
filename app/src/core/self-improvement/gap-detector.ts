import type { ProductGapRecord } from "../../types/product-gaps.js";
import type { FailedRequestRecord, ProductFeedbackRecord, ImprovementBacklogItem } from "../../types/self-improvement.js";

export class GapDetector {
  buildBacklog(input: {
    productGaps: ProductGapRecord[];
    failedRequests: FailedRequestRecord[];
    feedback: ProductFeedbackRecord[];
  }): ImprovementBacklogItem[] {
    const now = new Date().toISOString();
    const items: ImprovementBacklogItem[] = [];

    for (const gap of input.productGaps.slice(0, 8)) {
      items.push({
        id: `gap:${gap.id}`,
        kind: "product_gap",
        title: gap.inferredObjective,
        detail: `${gap.description} | faltando: ${gap.missingCapabilities.join(", ") || "n/d"}`,
        priority: gap.impact,
        sourceRef: String(gap.id),
        status: gap.status === "implemented" ? "implemented" : gap.status === "dismissed" ? "dismissed" : gap.status === "reviewed" ? "reviewed" : "open",
        createdAt: gap.createdAt,
        updatedAt: gap.updatedAt,
      });
    }

    for (const failure of input.failedRequests.slice(0, 6)) {
      items.push({
        id: `failure:${failure.id}`,
        kind: "failed_request",
        title: `Falha recorrente em ${failure.channel}`,
        detail: `${failure.prompt} | ${failure.errorKind}: ${failure.errorMessage}`,
        priority: failure.recurrence >= 3 ? "high" : "medium",
        sourceRef: String(failure.id),
        status: "open",
        createdAt: failure.createdAt,
        updatedAt: failure.updatedAt,
      });
    }

    for (const feedback of input.feedback.slice(0, 4)) {
      items.push({
        id: `feedback:${feedback.id}`,
        kind: "feedback",
        title: `Feedback de produto via ${feedback.channel}`,
        detail: feedback.feedback,
        priority: "medium",
        sourceRef: String(feedback.id),
        status: "open",
        createdAt: feedback.createdAt,
        updatedAt: now,
      });
    }

    return items.slice(0, 16);
  }
}
