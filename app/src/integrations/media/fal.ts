import type { MediaConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";
import type { PexelsVideoSuggestion } from "./pexels.js";

type FalSubmitResponse = {
  request_id?: string;
  status?: string;
  status_url?: string;
  response_url?: string;
};

type FalStatusResponse = {
  request_id?: string;
  status?: string;
  response_url?: string;
  error?: unknown;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampDurationSeconds(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 5;
  }
  return Math.max(2, Math.min(15, Math.round(value)));
}

function extractFalVideoUrl(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const typed = payload as {
    video?: { url?: string } | string;
    videos?: Array<{ url?: string } | string>;
    data?: unknown;
  };

  if (typeof typed.video === "string" && typed.video.trim()) {
    return typed.video.trim();
  }
  if (typed.video && typeof typed.video === "object" && typeof typed.video.url === "string" && typed.video.url.trim()) {
    return typed.video.url.trim();
  }
  if (Array.isArray(typed.videos) && typed.videos.length > 0) {
    const first = typed.videos[0];
    if (typeof first === "string" && first.trim()) {
      return first.trim();
    }
    if (first && typeof first === "object" && typeof first.url === "string" && first.url.trim()) {
      return first.url.trim();
    }
  }
  if ("data" in typed) {
    return extractFalVideoUrl(typed.data);
  }

  return undefined;
}

export class FalMediaService {
  constructor(
    private readonly config: MediaConfig,
    private readonly logger: Logger,
  ) {}

  isEnabled(): boolean {
    return this.config.falEnabled && Boolean(this.config.falApiKey);
  }

  getModelId(): string {
    return this.config.falTextToVideoModel;
  }

  async generateVerticalVideo(input: {
    prompt: string;
    durationSeconds: number;
  }): Promise<PexelsVideoSuggestion> {
    if (!this.isEnabled()) {
      throw new Error("fal.ai não está habilitado.");
    }

    const modelId = this.getModelId();
    const submitUrl = `https://queue.fal.run/${modelId}`;
    const submitResponse = await fetch(submitUrl, {
      method: "POST",
      headers: {
        Authorization: `Key ${this.config.falApiKey!}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        prompt: input.prompt,
        aspect_ratio: "9:16",
        duration: clampDurationSeconds(input.durationSeconds),
        resolution: this.config.falDefaultResolution,
      }),
      signal: AbortSignal.timeout(this.config.falRequestTimeoutSeconds * 1000),
    });

    if (!submitResponse.ok) {
      const details = await submitResponse.text().catch(() => "");
      throw new Error(`fal.ai submit falhou (${submitResponse.status}): ${details || submitResponse.statusText}`);
    }

    const submitPayload = await submitResponse.json() as FalSubmitResponse;
    const requestId = submitPayload.request_id?.trim();
    if (!requestId) {
      throw new Error("fal.ai não retornou request_id.");
    }

    const statusUrl = submitPayload.status_url?.trim()
      || `https://queue.fal.run/${modelId}/requests/${requestId}/status`;
    const responseUrl = submitPayload.response_url?.trim()
      || `https://queue.fal.run/${modelId}/requests/${requestId}`;
    const deadline = Date.now() + (this.config.falMaxPollSeconds * 1000);

    while (Date.now() < deadline) {
      await sleep(4000);
      const statusResponse = await fetch(statusUrl, {
        headers: {
          Authorization: `Key ${this.config.falApiKey!}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(this.config.falRequestTimeoutSeconds * 1000),
      });

      if (!statusResponse.ok) {
        const details = await statusResponse.text().catch(() => "");
        throw new Error(`fal.ai status falhou (${statusResponse.status}): ${details || statusResponse.statusText}`);
      }

      const statusPayload = await statusResponse.json() as FalStatusResponse;
      const status = statusPayload.status?.trim().toUpperCase();
      if (status === "COMPLETED") {
        const resultResponse = await fetch(responseUrl, {
          headers: {
            Authorization: `Key ${this.config.falApiKey!}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(this.config.falRequestTimeoutSeconds * 1000),
        });

        if (!resultResponse.ok) {
          const details = await resultResponse.text().catch(() => "");
          throw new Error(`fal.ai result falhou (${resultResponse.status}): ${details || resultResponse.statusText}`);
        }

        const resultPayload = await resultResponse.json();
        const videoUrl = extractFalVideoUrl(resultPayload);
        if (!videoUrl) {
          throw new Error("fal.ai completou, mas não retornou URL de vídeo.");
        }

        return {
          provider: "fal",
          id: 0,
          width: 1080,
          height: 1920,
          durationSeconds: clampDurationSeconds(input.durationSeconds),
          pageUrl: videoUrl,
          videoUrl,
          creator: `fal.ai/${modelId}`,
        };
      }

      if (status === "FAILED" || status === "CANCELLED") {
        throw new Error(`fal.ai terminou com status ${status.toLowerCase()}.`);
      }
    }

    this.logger.warn("fal.ai generation timed out", {
      modelId,
      timeoutSeconds: this.config.falMaxPollSeconds,
    });
    throw new Error("fal.ai excedeu o tempo máximo de espera.");
  }
}
