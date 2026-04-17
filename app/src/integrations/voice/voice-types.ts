import type { TelegramFile } from "../telegram/types.js";

export type VoiceInputKind = "voice" | "audio";

export interface TelegramVoiceAttachment {
  fileId: string;
  fileName: string;
  mimeType?: string;
  kind: VoiceInputKind;
  durationSeconds?: number;
  fileSizeBytes?: number;
}

export interface SpeechToTextInput {
  audio: Uint8Array;
  filename: string;
  mimeType?: string;
  language?: string;
}

export interface SpeechToTextResult {
  text: string;
  provider: string;
  model?: string;
}

export interface SpeechToTextProvider {
  readonly name: string;
  transcribe(input: SpeechToTextInput): Promise<SpeechToTextResult>;
}

export interface TelegramVoiceDownloadApi {
  getFile(fileId: string): Promise<TelegramFile>;
  downloadFile(filePath: string): Promise<Buffer>;
}

export interface TelegramVoiceHandleInput {
  chatId: number;
  userId: number;
  attachment: TelegramVoiceAttachment;
  telegram: TelegramVoiceDownloadApi;
}

export interface TelegramVoiceHandleResult {
  text: string;
  provider: string;
  model?: string;
  kind: VoiceInputKind;
  durationSeconds?: number;
  sizeBytes: number;
}

export type VoiceMessageErrorCode =
  | "voice_disabled"
  | "provider_unavailable"
  | "audio_too_long"
  | "audio_too_large"
  | "download_failed"
  | "transcription_failed";

export class VoiceMessageError extends Error {
  constructor(
    readonly code: VoiceMessageErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "VoiceMessageError";
  }
}
