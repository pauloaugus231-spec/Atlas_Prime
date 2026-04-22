import { GapDetector } from "./gap-detector.js";
import { FailedRequestStore } from "./failed-request-store.js";
import { ProductFeedbackStore } from "./product-feedback-store.js";
import { ImprovementBacklogStore } from "./improvement-backlog.js";
import type { Logger } from "../../types/logger.js";
import type { ProductGapRecord, ProductGapStatus } from "../../types/product-gaps.js";

interface ProductGapStoreLike {
  listProductGaps(input?: { status?: ProductGapStatus; limit?: number }): ProductGapRecord[];
}

export class SelfImprovementService {
  private readonly detector = new GapDetector();

  constructor(
    private readonly personalMemory: ProductGapStoreLike,
    private readonly failedRequests: FailedRequestStore,
    private readonly feedback: ProductFeedbackStore,
    private readonly backlog: ImprovementBacklogStore,
    private readonly logger: Logger,
  ) {}

  recordFailedRequest(input: { channel: string; prompt: string; errorMessage: string; errorKind: string }) {
    return this.failedRequests.record(input);
  }

  recordFeedback(input: { channel: string; feedback: string }) {
    const saved = this.feedback.create(input);
    this.refreshBacklog();
    return saved;
  }

  refreshBacklog() {
    const items = this.detector.buildBacklog({
      productGaps: this.personalMemory.listProductGaps({ status: "open", limit: 8 }),
      failedRequests: this.failedRequests.list(8),
      feedback: this.feedback.list(6),
    });
    for (const item of items) {
      this.backlog.upsert(item);
    }
    return this.backlog.list(20);
  }

  renderBacklog(): string {
    const items = this.refreshBacklog();
    if (items.length === 0) {
      return "Ainda não há backlog de melhoria preenchido.";
    }
    return [
      "Melhorias do Atlas:",
      ...items.slice(0, 10).map((item) => `- [${item.priority}] ${item.title} | ${item.detail}`),
    ].join("\n");
  }

  renderRecentFailures(): string {
    const items = this.failedRequests.list(8);
    if (items.length === 0) {
      return "Nenhuma falha recente foi registrada.";
    }
    return [
      "Falhas recentes:",
      ...items.map((item) => `- ${item.channel} | ${item.errorKind} | recorrência ${item.recurrence}`),
    ].join("\n");
  }
}
