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

function normalizeQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ");
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
  constructor(
    private readonly config: MediaConfig,
    private readonly logger: Logger,
  ) {}

  isEnabled(): boolean {
    return this.config.pexelsEnabled && Boolean(this.config.pexelsApiKey);
  }

  async searchVideos(query: string, maxResults = this.config.pexelsMaxResultsPerScene): Promise<PexelsVideoSuggestion[]> {
    const normalizedQuery = normalizeQuery(query);
    if (!normalizedQuery || !this.isEnabled()) {
      return [];
    }

    const url = new URL("https://api.pexels.com/videos/search");
    url.searchParams.set("query", normalizedQuery);
    url.searchParams.set("per_page", String(Math.max(1, Math.min(maxResults, 5))));
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
    }));

    this.logger.info("Resolved Pexels video suggestions", {
      query: normalizedQuery,
      total: results.length,
    });

    return results;
  }
}
