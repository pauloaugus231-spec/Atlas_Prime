import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AppConfig } from "../../types/config.js";
import type { ContentItemRecord } from "../../types/content-ops.js";
import type { Logger } from "../../types/logger.js";
import type { ParsedShortPackage, ParsedShortScene } from "../../core/short-video-package.js";
import { OpenAiAudioSpeechService } from "../openai/audio-speech.js";

const execFileAsync = promisify(execFile);

interface RenderSceneArtifact {
  order: number;
  sourcePath?: string;
  clipPath: string;
  sourceUrl?: string;
}

export interface RenderedShortVideoDraft {
  outputPath: string;
  renderDir: string;
  durationSeconds: number;
  title: string;
  manifestPath: string;
}

export interface ShortVideoRenderReadiness {
  canRender: boolean;
  acceptedInput: string;
  renderEngine: string;
  ttsProvider: "openai" | "none";
  ttsReady: boolean;
  assetsProvider: "pexels" | "manual";
  assetsReady: boolean;
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 60) || "video";
}

function formatTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function clampDuration(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.max(1, Math.round(value * 100) / 100);
}

function escapeDrawtext(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/,/g, "\\,")
    .replace(/%/g, "\\%")
    .replace(/\n/g, " ");
}

function buildEnableBetween(start: string, end: string): string {
  return `'between(t\\,${start}\\,${end})'`;
}

function normalizeComparableText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStyleMode(value: ParsedShortPackage["styleMode"]): NonNullable<ParsedShortPackage["styleMode"]> {
  if (value === "motivational" || value === "emotional" || value === "contrarian") {
    return value;
  }
  return "operator";
}

function buildStylePalette(styleMode: NonNullable<ParsedShortPackage["styleMode"]>): {
  overlayColor: string;
  subtitleBoxColor: string;
  subtitleBorderColor: string;
  ttsDirection: string;
} {
  switch (styleMode) {
    case "motivational":
      return {
        overlayColor: "0xFACC15",
        subtitleBoxColor: "0x1F2937@0.62",
        subtitleBorderColor: "0x000000",
        ttsDirection: "Entregue como estrategista de execução: firme, energético e sem soar coach.",
      };
    case "emotional":
      return {
        overlayColor: "0xFDBA74",
        subtitleBoxColor: "0x1C1917@0.66",
        subtitleBorderColor: "0x000000",
        ttsDirection: "Entregue com proximidade e peso emocional controlado, sem dramatização artificial.",
      };
    case "contrarian":
      return {
        overlayColor: "0xFB7185",
        subtitleBoxColor: "0x1F172A@0.66",
        subtitleBorderColor: "0x000000",
        ttsDirection: "Entregue com convicção, corte e contraste, como social media operator que quebra crença ruim.",
      };
    case "operator":
    default:
      return {
        overlayColor: "0x7DD3FC",
        subtitleBoxColor: "0x0F172A@0.62",
        subtitleBorderColor: "0x000000",
        ttsDirection: "Entregue como social media operator experiente, claro, pragmático e sem hype.",
      };
  }
}

function buildAtempoFilter(playbackRate: number): string {
  const filters: string[] = [];
  let remaining = playbackRate;

  while (remaining > 2) {
    filters.push("atempo=2");
    remaining /= 2;
  }

  while (remaining < 0.5) {
    filters.push("atempo=0.5");
    remaining /= 0.5;
  }

  filters.push(`atempo=${remaining.toFixed(5)}`);
  return filters.join(",");
}

