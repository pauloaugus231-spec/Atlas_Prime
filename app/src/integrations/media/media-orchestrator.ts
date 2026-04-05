import type { ParsedShortScene } from "../../core/short-video-package.js";
import type { MediaConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";
import { FalMediaService } from "./fal.js";
import { KlingMediaService } from "./kling.js";
import { PexelsMediaService, type PexelsVideoSuggestion } from "./pexels.js";

export type SceneMediaProvider = "pexels" | "fal" | "kling";

export interface SceneMediaResolution {
  provider: SceneMediaProvider;
  searchQuery: string;
  suggestions: PexelsVideoSuggestion[];
}

function buildFallbackChain(
  preferredProvider: SceneMediaProvider,
  config: MediaConfig,
): SceneMediaProvider[] {
  const providers: SceneMediaProvider[] = [preferredProvider];
  if (preferredProvider !== "kling" && config.klingEnabled) {
    providers.push("kling");
  }
  if (preferredProvider !== "fal" && config.falEnabled) {
    providers.push("fal");
  }
  if (preferredProvider !== "pexels") {
    providers.push("pexels");
  }
  return [...new Set(providers)];
}

function buildPremiumPrompt(scene: ParsedShortScene): string {
  const forbidden = [...new Set([
    ...(scene.forbiddenVisuals ?? []),
    "presenter",
    "talking head",
    "selfie",
    "corporate office",
    "whiteboard",
    "generic stock meeting",
    "burned-in subtitles",
    "watermark",
  ])];

  return [
    "Vertical 9:16 short-form social video scene.",
    "Faceless content only.",
    `Narrative function: ${scene.narrativeFunction ?? "mechanism"}.`,
    `Scene purpose: ${scene.scenePurpose ?? scene.voiceover}.`,
    `Voiceover context: ${scene.voiceover}.`,
    `On-screen concept: ${scene.overlay}.`,
    `Environment: ${scene.visualEnvironment ?? "workspace"}.`,
    `Action: ${scene.visualAction ?? scene.visualDirection}.`,
    `Camera: ${scene.visualCamera ?? "over_shoulder"}.`,
    `Pacing: ${scene.visualPacing ?? "fast"}.`,
    `Retention driver: ${scene.retentionDriver ?? "specific_mechanism"}.`,
    `Preferred visual query: ${scene.assetSearchQuery}.`,
    scene.assetFallbackQuery ? `Fallback visual query: ${scene.assetFallbackQuery}.` : "",
    `Avoid: ${forbidden.join(", ")}.`,
    "No presenter speaking to camera. No captions baked into the video.",
  ].filter(Boolean).join(" ");
}

export class MediaOrchestratorService {
  constructor(
    private readonly config: MediaConfig,
    private readonly logger: Logger,
    private readonly pexelsMedia: PexelsMediaService,
    private readonly falMedia: FalMediaService,
    private readonly klingMedia: KlingMediaService,
  ) {}

  describeReadyProviders(): string {
    const providers: string[] = [];
    if (this.pexelsMedia.isEnabled()) {
      providers.push("pexels");
    }
    if (this.falMedia.isEnabled()) {
      providers.push("fal.ai");
    }
    if (this.klingMedia.isEnabled()) {
      providers.push(
        this.klingMedia.supportsDirectGeneration()
          ? "kling"
          : "kling(config)",
      );
    }
    return providers.length > 0 ? providers.join(" + ") : "manual/fallback";
  }

  hasAnyAssetProviderReady(): boolean {
    return this.pexelsMedia.isEnabled() || this.falMedia.isEnabled() || this.klingMedia.supportsDirectGeneration();
  }

  selectPreferredProvider(scene: ParsedShortScene): SceneMediaProvider {
    if (scene.assetProviderHint === "pexels" || scene.assetProviderHint === "fal" || scene.assetProviderHint === "kling") {
      return scene.assetProviderHint;
    }

    const highImpactScene = scene.narrativeFunction === "hook" || scene.narrativeFunction === "payoff";
    if (!highImpactScene || this.config.providerStrategy === "cost") {
      return "pexels";
    }

    if (this.config.premiumSceneProvider === "kling" && this.klingMedia.isEnabled()) {
      return "kling";
    }
    if (this.falMedia.isEnabled()) {
      return "fal";
    }

    return "pexels";
  }

  async resolveSceneSource(scene: ParsedShortScene): Promise<SceneMediaResolution> {
    const preferredProvider = this.selectPreferredProvider(scene);
    const providers = buildFallbackChain(preferredProvider, this.config);

    for (const provider of providers) {
      try {
        if (provider === "pexels" && this.pexelsMedia.isEnabled()) {
          let suggestions = await this.pexelsMedia.searchVideos(
            scene.assetSearchQuery,
            1,
            scene.durationSeconds,
          );
          let searchQuery = scene.assetSearchQuery;
          if (suggestions.length === 0 && scene.assetFallbackQuery && scene.assetFallbackQuery !== scene.assetSearchQuery) {
            suggestions = await this.pexelsMedia.searchVideos(
              scene.assetFallbackQuery,
              1,
              scene.durationSeconds,
            );
            searchQuery = scene.assetFallbackQuery;
          }
          if (suggestions.length > 0) {
            return {
              provider,
              searchQuery,
              suggestions,
            };
          }
        }

        if (provider === "fal" && this.falMedia.isEnabled()) {
          const generated = await this.falMedia.generateVerticalVideo({
            prompt: buildPremiumPrompt(scene),
            durationSeconds: scene.durationSeconds,
          });
          return {
            provider,
            searchQuery: scene.assetSearchQuery,
            suggestions: [generated],
          };
        }

        if (provider === "kling" && this.klingMedia.isEnabled()) {
          const generated = await this.klingMedia.generateVerticalVideo({
            prompt: buildPremiumPrompt(scene),
            durationSeconds: scene.durationSeconds,
          });
          return {
            provider,
            searchQuery: scene.assetSearchQuery,
            suggestions: [generated],
          };
        }
      } catch (error) {
        this.logger.warn("Media provider fallback triggered", {
          provider,
          sceneOrder: scene.order,
          query: scene.assetSearchQuery,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      provider: preferredProvider,
      searchQuery: scene.assetFallbackQuery ?? scene.assetSearchQuery,
      suggestions: [],
    };
  }
}
