import { randomUUID } from "node:crypto";
import type { AutonomyCollector, AutonomyObservation } from "../../../types/autonomy.js";
import type { CommitmentCandidate } from "../../../types/commitments.js";
import { CommitmentStore } from "../commitment-store.js";

function formatDueAt(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function buildSummary(commitment: CommitmentCandidate): string {
  const dueLabel = formatDueAt(commitment.dueAt);
  if (dueLabel) {
    return `${commitment.normalizedAction}. Prazo sugerido: ${dueLabel}.`;
  }
  return `${commitment.normalizedAction}. Vale revisar e decidir o próximo passo.`;
}

export class CommitmentCollector implements AutonomyCollector {
  readonly name = "commitment_collector";

  constructor(private readonly commitments: Pick<CommitmentStore, "listByStatus">) {}

  collect(input: { now: string }): AutonomyObservation[] {
    return this.commitments
      .listByStatus(["candidate", "snoozed"], 12)
      .filter((commitment) => !commitment.snoozedUntil || commitment.snoozedUntil <= input.now)
      .map((commitment) => ({
        id: randomUUID(),
        fingerprint: `commitment:${commitment.id}`,
        kind: "commitment_detected",
        sourceKind: commitment.sourceKind,
        sourceId: commitment.id,
        sourceTrust: commitment.sourceTrust,
        title: `Compromisso detectado: ${commitment.normalizedAction}`,
        summary: buildSummary(commitment),
        evidence: [
          `Frase original: ${commitment.statement}`,
          ...commitment.evidence,
        ].slice(0, 4),
        observedAt: commitment.updatedAt,
        ...(commitment.dueAt ? { expiresAt: commitment.dueAt } : {}),
      }));
  }
}
