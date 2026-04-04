export const SOCIAL_NOTE_TYPES = [
  "case_note",
  "meeting",
  "visit",
  "follow_up",
  "study",
  "benefit",
  "referral",
  "general",
] as const;

export const SOCIAL_SENSITIVITY_LEVELS = ["restricted", "high", "critical"] as const;

export const SOCIAL_MESSAGE_TONES = ["formal", "acolhedor", "objetivo"] as const;
export const SOCIAL_MESSAGE_INTENTS = ["informar", "encaminhar", "follow_up", "convite", "cobranca"] as const;

export interface CreateSocialCaseNoteInput {
  title: string;
  noteType: (typeof SOCIAL_NOTE_TYPES)[number];
  sensitivity?: (typeof SOCIAL_SENSITIVITY_LEVELS)[number];
  personLabel?: string;
  summary: string;
  details?: string;
  nextAction?: string;
  followUpDate?: string;
  tags?: string[];
}

export interface ListSocialCaseNotesFilters {
  noteType?: (typeof SOCIAL_NOTE_TYPES)[number];
  sensitivity?: (typeof SOCIAL_SENSITIVITY_LEVELS)[number];
  search?: string;
  limit?: number;
}

export interface SocialCaseNoteRecord {
  id: number;
  title: string;
  noteType: (typeof SOCIAL_NOTE_TYPES)[number];
  sensitivity: (typeof SOCIAL_SENSITIVITY_LEVELS)[number];
  personLabel: string | null;
  summary: string;
  details: string | null;
  nextAction: string | null;
  followUpDate: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}
