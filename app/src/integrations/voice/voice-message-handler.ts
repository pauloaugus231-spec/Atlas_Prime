import type { AppConfig, VoiceConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";
import { OpenAiAudioTranscriptionService } from "../openai/audio-transcription.js";
import {
  CommandSpeechToTextProvider,
  OpenAiSpeechToTextProvider,
  UnavailableSpeechToTextProvider,
} from "./speech-to-text.js";
import type {
  SpeechToTextProvider,
  TelegramVoiceHandleInput,
  TelegramVoiceHandleResult,
} from "./voice-types.js";
import { VoiceMessageError } from "./voice-types.js";

export class VoiceMessageHandler {
  constructor(
    private readonly config: VoiceConfig,
    private readonly provider: SpeechToTextProvider,
    private readonly logger: Logger,
  ) {}

  async handleTelegramVoice(input: TelegramVoiceHandleInput): Promise<TelegramVoiceHandleResult> {
    const { attachment } = input;
    if (!this.config.enabled) {
      throw new VoiceMessageError("voice_disabled", "Voice processing is disabled.");
    }

    this.logger.info("Telegram voice received", {
      chatId: input.chatId,
      userId: input.userId,
      kind: attachment.kind,
      durationSeconds: attachment.durationSeconds,
      fileSizeBytes: attachment.fileSizeBytes,
    });

    this.assertDuration(attachment.durationSeconds);
    this.assertSize(attachment.fileSizeBytes);

    let buffer: Buffer;
    try {
      const remoteFile = await input.telegram.getFile(attachment.fileId);
      if (!remoteFile.file_path) {
        throw new Error("Telegram did not return file_path for voice/audio file.");
      }
      this.assertSize(remoteFile.file_size);
      buffer = await input.telegram.downloadFile(remoteFile.file_path);
      this.assertSize(buffer.byteLength);
      this.logger.info("Telegram voice downloaded", {
        chatId: input.chatId,
        userId: input.userId,
        kind: attachment.kind,
        sizeBytes: buffer.byteLength,
      });
    } catch (error) {
      if (error instanceof VoiceMessageError) {
        throw error;
      }
      throw new VoiceMessageError("download_failed", "Telegram voice download failed.", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const transcription = await this.provider.transcribe({
        audio: buffer,
        filename: attachment.fileName,
        mimeType: attachment.mimeType,
        language: "pt",
      });
      const text = transcription.text.trim();
      if (!text) {
        throw new Error("STT provider returned empty text.");
      }
      this.logger.info("Telegram voice transcribed", {
        chatId: input.chatId,
        userId: input.userId,
        kind: attachment.kind,
        provider: transcription.provider,
        model: transcription.model,
        sizeBytes: buffer.byteLength,
      });
      return {
        text,
        provider: transcription.provider,
        model: transcription.model,
        kind: attachment.kind,
        durationSeconds: attachment.durationSeconds,
        sizeBytes: buffer.byteLength,
      };
    } catch (error) {
      if (error instanceof VoiceMessageError) {
        throw error;
      }
      throw new VoiceMessageError("transcription_failed", "Voice transcription failed.", {
        provider: this.provider.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private assertDuration(durationSeconds: number | undefined): void {
    if (durationSeconds && durationSeconds > this.config.maxAudioSeconds) {
      throw new VoiceMessageError("audio_too_long", "Audio duration exceeds configured limit.", {
        durationSeconds,
        maxAudioSeconds: this.config.maxAudioSeconds,
      });
    }
  }

  private assertSize(sizeBytes: number | undefined): void {
    if (sizeBytes && sizeBytes > this.config.maxAudioBytes) {
      throw new VoiceMessageError("audio_too_large", "Audio size exceeds configured limit.", {
        sizeBytes,
        maxAudioBytes: this.config.maxAudioBytes,
      });
    }
  }
}

export function createVoiceMessageHandler(config: AppConfig, logger: Logger): VoiceMessageHandler | undefined {
  if (!config.voice.enabled) {
    return undefined;
  }

  return new VoiceMessageHandler(
    config.voice,
    createSpeechToTextProvider(config),
    logger,
  );
}

export function buildVoiceUserErrorMessage(error: unknown): string {
  if (!(error instanceof VoiceMessageError)) {
    return "Não consegui entender esse áudio. Tenta enviar novamente ou manda em texto.";
  }

  switch (error.code) {
    case "voice_disabled":
    case "provider_unavailable":
      return "O processamento de voz ainda não está ativo neste ambiente. Manda em texto por enquanto.";
    case "audio_too_long":
      return "Esse áudio ficou longo demais para processar por aqui. Tenta resumir ou mandar em partes.";
    case "audio_too_large":
      return "Esse áudio ficou pesado demais para processar por aqui. Tenta mandar um áudio mais curto.";
    case "download_failed":
    case "transcription_failed":
      return "Não consegui entender esse áudio. Tenta enviar novamente ou manda em texto.";
  }
}

function createSpeechToTextProvider(config: AppConfig): SpeechToTextProvider {
  if (config.voice.sttProvider === "command") {
    if (!config.voice.sttCommand) {
      return new UnavailableSpeechToTextProvider("VOICE_STT_PROVIDER=command requires VOICE_STT_COMMAND.");
    }
    return new CommandSpeechToTextProvider({
      command: config.voice.sttCommand,
      args: config.voice.sttArgs,
      tempDir: config.voice.tempDir,
      timeoutMs: config.voice.sttTimeoutMs,
    });
  }

  if (!config.llm.apiKey) {
    return new UnavailableSpeechToTextProvider("OpenAI STT requires OPENAI_API_KEY.");
  }

  return new OpenAiSpeechToTextProvider(
    new OpenAiAudioTranscriptionService(
      config.llm.apiKey,
      config.llm.baseUrl,
      config.voice.openAiModel,
      config.voice.sttTimeoutMs,
    ),
  );
}
