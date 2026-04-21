import { randomUUID } from "node:crypto";
import type { AutonomyCollector, AutonomyCollectorInput, AutonomyObservation } from "../../../types/autonomy.js";
import type { ActiveGoal } from "../../goal-store.js";

interface GoalReader {
  list(): ActiveGoal[];
}

function daysUntil(deadline: string, nowIso: string): number | undefined {
  const now = new Date(nowIso);
  const target = new Date(deadline);
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(target.getTime())) {
    return undefined;
  }
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  return Math.ceil((startOfTarget - startOfToday) / 86_400_000);
}

export class GoalRiskCollector implements AutonomyCollector {
  readonly name = "goal-risk";

  constructor(private readonly goals: GoalReader) {}

  collect(input: AutonomyCollectorInput): AutonomyObservation[] {
    return this.goals.list().flatMap((goal) => {
      if (!goal.deadline || (goal.progress ?? 0) >= 0.5) {
        return [];
      }
      const remainingDays = daysUntil(goal.deadline, input.now);
      if (remainingDays == null || remainingDays < 0 || remainingDays > 7) {
        return [];
      }
      return [{
        id: randomUUID(),
        fingerprint: `goal_at_risk:${goal.id}`,
        kind: "goal_at_risk",
        sourceKind: "system",
        sourceId: goal.id,
        sourceTrust: "owned_account",
        title: `Meta em risco: ${goal.title}`,
        summary: `Prazo em ${remainingDays} dia(s) com progresso em ${Math.round((goal.progress ?? 0) * 100)}%.`,
        evidence: [
          `goal:${goal.title}`,
          `domain:${goal.domain}`,
          `deadline:${goal.deadline}`,
          `progress:${goal.progress ?? 0}`,
        ],
        observedAt: input.now,
        expiresAt: goal.deadline,
      } satisfies AutonomyObservation];
    });
  }
}
