import { randomUUID } from "node:crypto";
import type { AutonomyCollector, AutonomyCollectorInput, AutonomyObservation } from "../../../types/autonomy.js";
import type { OperationalMemoryItem } from "../../../types/operational-memory.js";

interface OperationalMemoryReader {
  listItems(filters?: { includeDone?: boolean; limit?: number }): OperationalMemoryItem[];
}

function olderThanDays(dateIso: string, nowIso: string, days: number): boolean {
  const current = new Date(nowIso).getTime();
  const target = new Date(dateIso).getTime();
  if (!Number.isFinite(current) || !Number.isFinite(target)) {
    return false;
  }
  return current - target > days * 86_400_000;
}

export class StaleWorkCollector implements AutonomyCollector {
  readonly name = "stale-work";

  constructor(private readonly memory: OperationalMemoryReader) {}

  collect(input: AutonomyCollectorInput): AutonomyObservation[] {
    const items = this.memory.listItems({ includeDone: false, limit: 25 });
    return items.flatMap((item) => {
      if ((item.stage !== "build" && item.stage !== "launch") || !olderThanDays(item.updatedAt || item.createdAt, input.now, 5)) {
        return [];
      }
      const kind: AutonomyObservation["kind"] = item.category === "opportunity" ? "stale_lead" : "overdue_task";
      return [{
        id: randomUUID(),
        fingerprint: `${kind}:memory:${item.id}`,
        kind,
        sourceKind: "memory",
        sourceId: String(item.id),
        sourceTrust: "owned_account",
        title: `${item.title} parado em ${item.stage}`,
        summary: `Item sem avanço recente no estágio ${item.stage}.`,
        evidence: [
          `memory_item:${item.id}`,
          `category:${item.category}`,
          `stage:${item.stage}`,
          `updatedAt:${item.updatedAt}`,
        ],
        observedAt: input.now,
      } satisfies AutonomyObservation];
    });
  }
}
