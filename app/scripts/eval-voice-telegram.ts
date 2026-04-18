import process from "node:process";
import { normalizeVoiceTranscriptForTelegram } from "../src/core/voice-semantic-normalizer.js";
import { extractTelegramVoiceAttachment } from "../src/integrations/voice/telegram-voice.js";
import { buildVoiceUserErrorMessage, VoiceMessageHandler } from "../src/integrations/voice/voice-message-handler.js";
import type { SpeechToTextInput, SpeechToTextProvider, TelegramVoiceDownloadApi } from "../src/integrations/voice/voice-types.js";
import { VoiceMessageError } from "../src/integrations/voice/voice-types.js";
import type { VoiceConfig } from "../src/types/config.js";
import type { Logger } from "../src/types/logger.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
};

const baseVoiceConfig: VoiceConfig = {
  enabled: true,
  sttProvider: "openai",
  maxAudioSeconds: 90,
  maxAudioBytes: 1024 * 1024,
  tempDir: "/tmp/atlas-voice-eval",
  sttArgs: [],
  sttTimeoutMs: 120000,
  openAiModel: "gpt-4o-mini-transcribe",
};

class FakeSpeechToTextProvider implements SpeechToTextProvider {
  readonly name = "fake";
  calls = 0;

  constructor(private readonly response: string | Error) {}

  async transcribe(_input: SpeechToTextInput) {
    this.calls += 1;
    if (this.response instanceof Error) {
      throw this.response;
    }
    return {
      text: this.response,
      provider: this.name,
      model: "fake-stt",
    };
  }
}

function fakeTelegram(buffer = Buffer.from("audio"), remoteSize = buffer.byteLength): TelegramVoiceDownloadApi {
  return {
    async getFile() {
      return {
        file_id: "file-id",
        file_unique_id: "unique-id",
        file_path: "voice/file.ogg",
        file_size: remoteSize,
      };
    },
    async downloadFile() {
      return buffer;
    },
  };
}

