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
  createdAt: string;
  updatedAt: string;
}
