export const CONTENT_PLATFORMS = [
  "instagram",
  "tiktok",
  "youtube",
  "shorts",
  "reels",
  "linkedin",
  "blog",
  "email",
  "telegram",
  "other",
] as const;

export const CONTENT_FORMATS = [
  "post",
  "carousel",
  "short_video",
  "script",
  "thread",
  "article",
  "email",
  "landing_page",
  "other",
] as const;

export const CONTENT_STATUSES = ["idea", "draft", "scheduled", "published", "archived"] as const;
export const CONTENT_CHANNEL_STATUSES = ["active", "paused", "draft", "archived"] as const;
export const CONTENT_SERIES_STATUSES = ["active", "testing", "paused", "archived"] as const;

export interface UpsertContentChannelInput {
  key: string;
  name: string;
  platform: (typeof CONTENT_PLATFORMS)[number];
  niche?: string;
  persona?: string;
  frequencyPerWeek?: number;
  status?: (typeof CONTENT_CHANNEL_STATUSES)[number];
  primaryGoal?: string;
  styleNotes?: string;
  voiceProfile?: string;
  language?: string;
}

export interface ContentChannelRecord {
  id: number;
  key: string;
  name: string;
  platform: (typeof CONTENT_PLATFORMS)[number];
  niche: string | null;
  persona: string | null;
  frequencyPerWeek: number | null;
  status: (typeof CONTENT_CHANNEL_STATUSES)[number];
  primaryGoal: string | null;
  styleNotes: string | null;
  voiceProfile: string | null;
  language: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertContentFormatTemplateInput {
  key: string;
  label: string;
  description?: string;
  structure: string;
  active?: boolean;
}

export interface ContentFormatTemplateRecord {
  id: number;
  key: string;
  label: string;
  description: string | null;
  structure: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateContentHookTemplateInput {
  label: string;
  template: string;
  category?: string;
  effectivenessScore?: number;
  notes?: string;
}

export interface ContentHookTemplateRecord {
  id: number;
  label: string;
  template: string;
  category: string | null;
  effectivenessScore: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertContentSeriesInput {
  key: string;
  channelKey: string;
  title: string;
  premise?: string;
  cadence?: string;
  status?: (typeof CONTENT_SERIES_STATUSES)[number];
}

export interface ContentSeriesRecord {
  id: number;
  key: string;
  channelKey: string;
  title: string;
  premise: string | null;
  cadence: string | null;
  status: (typeof CONTENT_SERIES_STATUSES)[number];
  createdAt: string;
  updatedAt: string;
}

export interface CreateContentPerformanceInput {
  contentItemId?: number | null;
  channelKey?: string | null;
  platform: (typeof CONTENT_PLATFORMS)[number];
  publishedAt?: string;
  views?: number;
  retention3s?: number;
  avgRetention?: number;
  avgWatchSeconds?: number;
  replayRate?: number;
  comments?: number;
  saves?: number;
  shares?: number;
  score?: number;
  notes?: string;
}

export interface ContentPerformanceRecord {
  id: number;
  contentItemId: number | null;
  channelKey: string | null;
  platform: (typeof CONTENT_PLATFORMS)[number];
  publishedAt: string | null;
  views: number | null;
  retention3s: number | null;
  avgRetention: number | null;
  avgWatchSeconds: number | null;
  replayRate: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  score: number | null;
  notes: string | null;
  createdAt: string;
}

export interface CreateContentItemInput {
  title: string;
  platform: (typeof CONTENT_PLATFORMS)[number];
  format: (typeof CONTENT_FORMATS)[number];
  status?: (typeof CONTENT_STATUSES)[number];
  pillar?: string;
  audience?: string;
  hook?: string;
  callToAction?: string;
  notes?: string;
  targetDate?: string;
  assetPath?: string;
  channelKey?: string;
  seriesKey?: string;
  formatTemplateKey?: string;
  ideaScore?: number;
  scoreReason?: string;
  queuePriority?: number;
}

export interface UpdateContentItemInput {
  id: number;
  title?: string;
  platform?: (typeof CONTENT_PLATFORMS)[number];
  format?: (typeof CONTENT_FORMATS)[number];
  status?: (typeof CONTENT_STATUSES)[number];
  pillar?: string | null;
  audience?: string | null;
  hook?: string | null;
  callToAction?: string | null;
  notes?: string | null;
  targetDate?: string | null;
  assetPath?: string | null;
  channelKey?: string | null;
  seriesKey?: string | null;
  formatTemplateKey?: string | null;
  ideaScore?: number | null;
  scoreReason?: string | null;
  queuePriority?: number | null;
}

export interface ListContentItemsFilters {
  platform?: (typeof CONTENT_PLATFORMS)[number];
  status?: (typeof CONTENT_STATUSES)[number];
  search?: string;
  limit?: number;
}

export interface ContentItemRecord {
  id: number;
  title: string;
  platform: (typeof CONTENT_PLATFORMS)[number];
  format: (typeof CONTENT_FORMATS)[number];
  status: (typeof CONTENT_STATUSES)[number];
  pillar: string | null;
  audience: string | null;
  hook: string | null;
  callToAction: string | null;
  notes: string | null;
  targetDate: string | null;
  assetPath: string | null;
  channelKey: string | null;
  seriesKey: string | null;
  formatTemplateKey: string | null;
  ideaScore: number | null;
  scoreReason: string | null;
  queuePriority: number | null;
  createdAt: string;
  updatedAt: string;
}
