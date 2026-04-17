import type { TelegramMessage } from "../telegram/types.js";
import type { TelegramVoiceAttachment } from "./voice-types.js";

export function extensionFromMimeType(mimeType: string | undefined, fallback = "bin"): string {
  switch (mimeType?.toLowerCase()) {
    case "audio/ogg":
    case "application/ogg":
      return "ogg";
    case "audio/mpeg":
      return "mp3";
    case "audio/mp4":
    case "audio/x-m4a":
      return "m4a";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/webm":
      return "webm";
    default:
      return fallback;
  }
}

export function extractTelegramVoiceAttachment(message: TelegramMessage): TelegramVoiceAttachment | undefined {
  if (message.voice?.file_id) {
    const extension = extensionFromMimeType(message.voice.mime_type, "ogg");
    return {
      fileId: message.voice.file_id,
      fileName: `voice_${message.message_id}.${extension}`,
      mimeType: message.voice.mime_type,
      kind: "voice",
      durationSeconds: message.voice.duration,
      fileSizeBytes: message.voice.file_size,
    };
  }

  if (message.audio?.file_id) {
    const extension = extensionFromMimeType(message.audio.mime_type, "mp3");
    return {
      fileId: message.audio.file_id,
      fileName: message.audio.file_name?.trim() || `audio_${message.message_id}.${extension}`,
      mimeType: message.audio.mime_type,
      kind: "audio",
      durationSeconds: message.audio.duration,
      fileSizeBytes: message.audio.file_size,
    };
  }

  return undefined;
}
