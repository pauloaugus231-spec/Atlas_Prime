import type { AutonomyAssessment, AutonomyFeedbackRecord, AutonomySuggestion } from "../../types/autonomy.js";

export interface AutonomyPolicyConfig {
  minConfidence: number;
  minImportance: number;
  minUrgency: number;
  maxSuggestionsPerRun: number;
  dismissedCooldownHours: number;
  snoozedCooldownHours: number;
  repeatedDismissalsBeforeMute: number;
  repeatedDismissalWindowHours: number;
  quietHoursStartHour: number;
  quietHoursEndHour: number;
}

export interface AutonomyQueueDecision {
  allow: boolean;
  reason: string;
}

const DEFAULT_CONFIG: AutonomyPolicyConfig = {
  minConfidence: 0.55,
  minImportance: 0.35,
  minUrgency: 0.35,
  maxSuggestionsPerRun: 5,
  dismissedCooldownHours: 24,
  snoozedCooldownHours: 12,
  repeatedDismissalsBeforeMute: 3,
  repeatedDismissalWindowHours: 24 * 7,
  quietHoursStartHour: 22,
  quietHoursEndHour: 7,
};

function hoursBetween(leftIso: string, rightIso: string): number {
  const left = new Date(leftIso).getTime();
  const right = new Date(rightIso).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(left - right) / (1000 * 60 * 60);
}

export class AutonomyPolicy {
  readonly config: AutonomyPolicyConfig;

  constructor(config?: Partial<AutonomyPolicyConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  shouldQueue(assessment: AutonomyAssessment): AutonomyQueueDecision {
    if (assessment.confidence < this.config.minConfidence) {
      return {
        allow: false,
        reason: `confidence_below_${this.config.minConfidence}`,
      };
    }
    if (assessment.importance < this.config.minImportance && assessment.urgency < this.config.minUrgency) {
      return {
        allow: false,
        reason: "importance_and_urgency_below_threshold",
      };
    }
    return {
      allow: true,
      reason: "meets_thresholds",
    };
  }

  shouldReopenExistingSuggestion(suggestion: AutonomySuggestion, nowIso: string): AutonomyQueueDecision {
    if (suggestion.status === "approved" || suggestion.status === "executed") {
      return {
        allow: false,
        reason: `existing_status_${suggestion.status}`,
      };
    }
    if (suggestion.status === "dismissed") {
      const hours = hoursBetween(nowIso, suggestion.updatedAt);
      if (hours < this.config.dismissedCooldownHours) {
        return {
          allow: false,
          reason: `dismissed_cooldown_${this.config.dismissedCooldownHours}h`,
        };
      }
    }
    if (suggestion.status === "snoozed") {
      const snoozedUntil = suggestion.snoozedUntil;
      if (snoozedUntil && new Date(snoozedUntil).getTime() > new Date(nowIso).getTime()) {
        return {
          allow: false,
          reason: "still_snoozed",
        };
      }
      const hours = hoursBetween(nowIso, suggestion.updatedAt);
      if (hours < this.config.snoozedCooldownHours) {
        return {
          allow: false,
          reason: `snoozed_cooldown_${this.config.snoozedCooldownHours}h`,
        };
      }
    }
    return {
      allow: true,
      reason: "eligible_for_upsert",
    };
  }

  clampSuggestionCount<T>(items: T[]): T[] {
    return items.slice(0, this.config.maxSuggestionsPerRun);
  }

  shouldRequeueFromFeedback(feedback: AutonomyFeedbackRecord[], nowIso: string): AutonomyQueueDecision {
    const dismissals = feedback.filter((item) =>
      item.feedbackKind === "dismissed"
      && hoursBetween(nowIso, item.createdAt) <= this.config.repeatedDismissalWindowHours);
    if (dismissals.length >= this.config.repeatedDismissalsBeforeMute) {
      return {
        allow: false,
        reason: `repeated_dismissals_${dismissals.length}`,
      };
    }
    return {
      allow: true,
      reason: "feedback_allows_requeue",
    };
  }

  adjustPriorityForFeedback(priority: number, feedback: AutonomyFeedbackRecord[]): number {
    const snoozes = feedback.filter((item) => item.feedbackKind === "snoozed").length;
    const dismissals = feedback.filter((item) => item.feedbackKind === "dismissed").length;
    const accepts = feedback.filter((item) => item.feedbackKind === "accepted" || item.feedbackKind === "executed").length;
    const adjusted = priority - (snoozes * 0.05) - (dismissals * 0.08) + (accepts * 0.03);
    return Math.max(0, Math.min(1, adjusted));
  }

  isQuietHours(nowIso: string): boolean {
    const date = new Date(nowIso);
    if (!Number.isFinite(date.getTime())) {
      return false;
    }
    const hour = date.getHours();
    if (this.config.quietHoursStartHour > this.config.quietHoursEndHour) {
      return hour >= this.config.quietHoursStartHour || hour < this.config.quietHoursEndHour;
    }
    return hour >= this.config.quietHoursStartHour && hour < this.config.quietHoursEndHour;
  }
}
