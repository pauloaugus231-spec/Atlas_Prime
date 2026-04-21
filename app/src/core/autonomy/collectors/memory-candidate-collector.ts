import { randomUUID } from "node:crypto";
import type { AutonomyCollector, AutonomyObservation } from "../../../types/autonomy.js";
import type { MemoryCandidate } from "../../../types/memory-candidates.js";
import { MemoryCandidateStore } from "../memory-candidate-store.js";

function summarizeCandidate(candidate: MemoryCandidate): string {
  return `Possível memória útil detectada: ${candidate.statement}.`;
}

export class MemoryCandidateCollector implements AutonomyCollector {
  readonly name = "memory_candidate_collector";

  constructor(private readonly candidates: Pick<MemoryCandidateStore, "listByStatus">) {}

  collect(input: { now: string }): AutonomyObservation[] {
    return this.candidates
      .listByStatus(["candidate"], 12)
      .filter((candidate) => candidate.reviewStatus === "needs_review")
      .filter((candidate) => !candidate.snoozedUntil || candidate.snoozedUntil <= input.now)
      .map((candidate) => ({
        id: randomUUID(),
        fingerprint: `memory-candidate:${candidate.id}`,
        kind: "memory_candidate",
        sourceKind: candidate.sourceKind === "operator" ? "system" : candidate.sourceKind,
        sourceId: candidate.id,
        sourceTrust: candidate.sourceKind === "operator" ? "operator" : "owned_account",
        title: `Memória candidata: ${candidate.statement}`,
        summary: summarizeCandidate(candidate),
        evidence: candidate.evidence,
        observedAt: candidate.lastSeenAt,
        ...(candidate.expiresAt ? { expiresAt: candidate.expiresAt } : {}),
      } satisfies AutonomyObservation));
  }
}
