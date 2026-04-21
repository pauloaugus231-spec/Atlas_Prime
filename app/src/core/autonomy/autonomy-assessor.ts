import { randomUUID } from "node:crypto";
import type { AutonomyAssessment, AutonomyObservation } from "../../types/autonomy.js";

const IMPORTANCE_BY_KIND: Record<AutonomyObservation["kind"], number> = {
  calendar_conflict: 0.88,
  overdue_task: 0.72,
  pending_reply: 0.7,
  stale_lead: 0.66,
  commitment_detected: 0.63,
  approval_waiting: 0.84,
  goal_at_risk: 0.92,
  memory_candidate: 0.4,
};

const URGENCY_BY_KIND: Record<AutonomyObservation["kind"], number> = {
  calendar_conflict: 0.9,
  overdue_task: 0.74,
  pending_reply: 0.68,
  stale_lead: 0.6,
  commitment_detected: 0.58,
  approval_waiting: 0.76,
  goal_at_risk: 0.86,
  memory_candidate: 0.28,
};

const TRUST_WEIGHT: Record<AutonomyObservation["sourceTrust"], number> = {
  operator: 1,
  owned_account: 0.95,
  trusted_contact: 0.78,
  external_contact: 0.62,
  web: 0.55,
  attachment: 0.72,
};

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function resolveRisk(importance: number, urgency: number): AutonomyAssessment["risk"] {
  const peak = Math.max(importance, urgency);
  if (peak >= 0.9) {
    return "critical";
  }
  if (peak >= 0.75) {
    return "high";
  }
  if (peak >= 0.5) {
    return "medium";
  }
  return "low";
}

function buildRationale(input: {
  observation: AutonomyObservation;
  importance: number;
  urgency: number;
  confidence: number;
}): string {
  return [
    `kind=${input.observation.kind}`,
    `trust=${input.observation.sourceTrust}`,
    `importance=${input.importance.toFixed(2)}`,
    `urgency=${input.urgency.toFixed(2)}`,
    `confidence=${input.confidence.toFixed(2)}`,
  ].join(" | ");
}

export class AutonomyAssessor {
  assess(observation: AutonomyObservation): AutonomyAssessment {
    const baseImportance = IMPORTANCE_BY_KIND[observation.kind] ?? 0.5;
    const baseUrgency = URGENCY_BY_KIND[observation.kind] ?? 0.5;
    const trust = TRUST_WEIGHT[observation.sourceTrust] ?? 0.5;
    const evidenceBoost = Math.min(0.12, observation.evidence.length * 0.03);
    const dueBoost = observation.expiresAt ? 0.08 : 0;
    const summaryText = `${observation.title} ${observation.summary}`.toLowerCase();
    const explicitUrgencyBoost = /(hoje|amanha|amanhã|prazo|urgente|agora|atrasad)/i.test(summaryText) ? 0.1 : 0;

    const importance = clamp(baseImportance + evidenceBoost + dueBoost * 0.5);
    const urgency = clamp(baseUrgency + explicitUrgencyBoost + dueBoost);
    const confidence = clamp((trust * 0.75) + evidenceBoost + (observation.sourceTrust === "operator" ? 0.1 : 0));

    return {
      id: randomUUID(),
      observationId: observation.id,
      importance,
      urgency,
      confidence,
      risk: resolveRisk(importance, urgency),
      rationale: buildRationale({
        observation,
        importance,
        urgency,
        confidence,
      }),
    };
  }
}