function findFontPath(): string | undefined {
  const candidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

async function runCommand(command: string, args: string[], logger: Logger): Promise<void> {
  logger.debug("Running external command", {
    command,
    args,
  });
  try {
    await execFileAsync(command, args, {
      maxBuffer: 1024 * 1024 * 20,
    });
  } catch (error) {
    const details = error && typeof error === "object"
      ? {
          message: "message" in error ? String((error as { message?: unknown }).message) : "unknown",
          stderr: "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "",
          stdout: "stdout" in error ? String((error as { stdout?: unknown }).stdout ?? "") : "",
        }
      : { message: String(error), stderr: "", stdout: "" };
    throw new Error(`${command} failed: ${details.message}${details.stderr ? ` | ${details.stderr.trim()}` : ""}`);
  }
}

async function probeDuration(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ], {
    maxBuffer: 1024 * 1024,
  });

  const parsed = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Unable to probe duration for ${filePath}`);
  }
  return parsed;
}

async function downloadFile(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Asset download failed (${response.status}): ${details || response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, buffer);
}

function buildSceneTimeline(scenes: ParsedShortScene[]): Array<{
  scene: ParsedShortScene;
  start: number;
  end: number;
}> {
  let cursor = 0;
  return scenes.map((scene) => {
    const start = cursor;
    const end = start + scene.durationSeconds;
    cursor = end;
    return { scene, start, end };
  });
}

export class ShortVideoRenderService {
  private readonly speech?: OpenAiAudioSpeechService;
  private readonly fontPath?: string;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {
    if (this.config.llm.provider === "openai" && this.config.llm.apiKey) {
      this.speech = new OpenAiAudioSpeechService(
        this.config.llm.apiKey,
        this.config.llm.baseUrl,
      );
    }
    this.fontPath = findFontPath();
  }

  isReady(): boolean {
    return Boolean(this.speech);
  }

  getReadinessReport(): ShortVideoRenderReadiness {
    const ttsReady = Boolean(this.speech);
    return {
      canRender: ttsReady,
      acceptedInput: "item editorial com SHORT_PACKAGE_V3 salvo",
      renderEngine: "ffmpeg",
      ttsProvider: ttsReady ? "openai" : "none",
      ttsReady,
      assetsProvider: this.config.media.pexelsEnabled && this.config.media.pexelsApiKey ? "pexels" : "manual",
      assetsReady: Boolean(this.config.media.pexelsEnabled && this.config.media.pexelsApiKey),
    };
  }

  async renderDraft(input: {
    item: ContentItemRecord;
    shortPackage: ParsedShortPackage;
  }): Promise<RenderedShortVideoDraft> {
    if (!this.speech) {
      throw new Error("OpenAI TTS não está disponível. Configure OPENAI_API_KEY com provider OpenAI.");
    }

    const renderRoot = path.join(this.config.paths.workspaceDir, "renders");
    await mkdir(renderRoot, { recursive: true });

    const renderDir = await mkdtemp(path.join(renderRoot, `${slugify(input.item.title)}-${input.item.id}-`));
    const sceneWorkDir = path.join(renderDir, "scenes");
    await mkdir(sceneWorkDir, { recursive: true });

    const narrationRawPath = path.join(renderDir, "narration.raw.mp3");
    const narrationAlignedPath = path.join(renderDir, "narration.aligned.mp3");
    const concatManifestPath = path.join(renderDir, "concat.txt");
    const outputPath = path.join(renderDir, `${slugify(input.item.title)}-draft.mp4`);
    const manifestPath = path.join(renderDir, "manifest.json");
    const styleMode = normalizeStyleMode(input.shortPackage.styleMode);
    const stylePalette = buildStylePalette(styleMode);

    const synthesized = await this.speech.synthesize({
      text: input.shortPackage.script,
      voice: "ash",
      format: "mp3",
      instructions: [
        "Fale em português do Brasil.",
        input.shortPackage.voiceStyle ?? "voz segura, direta e pragmática.",
        stylePalette.ttsDirection,
      ].join(" "),
    });
    await writeFile(narrationRawPath, synthesized.audio);

    const narrationRawDuration = await probeDuration(narrationRawPath);
    const targetDurationSeconds = clampDuration(
      input.shortPackage.targetDurationSeconds,
      input.shortPackage.scenes.reduce((total, scene) => total + scene.durationSeconds, 0),
    );
    const atempo = buildAtempoFilter(narrationRawDuration / targetDurationSeconds);
    await runCommand("ffmpeg", [
      "-y",
      "-i",
      narrationRawPath,
      "-vn",
      "-filter:a",
      atempo,
      "-t",
      targetDurationSeconds.toFixed(2),
      "-c:a",
      "mp3",
      narrationAlignedPath,
    ], this.logger.child({ scope: "render-audio" }));

    const sceneArtifacts: RenderSceneArtifact[] = [];
    for (const scene of input.shortPackage.scenes) {
      const sceneSlug = `scene-${scene.order}`;
      const sourceUrl = scene.selectedAsset ?? scene.assetSuggestions[0];
      const sourcePath = sourceUrl
        ? path.join(sceneWorkDir, `${sceneSlug}.source.mp4`)
        : undefined;
      const clipPath = path.join(sceneWorkDir, `${sceneSlug}.clip.mp4`);

      if (sourceUrl && sourcePath) {
        try {
          await downloadFile(sourceUrl, sourcePath);
          await runCommand("ffmpeg", [
            "-y",
            "-stream_loop",
            "-1",
            "-i",
            sourcePath,
            "-t",
            scene.durationSeconds.toFixed(2),
            "-an",
            "-vf",
            "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            clipPath,
          ], this.logger.child({ scope: `render-${sceneSlug}` }));
        } catch (error) {
          this.logger.warn("Scene asset render fell back to placeholder", {
            sceneOrder: scene.order,
            sourceUrl,
            error: error instanceof Error ? error.message : String(error),
          });
          await this.buildPlaceholderClip(clipPath, scene.durationSeconds);
        }
      } else {
        await this.buildPlaceholderClip(clipPath, scene.durationSeconds);
      }

      sceneArtifacts.push({
        order: scene.order,
        sourcePath,
        clipPath,
        sourceUrl,
      });
    }

    await writeFile(
      concatManifestPath,
      `${sceneArtifacts.map((artifact) => `file '${artifact.clipPath.replace(/'/g, "'\\''")}'`).join("\n")}\n`,
      "utf8",
    );

    const filter = this.buildVideoFilter(input.shortPackage.scenes, styleMode);
    await runCommand("ffmpeg", [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatManifestPath,
      "-i",
      narrationAlignedPath,
      ...(filter ? ["-vf", filter] : []),
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-r",
      "30",
      "-shortest",
      "-movflags",
      "+faststart",
      outputPath,
    ], this.logger.child({ scope: "render-final" }));

    const manifest = {
      itemId: input.item.id,
      title: input.item.title,
      renderedAt: new Date().toISOString(),
      targetDurationSeconds,
      tts: {
        model: synthesized.model,
        voice: synthesized.voice,
        rawDurationSeconds: narrationRawDuration,
        alignedPath: narrationAlignedPath,
      },
      scenes: input.shortPackage.scenes.map((scene) => {
        const artifact = sceneArtifacts.find((entry) => entry.order === scene.order);
        return {
          order: scene.order,
          durationSeconds: scene.durationSeconds,
          subtitle: scene.production?.subtitleLine ?? scene.voiceover,
          overlay: scene.overlay,
          sourceUrl: artifact?.sourceUrl,
          clipPath: artifact?.clipPath,
        };
      }),
      outputPath,
    };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    return {
      outputPath,
      renderDir,
      durationSeconds: targetDurationSeconds,
      title: input.item.title,
      manifestPath,
    };
  }

  private async buildPlaceholderClip(outputPath: string, durationSeconds: number): Promise<void> {
    await runCommand("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=0x10151d:s=1080x1920:d=${durationSeconds.toFixed(2)}`,
      "-vf",
      "format=yuv420p,fps=30",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outputPath,
    ], this.logger.child({ scope: "render-placeholder" }));
  }

  private buildVideoFilter(
    scenes: ParsedShortScene[],
    styleMode: NonNullable<ParsedShortPackage["styleMode"]>,
  ): string | undefined {
    if (!this.fontPath) {
      return undefined;
    }

    const stylePalette = buildStylePalette(styleMode);
    const timeline = buildSceneTimeline(scenes);
    const filters: string[] = [];
    for (const entry of timeline) {
      const rawOverlayText = entry.scene.overlay || entry.scene.production?.subtitleLine || "";
      const rawSubtitleText = entry.scene.production?.subtitleLine || entry.scene.voiceover || "";
      const overlayText = escapeDrawtext(rawOverlayText);
      const subtitleText = escapeDrawtext(rawSubtitleText);
      const duplicateText = normalizeComparableText(rawOverlayText) === normalizeComparableText(rawSubtitleText);
      const start = entry.start.toFixed(2);
      const end = Math.max(entry.start + 0.1, entry.end - 0.05).toFixed(2);
      const enableExpr = buildEnableBetween(start, end);

      if (overlayText) {
        filters.push(
          `drawtext=fontfile='${this.fontPath.replace(/'/g, "'\\''")}':text='${overlayText}':fontcolor=${stylePalette.overlayColor}:fontsize=58:borderw=4:bordercolor=black:x=(w-text_w)/2:y=h*0.12:enable=${enableExpr}`,
        );
      }

      if (subtitleText && !duplicateText) {
        filters.push(
          `drawtext=fontfile='${this.fontPath.replace(/'/g, "'\\''")}':text='${subtitleText}':fontcolor=white:fontsize=44:borderw=3:bordercolor=${stylePalette.subtitleBorderColor}:box=1:boxcolor=${stylePalette.subtitleBoxColor}:boxborderw=18:x=(w-text_w)/2:y=h*0.82:enable=${enableExpr}`,
        );
      }
    }

    return filters.length > 0 ? filters.join(",") : undefined;
  }
}