async function run() {
  const results: EvalResult[] = [];

  const normalTextAttachment = extractTelegramVoiceAttachment({
    message_id: 1,
    date: 1,
    chat: { id: 1, type: "private" },
    text: "qual minha agenda amanhã?",
  });
  results.push({
    name: "normal_text_message_has_no_voice_attachment",
    passed: normalTextAttachment === undefined,
    detail: JSON.stringify(normalTextAttachment, null, 2),
  });

  const voiceAttachment = extractTelegramVoiceAttachment({
    message_id: 2,
    date: 1,
    chat: { id: 1, type: "private" },
    voice: {
      file_id: "voice-file",
      duration: 12,
      mime_type: "audio/ogg",
      file_size: 2048,
    },
  });
  results.push({
    name: "telegram_voice_attachment_is_extracted",
    passed: Boolean(
      voiceAttachment &&
        voiceAttachment.fileId === "voice-file" &&
        voiceAttachment.kind === "voice" &&
        voiceAttachment.durationSeconds === 12 &&
        voiceAttachment.fileName.endsWith(".ogg"),
    ),
    detail: JSON.stringify(voiceAttachment, null, 2),
  });

  if (!voiceAttachment) {
    throw new Error("voice attachment fixture failed");
  }

  const provider = new FakeSpeechToTextProvider("qual minha agenda amanhã?");
  const handler = new VoiceMessageHandler(baseVoiceConfig, provider, logger);
  const result = await handler.handleTelegramVoice({
    chatId: 1,
    userId: 10,
    attachment: voiceAttachment,
    telegram: fakeTelegram(Buffer.from("small audio")),
  });
  results.push({
    name: "voice_audio_transcribes_to_normal_text_input",
    passed: result.text === "qual minha agenda amanhã?" && provider.calls === 1,
    detail: JSON.stringify(result, null, 2),
  });

  const normalizedEvent = normalizeVoiceTranscriptForTelegram(
    "marca na agenda provas da faculdade dia 15 de junho às 8 da manhã",
    "America/Sao_Paulo",
  );
  results.push({
    name: "voice_semantics_build_clean_event_draft",
    passed: normalizedEvent.intentHint === "calendar_create"
      && normalizedEvent.eventDraftPreview?.summary === "Provas da faculdade"
      && normalizedEvent.eventDraftPreview?.start.includes("T08:00:00"),
    detail: JSON.stringify(normalizedEvent, null, 2),
  });

  const normalizedTask = normalizeVoiceTranscriptForTelegram(
    "anota uma tarefa comprar pilhas amanhã às 8",
    "America/Sao_Paulo",
  );
  results.push({
    name: "voice_semantics_build_clean_task_draft",
    passed: normalizedTask.intentHint === "task_create"
      && normalizedTask.taskDraftPreview?.title === "Comprar pilhas"
      && typeof normalizedTask.taskDraftPreview?.due === "string",
    detail: JSON.stringify(normalizedTask, null, 2),
  });

  const normalizedMemory = normalizeVoiceTranscriptForTelegram(
    "salva que em plantão quero respostas curtas",
    "America/Sao_Paulo",
  );
  results.push({
    name: "voice_semantics_canonicalize_memory_save",
    passed: normalizedMemory.intentHint === "memory_save"
      && normalizedMemory.text === "salve na minha memória pessoal que em plantão quero respostas curtas",
    detail: JSON.stringify(normalizedMemory, null, 2),
  });

  const contextualReply = normalizeVoiceTranscriptForTelegram(
    "às 8 da manhã",
    "America/Sao_Paulo",
  );
  results.push({
    name: "voice_semantics_preserve_contextual_short_reply",
    passed: contextualReply.intentHint === "contextual_reply"
      && contextualReply.text === "às 8 da manhã",
    detail: JSON.stringify(contextualReply, null, 2),
  });

  const alertReplyAudio = normalizeVoiceTranscriptForTelegram(
    "cria o evento",
    "America/Sao_Paulo",
  );
  results.push({
    name: "voice_semantics_keep_short_alert_followup_contextual",
    passed: alertReplyAudio.intentHint === "contextual_reply"
      && alertReplyAudio.text === "cria o evento",
    detail: JSON.stringify(alertReplyAudio, null, 2),
  });

  const failingHandler = new VoiceMessageHandler(
    baseVoiceConfig,
    new FakeSpeechToTextProvider(new Error("stt down")),
    logger,
  );
  let transcriptionFailureMessage = "";
  try {
    await failingHandler.handleTelegramVoice({
      chatId: 1,
      userId: 10,
      attachment: voiceAttachment,
      telegram: fakeTelegram(Buffer.from("small audio")),
    });
  } catch (error) {
    transcriptionFailureMessage = buildVoiceUserErrorMessage(error);
  }
  results.push({
    name: "transcription_failure_returns_friendly_error",
    passed: transcriptionFailureMessage === "Não consegui entender esse áudio. Tenta enviar novamente ou manda em texto.",
    detail: transcriptionFailureMessage,
  });

  const longHandler = new VoiceMessageHandler(baseVoiceConfig, new FakeSpeechToTextProvider("ignored"), logger);
  let longAudioError: unknown;
  try {
    await longHandler.handleTelegramVoice({
      chatId: 1,
      userId: 10,
      attachment: { ...voiceAttachment, durationSeconds: 120 },
      telegram: fakeTelegram(Buffer.from("small audio")),
    });
  } catch (error) {
    longAudioError = error;
  }
  results.push({
    name: "long_audio_is_rejected_before_transcription",
    passed: longAudioError instanceof VoiceMessageError &&
      longAudioError.code === "audio_too_long" &&
      buildVoiceUserErrorMessage(longAudioError).includes("longo demais"),
    detail: longAudioError instanceof Error ? longAudioError.message : String(longAudioError),
  });

  const largeHandler = new VoiceMessageHandler(baseVoiceConfig, new FakeSpeechToTextProvider("ignored"), logger);
  let largeAudioError: unknown;
  try {
    await largeHandler.handleTelegramVoice({
      chatId: 1,
      userId: 10,
      attachment: { ...voiceAttachment, fileSizeBytes: 2 * 1024 * 1024 },
      telegram: fakeTelegram(Buffer.from("small audio")),
    });
  } catch (error) {
    largeAudioError = error;
  }
  results.push({
    name: "large_audio_is_rejected_before_download",
    passed: largeAudioError instanceof VoiceMessageError &&
      largeAudioError.code === "audio_too_large" &&
      buildVoiceUserErrorMessage(largeAudioError).includes("pesado demais"),
    detail: largeAudioError instanceof Error ? largeAudioError.message : String(largeAudioError),
  });

  const failures = results.filter((item) => !item.passed);
  for (const item of results.filter((entry) => entry.passed)) {
    console.log(`PASS ${item.name}`);
  }

  if (failures.length > 0) {
    console.error("");
    for (const item of failures) {
      console.error(`FAIL ${item.name}`);
      if (item.detail) {
        console.error(item.detail);
      }
      console.error("");
    }
    process.exitCode = 1;
    return;
  }

  console.log(`\nTelegram voice evals ok: ${results.length}/${results.length}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
