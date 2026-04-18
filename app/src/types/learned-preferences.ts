export const LEARNED_PREFERENCE_TYPES = [
  "schedule_import_mode",
  "agenda_scope",
  "response_style",
  "channel_preference",
  "calendar_interpretation",
  "visual_task",
  "alert_action",
  "other",
] as const;

export const LEARNED_PREFERENCE_SOURCES = [
  "explicit",
  "observed",
  "correction",
  "confirmation",
  "rejection",
  "system",
] as const;

export type LearnedPreferenceType = (typeof LEARNED_PREFERENCE_TYPES)[number];
export type LearnedPreferenceSource = (typeof LEARNED_PREFERENCE_SOURCES)[number];

export interface LearnedPreference {
  id: number;
  type: LearnedPreferenceType;
  key: string;
  description: string;
  value: string;
  source: LearnedPreferenceSource;
  confidence: number;
  confirmations: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  lastObservedAt: string;
}

export interface CreateLearnedPreferenceInput {
  type: LearnedPreferenceType;
  key: string;
  description: string;
  value: string;
  source: LearnedPreferenceSource;
  confidence?: number;
}

export interface UpdateLearnedPreferenceInput {
  id: number;
  description?: string;
  value?: string;
  confidence?: number;
  confirmations?: number;
  active?: boolean;
}
