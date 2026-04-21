import type {
  AutonomyAssessment,
  AutonomyCollector,
  AutonomyObservation,
  AutonomyRunInput,
  AutonomyRunResult,
  AutonomySuggestion,
} from "../../types/autonomy.js";
import type { Logger } from "../../types/logger.js";
import { AutonomyAssessor } from "./autonomy-assessor.js";
import { AutonomyAuditStore } from "./autonomy-audit-store.js";
import { FeedbackStore } from "./feedback-store.js";
import { ObservationStore } from "./observation-store.js";
import { AutonomyPolicy } from "./autonomy-policy.js";
import { SuggestionStore } from "./suggestion-store.js";

export interface AutonomyLoopDependencies {
  collectors: AutonomyCollector[];
  assessor: AutonomyAssessor;
  policy: AutonomyPolicy;
  observations: ObservationStore;
  suggestions: SuggestionStore;
  audit: AutonomyAuditStore;
  feedback?: FeedbackStore;
  logger: Logger;
}

function buildSuggestion(input: {
  observation: AutonomyObservation;
  assessment: AutonomyAssessment;
}): Omit<AutonomySuggestion, "id" | "createdAt" | "updatedAt"> {
  const priority = Math.max(
    0,
    Math.min(1, (input.assessment.importance * 0.45) + (input.assessment.urgency * 0.35) + (input.assessment.confidence * 0.2)),
  );

  return {
    observationId: input.observation.id,
    fingerprint: input.observation.fingerprint,
    title: input.observation.title,
    body: input.observation.summary,
    explanation: input.assessment.rationale,
    status: "queued",
    priority,
    requiresApproval: input.assessment.risk === "high" || input.assessment.risk === "critical",
    ...(input.observation.expiresAt ? { dueAt: input.observation.expiresAt } : {}),
  };
}

export class AutonomyLoop {
  private readonly collectors: AutonomyCollector[];
  private readonly assessor: AutonomyAssessor;
  private readonly policy: AutonomyPolicy;
  private readonly observations: ObservationStore;
  private readonly suggestions: SuggestionStore;
  private readonly audit: AutonomyAuditStore;
  private readonly feedback?: FeedbackStore;
  private readonly logger: Logger;

  constructor(deps: AutonomyLoopDependencies) {
    this.collectors = deps.collectors;
    this.assessor = deps.assessor;
    this.policy = deps.policy;
    this.observations = deps.observations;
    this.suggestions = deps.suggestions;
    this.audit = deps.audit;
    this.feedback = deps.feedback;
    this.logger = deps.logger;
  }

  async runOnce(input: AutonomyRunInput = {}): Promise<AutonomyRunResult> {
    const now = input.now ?? new Date().toISOString();
    const observations: AutonomyObservation[] = [];
    const assessments: AutonomyAssessment[] = [];
    const queued: AutonomySuggestion[] = [];

    for (const collector of this.collectors) {
      try {
        const collected = await collector.collect({
          now,
          context: input.context,
        });
        for (const observation of collected) {
          const storedObservation = this.observations.upsert(observation);
          observations.push(storedObservation);
          this.audit.record({
            kind: "observation_recorded",
            observationId: storedObservation.id,
            payload: {
              collector: collector.name,
              fingerprint: storedObservation.fingerprint,
              kind: storedObservation.kind,
            },
          });

          const assessment = this.assessor.assess(storedObservation);
          assessments.push(assessment);
          const queueDecision = this.policy.shouldQueue(assessment);
          if (!queueDecision.allow) {
            this.logger.debug("Autonomy suggestion skipped by queue policy", {
              collector: collector.name,
              fingerprint: storedObservation.fingerprint,
              reason: queueDecision.reason,
            });
            continue;
          }

          const existingSuggestion = this.suggestions.getByFingerprint(storedObservation.fingerprint);
          if (existingSuggestion) {
            const reopenDecision = this.policy.shouldReopenExistingSuggestion(existingSuggestion, now);
            if (!reopenDecision.allow) {
              this.logger.debug("Autonomy suggestion skipped by existing-state policy", {
                suggestionId: existingSuggestion.id,
                fingerprint: existingSuggestion.fingerprint,
                reason: reopenDecision.reason,
              });
              continue;
            }
          }

          const storedSuggestion = this.suggestions.upsert(buildSuggestion({
            observation: storedObservation,
            assessment,
          }));
          queued.push(storedSuggestion);
          this.audit.record({
            kind: "suggestion_upserted",
            observationId: storedObservation.id,
            suggestionId: storedSuggestion.id,
            payload: {
              priority: storedSuggestion.priority,
              requiresApproval: storedSuggestion.requiresApproval,
              collector: collector.name,
            },
          });
        }
      } catch (error) {
        this.logger.warn("Autonomy collector failed; continuing remaining collectors", {
          collector: collector.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const suggestions = this.policy.clampSuggestionCount(
      queued.sort((left, right) => right.priority - left.priority || right.updatedAt.localeCompare(left.updatedAt)),
    );

    this.audit.record({
      kind: "autonomy_loop_run",
      payload: {
        collectorCount: this.collectors.length,
        observationCount: observations.length,
        suggestionCount: suggestions.length,
        feedbackStoreEnabled: Boolean(this.feedback),
      },
    });

    this.logger.info("Autonomy loop run completed", {
      observationCount: observations.length,
      suggestionCount: suggestions.length,
    });

    return {
      observations,
      assessments,
      suggestions,
    };
  }
}
