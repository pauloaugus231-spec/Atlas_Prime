import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ApprovalEngine } from "../src/core/approval-engine.js";
import { ApprovalInboxStore } from "../src/core/approval-inbox.js";
import { ApprovalPolicyService } from "../src/core/approval-policy.js";
import { DraftApprovalService } from "../src/core/draft-approval-service.js";
import { TelegramApprovalUi } from "../src/integrations/telegram/telegram-approval-ui.js";
import { TelegramMediaFlow } from "../src/integrations/telegram/telegram-media-flow.js";
import type { AppConfig } from "../src/types/config.js";
import type { Logger } from "../src/types/logger.js";

type EvalResult = {
  name: string;
  passed: boolean;
  detail?: string;
};

function assert(name: string, condition: boolean, detail?: string): EvalResult {
  return { name, passed: condition, detail };
}

function makeLogger(): Logger {
  const logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => logger,
  } as unknown as Logger;
  return logger;
}

async function runApprovalUiEval(logger: Logger): Promise<EvalResult[]> {
  const tempDir = mkdtempSync(path.join(tmpdir(), "atlas-phase3-approval-"));
  const results: EvalResult[] = [];

  try {
    const store = new ApprovalInboxStore(path.join(tempDir, "approval.sqlite"), logger);
    const engine = new ApprovalEngine(store, new ApprovalPolicyService(), logger);
    const draftApprovalService = new DraftApprovalService(engine, logger);
    const callbackAnswers: Array<{ id: string; payload: Record<string, unknown> }> = [];
    const sentMessages: Array<{ chatId: number; text: string }> = [];
    const executedDrafts: string[] = [];
    const executedHooks: string[] = [];

    const ui = new TelegramApprovalUi(
      [7],
      logger,
      {
        answerCallbackQuery: async (id: string, payload: Record<string, unknown>) => {
          callbackAnswers.push({ id, payload });
          return true;
        },
      } as never,
      draftApprovalService,
      {
        sendText: async (chatId, text) => {
          sentMessages.push({ chatId, text });
        },
        executeDraft: async (draft) => {
          executedDrafts.push(draft.kind);
          return {
            ok: true,
            reply: `executed:${draft.kind}`,
            rawResult: { ok: true },
          };
        },
        onExecuted: async ({ draft }) => {
          executedHooks.push(draft.kind);
        },
      },
    );

    const discardApproval = draftApprovalService.persist({
      chatId: 42,
      channel: "telegram",
      draft: {
        kind: "google_event",
        summary: "Reunião no CAPS",
        start: "2026-04-20T09:00:00-03:00",
        end: "2026-04-20T10:00:00-03:00",
        timezone: "America/Sao_Paulo",
      },
    });

    await ui.handleCallbackQuery({
      id: "cb-discard",
      from: { id: 7, is_bot: false, first_name: "Paulo" },
      data: `approval:discard:${discardApproval.id}`,
      message: {
        message_id: 100,
        date: 1,
        chat: { id: 42, type: "private" },
      },
    });

    results.push(assert(
      "telegram_approval_ui_discards_pending_draft",
      draftApprovalService.getApprovalById(discardApproval.id)?.status === "discarded"
        && !draftApprovalService.peek(42)
        && sentMessages.some((item) => item.text.includes("Rascunho pendente descartado")),
      JSON.stringify({
        approval: draftApprovalService.getApprovalById(discardApproval.id),
        sentMessages,
      }, null, 2),
    ));

    const editApproval = draftApprovalService.persist({
      chatId: 42,
      channel: "telegram",
      draft: {
        kind: "whatsapp_reply",
        remoteJid: "5511999999999@s.whatsapp.net",
        number: "5511999999999",
        pushName: "Contato",
        inboundText: "Oi",
        replyText: "Tudo certo por aqui.",
      },
    });

    await ui.handleCallbackQuery({
      id: "cb-edit",
      from: { id: 7, is_bot: false, first_name: "Paulo" },
      data: `approval:edit:${editApproval.id}`,
      message: {
        message_id: 101,
        date: 1,
        chat: { id: 42, type: "private" },
      },
    });

    results.push(assert(
      "telegram_approval_ui_loads_draft_for_edit",
      draftApprovalService.peek(42)?.kind === "whatsapp_reply"
        && sentMessages.some((item) => item.text.includes("Rascunho carregado para edição")),
      JSON.stringify({
        cachedDraft: draftApprovalService.peek(42),
        sentMessages,
      }, null, 2),
    ));

    draftApprovalService.clear(42, "superseded");

    const sendApproval = draftApprovalService.persist({
      chatId: 42,
      channel: "telegram",
      draft: {
        kind: "google_task",
        title: "Entregar relatório",
        due: "2026-04-21T18:00:00-03:00",
      },
    });

    await ui.handleCallbackQuery({
      id: "cb-send",
      from: { id: 7, is_bot: false, first_name: "Paulo" },
      data: `approval:send:${sendApproval.id}`,
      message: {
        message_id: 102,
        date: 1,
        chat: { id: 42, type: "private" },
      },
    });

    results.push(assert(
      "telegram_approval_ui_executes_and_clears_draft",
      draftApprovalService.getApprovalById(sendApproval.id)?.status === "executed"
        && !draftApprovalService.peek(42)
        && executedDrafts.includes("google_task")
        && executedHooks.includes("google_task")
        && sentMessages.some((item) => item.text === "executed:google_task")
        && callbackAnswers.some((item) => item.payload.text === "Executando aprovação..."),
      JSON.stringify({
        approval: draftApprovalService.getApprovalById(sendApproval.id),
        executedDrafts,
        executedHooks,
        callbackAnswers,
        sentMessages,
      }, null, 2),
    ));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  return results;
}

async function runMediaFlowEval(logger: Logger): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  const continuedTurns: Array<Record<string, unknown>> = [];

  const config = {
    google: {
      defaultTimezone: "America/Sao_Paulo",
    },
    llm: {
      provider: "ollama",
    },
  } as AppConfig;

  const flow = new TelegramMediaFlow(
    config,
    logger,
    {} as never,
    {
      sendText: async (chatId, text) => {
        sentMessages.push({ chatId, text });
      },
      beginTypingFeedback: () => undefined,
      endTypingFeedback: async () => undefined,
      continueConversation: async (input) => {
        continuedTurns.push(input as unknown as Record<string, unknown>);
      },
      appendChatTurn: () => undefined,
      getPendingDraft: () => undefined,
      replaceDraft: () => {
        throw new Error("replaceDraft should not be called in this eval");
      },
      clearDraft: () => undefined,
      resolveScheduleImportAccountAlias: () => "primary",
      getGoogleAccountConfig: () => ({ calendarId: "primary", defaultTimezone: "America/Sao_Paulo" }),
      resolvePreferredScheduleImportMode: async () => undefined,
      resolveCalendarInterpretationRule: async () => undefined,
    },
    {
      voiceHandler: {
        handleTelegramVoice: async () => ({
          text: "Amanhã terei uma reunião no CAPS Girassol às 9h da manhã.",
          provider: "eval",
          model: "stub",
          kind: "voice",
          durationSeconds: 8,
          sizeBytes: 1200,
        }),
      } as never,
    },
  );

  await flow.handleVoiceMessage({
    bot: {
      id: 99,
      is_bot: true,
      first_name: "Atlas",
      username: "atlas_prime_bot",
    },
    message: {
      message_id: 200,
      date: 1,
      chat: { id: 77, type: "private" },
      from: { id: 7, is_bot: false, first_name: "Paulo" },
    },
    userId: 7,
    attachment: {
      kind: "voice",
      fileId: "voice-1",
      fileName: "audio.ogg",
      mimeType: "audio/ogg",
      durationSeconds: 8,
      fileSizeBytes: 1200,
    },
  });

  results.push(assert(
    "telegram_media_flow_routes_transcribed_voice_into_conversation",
    continuedTurns.length === 1
      && continuedTurns[0]?.audioInput === true
      && typeof continuedTurns[0]?.resolvedText === "string"
      && String(continuedTurns[0]?.resolvedText).includes("CAPS Girassol"),
    JSON.stringify(continuedTurns, null, 2),
  ));

  await flow.handleImportAttachment({
    bot: {
      id: 99,
      is_bot: true,
      first_name: "Atlas",
      username: "atlas_prime_bot",
    },
    message: {
      message_id: 201,
      date: 1,
      chat: { id: 77, type: "private" },
      from: { id: 7, is_bot: false, first_name: "Paulo" },
      caption: "transforma essa agenda em eventos",
    },
    userId: 7,
    text: "transforma essa agenda em eventos",
    normalizedText: "transforma essa agenda em eventos",
    attachment: {
      kind: "pdf",
      fileId: "pdf-1",
      fileName: "agenda.pdf",
      mimeType: "application/pdf",
    },
  });

  results.push(assert(
    "telegram_media_flow_handles_import_without_schedule_provider",
    sentMessages.some((item) => item.text.includes("Vou tentar extrair datas, horários, títulos dos eventos"))
      && sentMessages.some((item) => item.text.includes("depende de um provider OpenAI ativo com chave configurada")),
    JSON.stringify(sentMessages, null, 2),
  ));

  return results;
}

async function run(): Promise<void> {
  const logger = makeLogger();
  const results = [
    ...(await runApprovalUiEval(logger)),
    ...(await runMediaFlowEval(logger)),
  ];

  const failed = results.filter((result) => !result.passed);
  for (const result of results) {
    const status = result.passed ? "PASS" : "FAIL";
    console.log(`[${status}] ${result.name}${result.detail ? ` :: ${result.detail}` : ""}`);
  }

  if (failed.length > 0) {
    console.error(`\n${failed.length} eval(s) falharam.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n${results.length}/${results.length} evals passaram.`);
}

void run();
