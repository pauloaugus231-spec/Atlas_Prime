import { createHmac } from "node:crypto";
import type { MediaConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";
import type { PexelsVideoSuggestion } from "./pexels.js";

type KlingCreateTaskResponse = {
  code?: number;
  message?: string;
  msg?: string;
  data?: {
    task_id?: string;
    task_status?: string;
  };
};

type KlingStatusResponse = {
  code?: number;
  message?: string;
  msg?: string;
  data?: {
    task_id?: string;
    task_status?: string;
    status?: string;
    task_result?: unknown;
    result?: unknown;
  };
};

function base64UrlEncode(input: Buffer | string): string {
  const buffer = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampDurationSeconds(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "5";
  }
  if (value <= 5) {
    return "5";
  }
  if (value <= 10) {
    return "10";
  }
  return "10";
}

function createJwt(accessKey: string, secretKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: accessKey,
    nbf: now - 5,
    exp: now + 1800,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", secretKey)
    .update(signingInput)
    .digest();

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

function extractVideoUrl(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const typed = payload as {
    videos?: Array<{ url?: string; video_url?: string } | string>;
    video?: { url?: string; video_url?: string } | string;
    url?: string;
    video_url?: string;
  };

  if (typeof typed.url === "string" && typed.url.trim()) {
    return typed.url.trim();
  }
  if (typeof typed.video_url === "string" && typed.video_url.trim()) {
    return typed.video_url.trim();
  }
  if (typeof typed.video === "string" && typed.video.trim()) {
    return typed.video.trim();
  }
  if (typed.video && typeof typed.video === "object") {
    if (typeof typed.video.url === "string" && typed.video.url.trim()) {
      return typed.video.url.trim();
    }
    if (typeof typed.video.video_url === "string" && typed.video.video_url.trim()) {
      return typed.video.video_url.trim();
    }
  }
  if (Array.isArray(typed.videos) && typed.videos.length > 0) {
    const first = typed.videos[0];
    if (typeof first === "string" && first.trim()) {
      return first.trim();
    }
    if (first && typeof first === "object") {
      if (typeof first.url === "string" && first.url.trim()) {
        return first.url.trim();
      }
      if (typeof first.video_url === "string" && first.video_url.trim()) {
        return first.video_url.trim();
      }
    }
  }

  return undefined;
}

function normalizeStatus(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export class KlingMediaService {
  constructor(
    private readonly config: MediaConfig,
    private readonly logger: Logger,
  ) {}

  isEnabled(): boolean {
    return this.config.klingEnabled
      && Boolean(this.config.klingAccessKey)
      && Boolean(this.config.klingSecretKey);
  }

  supportsDirectGeneration(): boolean {
    return this.isEnabled() && this.config.klingDirectGenerationEnabled;
  }

  private buildAuthHeader(): string {
    return `Bearer ${createJwt(this.config.klingAccessKey!, this.config.klingSecretKey!)}`;
  }

  async generateVerticalVideo(input: {
    prompt: string;
    durationSeconds: number;
  }): Promise<PexelsVideoSuggestion> {
    if (!this.isEnabled()) {
      throw new Error("Kling não está configurado.");
    }
    if (!this.supportsDirectGeneration()) {
      throw new Error("Kling está configurado, mas a chamada direta está desativada.");
    }

    const createUrl = `${this.config.klingApiBaseUrl.replace(/\/+$/, "")}/v1/videos/text2video`;
    const submitResponse = await fetch(createUrl, {
      method: "POST",
      headers: {
        Authorization: this.buildAuthHeader(),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model_name: this.config.klingTextToVideoModel,
        prompt: input.prompt,
        aspect_ratio: "9:16",
        duration: clampDurationSeconds(input.durationSeconds),
      }),
      signal: AbortSignal.timeout(this.config.klingRequestTimeoutSeconds * 1000),
    });

    if (!submitResponse.ok) {
      const details = await submitResponse.text().catch(() => "");
      throw new Error(`Kling submit falhou (${submitResponse.status}): ${details || submitResponse.statusText}`);
    }

    const submitPayload = await submitResponse.json() as KlingCreateTaskResponse;
    const taskId = submitPayload.data?.task_id?.trim();
    if (!taskId) {
      throw new Error(`Kling não retornou task_id. ${submitPayload.message ?? submitPayload.msg ?? ""}`.trim());
    }

    const deadline = Date.now() + (this.config.klingMaxPollSeconds * 1000);
    const statusUrl = `${this.config.klingApiBaseUrl.replace(/\/+$/, "")}/v1/videos/text2video/${taskId}`;

    while (Date.now() < deadline) {
      await sleep(5000);
      const statusResponse = await fetch(statusUrl, {
        headers: {
          Authorization: this.buildAuthHeader(),
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(this.config.klingRequestTimeoutSeconds * 1000),
      });

      if (!statusResponse.ok) {
        const details = await statusResponse.text().catch(() => "");
        throw new Error(`Kling status falhou (${statusResponse.status}): ${details || statusResponse.statusText}`);
      }

      const statusPayload = await statusResponse.json() as KlingStatusResponse;
      const status = normalizeStatus(statusPayload.data?.task_status ?? statusPayload.data?.status);
      if (status === "succeed" || status === "success" || status === "completed") {
        const videoUrl = extractVideoUrl(statusPayload.data?.task_result ?? statusPayload.data?.result);
        if (!videoUrl) {
          throw new Error("Kling concluiu a task, mas não retornou URL de vídeo.");
        }
        return {
          provider: "kling",
          id: 0,
          width: 1080,
          height: 1920,
          durationSeconds: Number.parseInt(clampDurationSeconds(input.durationSeconds), 10),
          pageUrl: videoUrl,
          videoUrl,
          creator: `kling/${this.config.klingTextToVideoModel}`,
        };
      }

      if (status === "failed" || status === "error") {
        throw new Error(`Kling terminou com status ${status}.`);
      }
    }

    this.logger.warn("Kling generation timed out", {
      model: this.config.klingTextToVideoModel,
      timeoutSeconds: this.config.klingMaxPollSeconds,
    });
    throw new Error("Kling excedeu o tempo máximo de espera.");
  }
}
