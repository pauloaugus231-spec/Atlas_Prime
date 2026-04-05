import { stat, readFile } from "node:fs/promises";
import type { GoogleWorkspaceAuthService } from "../google/google-auth.js";
import type { Logger } from "../../types/logger.js";

export interface PublishYouTubeShortInput {
  filePath: string;
  title: string;
  description: string;
  privacyStatus?: "private" | "public" | "unlisted";
  tags?: string[];
}

export interface PublishedYouTubeShort {
  videoId: string;
  title: string;
  privacyStatus: "private" | "public" | "unlisted";
  url: string;
}

interface YouTubeVideoInsertResponse {
  id?: string;
  snippet?: {
    title?: string;
  };
  status?: {
    privacyStatus?: "private" | "public" | "unlisted";
  };
  error?: {
    message?: string;
  };
}

const YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";

export class YouTubePublisherService {
  constructor(
    private readonly auth: GoogleWorkspaceAuthService,
    private readonly logger: Logger,
  ) {}

  canUpload(): boolean {
    return this.auth.hasGrantedScopes([YOUTUBE_UPLOAD_SCOPE]);
  }

  async uploadShort(input: PublishYouTubeShortInput): Promise<PublishedYouTubeShort> {
    if (!this.canUpload()) {
      throw new Error(
        "Escopo do YouTube ainda não foi concedido. Rode `npm run google:auth -- --account primary --profile youtube` e tente novamente.",
      );
    }

    const normalizedTitle = input.title.trim();
    const normalizedDescription = input.description.trim();
    if (!normalizedTitle) {
      throw new Error("YouTube upload requires a non-empty title.");
    }

    const fileStats = await stat(input.filePath);
    const fileBuffer = await readFile(input.filePath);
    const accessToken = await this.auth.getAccessToken();
    const metadata = {
      snippet: {
        title: normalizedTitle,
        description: normalizedDescription,
        categoryId: "27",
        ...(input.tags?.length ? { tags: input.tags.slice(0, 10) } : {}),
      },
      status: {
        privacyStatus: input.privacyStatus ?? "public",
        selfDeclaredMadeForKids: false,
      },
    };

    const sessionResponse = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": String(fileStats.size),
          "X-Upload-Content-Type": "video/mp4",
        },
        body: JSON.stringify(metadata),
        signal: AbortSignal.timeout(120000),
      },
    );

    if (!sessionResponse.ok) {
      const details = await sessionResponse.text().catch(() => "");
      throw new Error(`Falha ao iniciar upload do YouTube (${sessionResponse.status}): ${details || sessionResponse.statusText}`);
    }

    const uploadUrl = sessionResponse.headers.get("location");
    if (!uploadUrl) {
      throw new Error("YouTube resumable upload did not return a location header.");
    }

    this.logger.info("Started YouTube resumable upload", {
      filePath: input.filePath,
      size: fileStats.size,
      title: normalizedTitle,
    });

    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Length": String(fileStats.size),
        "Content-Type": "video/mp4",
      },
      body: fileBuffer,
      signal: AbortSignal.timeout(15 * 60 * 1000),
    });

    const payload = (await uploadResponse.json().catch(() => ({}))) as YouTubeVideoInsertResponse;
    if (!uploadResponse.ok) {
      throw new Error(payload.error?.message || `Falha no upload do YouTube (${uploadResponse.status})`);
    }

    const videoId = payload.id?.trim();
    if (!videoId) {
      throw new Error("YouTube upload returned no video id.");
    }

    const privacyStatus = payload.status?.privacyStatus ?? input.privacyStatus ?? "public";
    return {
      videoId,
      title: payload.snippet?.title?.trim() || normalizedTitle,
      privacyStatus,
      url: `https://www.youtube.com/watch?v=${videoId}`,
    };
  }
}
