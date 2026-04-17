import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { OpenAiAudioTranscriptionService } from "../openai/audio-transcription.js";
import type { SpeechToTextInput, SpeechToTextProvider, SpeechToTextResult } from "./voice-types.js";
import { VoiceMessageError } from "./voice-types.js";

const execFileAsync = promisify(execFile);

export class OpenAiSpeechToTextProvider implements SpeechToTextProvider {
  readonly name = "openai";

  constructor(private readonly service: OpenAiAudioTranscriptionService) {}

  async transcribe(input: SpeechToTextInput): Promise<SpeechToTextResult> {
    const result = await this.service.transcribe(input);
    return {
      text: result.text,
      model: result.model,
      provider: this.name,
    };
  }
}

export interface CommandSpeechToTextProviderOptions {
  command: string;
  args: string[];
  tempDir: string;
  timeoutMs: number;
}

export class CommandSpeechToTextProvider implements SpeechToTextProvider {
  readonly name = "command";

  constructor(private readonly options: CommandSpeechToTextProviderOptions) {}

  async transcribe(input: SpeechToTextInput): Promise<SpeechToTextResult> {
    await mkdir(this.options.tempDir, { recursive: true });
    const extension = input.filename.includes(".") ? input.filename.split(".").pop() : "audio";
    const filePath = path.join(this.options.tempDir, `${randomUUID()}.${extension || "audio"}`);

    try {
      await writeFile(filePath, input.audio);
      const args = this.buildArgs(filePath, input);
      const { stdout } = await execFileAsync(this.options.command, args, {
        timeout: this.options.timeoutMs,
        maxBuffer: 1024 * 1024,
      });
      const text = parseCommandTranscription(String(stdout));
      if (!text) {
        throw new Error("STT command returned empty text");
      }
      return {
        text,
        provider: this.name,
      };
    } finally {
      await unlink(filePath).catch(() => undefined);
    }
  }

  private buildArgs(filePath: string, input: SpeechToTextInput): string[] {
    const templateArgs = this.options.args.length > 0 ? this.options.args : ["{input}"];
    const resolved = templateArgs.map((arg) =>
      arg
        .replaceAll("{input}", filePath)
        .replaceAll("{filename}", input.filename)
        .replaceAll("{mimeType}", input.mimeType ?? "")
        .replaceAll("{language}", input.language ?? ""),
    );

    return resolved.some((arg) => arg === filePath) ? resolved : [...resolved, filePath];
  }
}

export class UnavailableSpeechToTextProvider implements SpeechToTextProvider {
  readonly name = "unavailable";

  constructor(private readonly reason: string) {}

  async transcribe(): Promise<SpeechToTextResult> {
    throw new VoiceMessageError("provider_unavailable", this.reason);
  }
}

function parseCommandTranscription(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { text?: unknown };
      return typeof parsed.text === "string" ? parsed.text.trim() : "";
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}
