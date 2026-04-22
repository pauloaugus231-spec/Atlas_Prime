import type { Mission } from "../../types/mission.js";
import type { Logger } from "../../types/logger.js";
import { MissionStore } from "./mission-store.js";

export class MissionReviewService {
  constructor(
    private readonly store: MissionStore,
    private readonly logger: Logger,
  ) {}

  review(): { stale: Mission[]; blocked: Mission[] } {
    const active = this.store.list(["active", "blocked", "paused"], 100);
    const staleThreshold = Date.now() - (5 * 24 * 60 * 60 * 1000);
    const stale = active.filter((item) => Date.parse(item.updatedAt) < staleThreshold && item.status === "active");
    const blocked = active.filter((item) => item.status === "blocked");
    this.logger.debug("Mission review computed", { stale: stale.length, blocked: blocked.length });
    return { stale, blocked };
  }

  renderReview(): string {
    const review = this.review();
    return [
      "Revisão de missões:",
      `- Paradas: ${review.stale.length}`,
      `- Bloqueadas: ${review.blocked.length}`,
      ...review.stale.slice(0, 3).map((item) => `- Parada: ${item.title}`),
      ...review.blocked.slice(0, 3).map((item) => `- Bloqueada: ${item.title}`),
    ].join("\n");
  }
}
