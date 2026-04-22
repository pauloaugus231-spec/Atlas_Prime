import type { AppConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";
import { AutonomyAssessor } from "../autonomy/autonomy-assessor.js";
import { AutonomyAuditStore } from "../autonomy/autonomy-audit-store.js";
import { AutonomyLoop } from "../autonomy/autonomy-loop.js";
import { AutonomyPolicy } from "../autonomy/autonomy-policy.js";
import { ApprovalCollector } from "../autonomy/collectors/approval-collector.js";
import { CommitmentCollector } from "../autonomy/collectors/commitment-collector.js";
import { GoalRiskCollector } from "../autonomy/collectors/goal-risk-collector.js";
import { MemoryCandidateCollector } from "../autonomy/collectors/memory-candidate-collector.js";
import { OperationalStateCollector } from "../autonomy/collectors/operational-state-collector.js";
import { StaleWorkCollector } from "../autonomy/collectors/stale-work-collector.js";
import { CommitmentExtractor } from "../autonomy/commitment-extractor.js";
import { CommitmentStore } from "../autonomy/commitment-store.js";
import { FeedbackStore } from "../autonomy/feedback-store.js";
import { MemoryCandidateExtractor } from "../autonomy/memory-candidate-extractor.js";
import { MemoryCandidateStore } from "../autonomy/memory-candidate-store.js";
import { ObservationStore } from "../autonomy/observation-store.js";
import { SuggestionStore } from "../autonomy/suggestion-store.js";
import type { StorageLayer, AutonomyLayer } from "./types.js";

export function createAutonomyLayer(config: AppConfig, logger: Logger, storage: StorageLayer): AutonomyLayer {
  const autonomyObservations = new ObservationStore(
    config.paths.autonomyDbPath,
    logger.child({ scope: "autonomy-observations" }),
  );
  const autonomySuggestions = new SuggestionStore(
    config.paths.autonomyDbPath,
    logger.child({ scope: "autonomy-suggestions" }),
  );
  const autonomyAudit = new AutonomyAuditStore(
    config.paths.autonomyDbPath,
    logger.child({ scope: "autonomy-audit" }),
  );
  const autonomyFeedback = new FeedbackStore(
    config.paths.autonomyDbPath,
    logger.child({ scope: "autonomy-feedback" }),
  );
  const commitments = new CommitmentStore(
    config.paths.autonomyDbPath,
    logger.child({ scope: "commitment-store" }),
  );
  const commitmentExtractor = new CommitmentExtractor(
    logger.child({ scope: "commitment-extractor" }),
  );
  const memoryCandidates = new MemoryCandidateStore(
    config.paths.autonomyDbPath,
    logger.child({ scope: "memory-candidate-store" }),
  );
  const memoryCandidateExtractor = new MemoryCandidateExtractor(
    logger.child({ scope: "memory-candidate-extractor" }),
  );
  const autonomyAssessor = new AutonomyAssessor();
  const autonomyPolicy = new AutonomyPolicy();
  const autonomyLoop = new AutonomyLoop({
    collectors: [
      new OperationalStateCollector(storage.personalMemory),
      new ApprovalCollector(storage.approvals),
      new CommitmentCollector(commitments),
      new MemoryCandidateCollector(memoryCandidates),
      new GoalRiskCollector(storage.goalStore),
      new StaleWorkCollector(storage.memory),
    ],
    assessor: autonomyAssessor,
    policy: autonomyPolicy,
    observations: autonomyObservations,
    suggestions: autonomySuggestions,
    audit: autonomyAudit,
    feedback: autonomyFeedback,
    logger: logger.child({ scope: "autonomy-loop" }),
  });

  return {
    autonomyObservations,
    autonomySuggestions,
    autonomyAudit,
    autonomyFeedback,
    commitments,
    memoryCandidates,
    commitmentExtractor,
    memoryCandidateExtractor,
    autonomyAssessor,
    autonomyPolicy,
    autonomyLoop,
  };
}
