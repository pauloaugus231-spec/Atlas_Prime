import type { MediaConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";

export interface PexelsVideoSuggestion {
  id: number;
  width: number;
  height: number;
  durationSeconds: number;
  pageUrl: string;
  imageUrl?: string;
  creator?: string;
  videoUrl?: string;
}

type PexelsResponse = {
  videos?: Array<{
    id: number;
    width: number;
    height: number;
    duration: number;
    url: string;
    image?: string;
    user?: { name?: string };
    video_files?: Array<{
      quality?: string;
      width?: number;
      height?: number;
      link?: string;
    }>;
  }>;
};

type PexelsVideoFile = NonNullable<NonNullable<PexelsResponse["videos"]>[number]["video_files"]>[number];

type CachedSearchEntry = {
  expiresAt: number;
  results: PexelsVideoSuggestion[];
};

function normalizeQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function rewriteQuery(value: string): string {
  let next = normalizeQuery(value).toLowerCase();
  if (next.includes("dashboard blurred")) {
    next = next.replace(/dashboard blurred/g, "finance analytics dashboard blurred");
  }
  if (next.includes("dashboard metrics")) {
    next = next.replace(/dashboard metrics/g, "analytics dashboard metrics");
  }
  if (next.includes("dashboard") && !/(analytics|software|saas|startup|business|finance|sales)/.test(next)) {
    next = next.replace(/dashboard/g, "analytics dashboard");
  }
  if (next.includes("whiteboard sketch")) {
    next = next.replace(/whiteboard sketch/g, "business whiteboard planning");
  }
  if (next.includes("whiteboard finance")) {
    next = next.replace(/whiteboard finance/g, "financial planning whiteboard");
  }
  if (next.includes("pricing table") && !/(software|saas|app)/.test(next)) {
    next = `software ${next}`;
  }
  if (next.includes("pricing table ui")) {
    next = next.replace(/pricing table ui/g, "saas pricing page vertical");
  }
  if (next.includes("product onboarding") && !/(app|ui|mobile|software)/.test(next)) {
    next = next.replace(/product onboarding/g, "mobile app onboarding ui");
  }
  if (next.includes("product onboarding ui")) {
    next = next.replace(/product onboarding ui/g, "product onboarding ui vertical");
  }
  if (next.includes("comment") && !/(app|mobile|ui|interface)/.test(next)) {
    next = `mobile app ${next}`;
  }
  if (next.includes("hands smartphone app") && !/(investment|bank|finance|saas|crm|analytics)/.test(next)) {
    next = next.replace(/hands smartphone app/g, "mobile banking app ui");
  }
  if (next.includes("laptop dashboard") && !/(finance|saas|sales|analytics)/.test(next)) {
    next = next.replace(/laptop dashboard/g, "analytics laptop dashboard");
  }
  return next;
}

function selectBestVideoFile(files: PexelsVideoFile[] | undefined): string | undefined {
  if (!Array.isArray(files) || files.length === 0) {
    return undefined;
  }

  const sorted = [...files].sort((left, right) => {
    const leftPortraitBoost = (left.height ?? 0) > (left.width ?? 0) ? 500 : 0;
    const rightPortraitBoost = (right.height ?? 0) > (right.width ?? 0) ? 500 : 0;
    const leftScore = leftPortraitBoost + (left.height ?? 0) + (left.width ?? 0);
    const rightScore = rightPortraitBoost + (right.height ?? 0) + (right.width ?? 0);
    return rightScore - leftScore;
  });

  return sorted.find((file) => typeof file.link === "string" && file.link.trim())?.link?.trim();
}

export class PexelsMediaService {
  private readonly cache = new Map<string, CachedSearchEntry>();

  constructor(
    private readonly config: MediaConfig,
    private readonly logger: Logger,
  ) {}

  isEnabled(): boolean {
    return this.config.pexelsEnabled && Boolean(this.config.pexelsApiKey);
  }

  async searchVideos(
    query: string,
    maxResults = this.config.pexelsMaxResultsPerScene,
    targetDurationSeconds?: number,
  ): Promise<PexelsVideoSuggestion[]> {
    const normalizedQuery = rewriteQuery(query);
    if (!normalizedQuery || !this.isEnabled()) {
      return [];
    }

    const cacheKey = `${normalizedQuery}|${maxResults}|${targetDurationSeconds ?? 0}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.results.slice(0, Math.max(1, Math.min(maxResults, 5)));
    }

    const url = new URL("https://api.pexels.com/videos/search");
    url.searchParams.set("query", normalizedQuery);
    const requestedResults = Math.max(1, Math.min(maxResults, 5));
    const searchPoolSize = Math.max(6, Math.min(15, requestedResults * 6));
    url.searchParams.set("per_page", String(searchPoolSize));
    url.searchParams.set("orientation", "portrait");
    url.searchParams.set("size", "medium");

    const response = await fetch(url, {
      headers: {
        Authorization: this.config.pexelsApiKey!,
        "User-Agent": "AtlasPrime/1.0",
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      throw new Error(`Pexels search failed (${response.status})`);
    }

    const payload = await response.json() as PexelsResponse;
    const results = (payload.videos ?? []).map((video) => ({
      id: video.id,
      width: video.width,
      height: video.height,
      durationSeconds: video.duration,
      pageUrl: video.url,
      imageUrl: video.image,
      creator: video.user?.name?.trim() || undefined,
      videoUrl: selectBestVideoFile(video.video_files),
    }))
      .filter((video) => video.durationSeconds >= this.config.pexelsMinDurationSeconds)
      .sort((left, right) => {
        const leftPortraitBoost = left.height > left.width ? 100 : 0;
        const rightPortraitBoost = right.height > right.width ? 100 : 0;
        const leftDurationPenalty = targetDurationSeconds
          ? Math.abs(left.durationSeconds - targetDurationSeconds) * 5
          : 0;
        const rightDurationPenalty = targetDurationSeconds
          ? Math.abs(right.durationSeconds - targetDurationSeconds) * 5
          : 0;
        const leftDurationBoost = targetDurationSeconds && left.durationSeconds >= targetDurationSeconds ? 50 : 0;
        const rightDurationBoost = targetDurationSeconds && right.durationSeconds >= targetDurationSeconds ? 50 : 0;
        const leftScore = leftPortraitBoost + leftDurationBoost - leftDurationPenalty;
        const rightScore = rightPortraitBoost + rightDurationBoost - rightDurationPenalty;
        return rightScore - leftScore;
      })
      .slice(0, requestedResults);

    this.logger.info("Resolved Pexels video suggestions", {
      query: normalizedQuery,
      total: results.length,
      targetDurationSeconds,
    });

    this.cache.set(cacheKey, {
      expiresAt: Date.now() + (this.config.pexelsCacheTtlSeconds * 1000),
      results,
    });

    return results;
  }
}
