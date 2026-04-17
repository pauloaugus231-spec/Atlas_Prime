import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { createAgentCore } from "../src/core/create-agent-core.ts";
import type { TelegramApi } from "../src/integrations/telegram/telegram-api.ts";
import { TelegramService } from "../src/integrations/telegram/telegram-service.ts";
import type { TelegramInlineKeyboardMarkup, TelegramMessage, TelegramUpdate, TelegramUser } from "../src/integrations/telegram/types.ts";

interface FakeSentMessage {
  chatId: number;
  text: string;
  options?: {
    reply_to_message_id?: number;
    disable_web_page_preview?: boolean;
    reply_markup?: TelegramInlineKeyboardMarkup;
  };
}

class FakeTelegramApi {
  readonly sentMessages: FakeSentMessage[] = [];

  async sendMessage(
    chatId: number,
    text: string,
    options: FakeSentMessage["options"] = {},
  ): Promise<void> {
    this.sentMessages.push({
      chatId,
      text,
      options,
    });
  }

  async sendVideo(): Promise<void> {
    throw new Error("sendVideo should not be called in smoke-telegram-guided");
  }

  async answerCallbackQuery(): Promise<void> {
    throw new Error("answerCallbackQuery should not be called in smoke-telegram-guided");
  }

  async getFile(): Promise<never> {
    throw new Error("getFile should not be called in smoke-telegram-guided");
  }

  async downloadFile(): Promise<never> {
    throw new Error("downloadFile should not be called in smoke-telegram-guided");
  }

  async getMe(): Promise<never> {
    throw new Error("getMe should not be called in smoke-telegram-guided");
  }

  async deleteWebhook(): Promise<never> {
    throw new Error("deleteWebhook should not be called in smoke-telegram-guided");
  }

  async getUpdates(): Promise<never> {
    throw new Error("getUpdates should not be called in smoke-telegram-guided");
  }
}

function buildIso(date: string, hour: number): string {
  return `${date}T${String(hour).padStart(2, "0")}:00:00-03:00`;
}

function summarize(text: string, max = 220): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

async function main(): Promise<void> {
  const {
    config,
    logger,
    core,
    contentOps,
    approvalEngine,
    clarificationEngine,
    whatsappMessages,
    googleAuth,
  } = await createAgentCore();

  const fakeApi = new FakeTelegramApi();
  const service = new TelegramService(
    config,
    logger.child({ scope: "telegram-smoke" }),
    core,
    contentOps,
    googleAuth,
    fakeApi as unknown as TelegramApi,
    approvalEngine,
    clarificationEngine,
    whatsappMessages,
  );
  const handleUpdate = (service as unknown as {
    handleUpdate(update: TelegramUpdate, bot: TelegramUser): Promise<void>;
  }).handleUpdate.bind(service);

  const bot: TelegramUser = {
    id: 990001,
    is_bot: true,
    first_name: "Atlas",
    username: "atlas_prime_bot",
  };
  const userId = config.telegram.allowedUserIds[0];
  if (!userId) {
    throw new Error("TELEGRAM_ALLOWED_USER_IDS must include at least one allowed user for smoke-telegram-guided");
  }

  const testDate = "2026-04-20";
  const chatId = 980000000 + Math.floor(Date.now() % 100000);
  const createdEvents: Array<{ id: string; account: string }> = [];
  const transcript: Array<{ step: number; prompt: string; reply: string }> = [];
  const testSummaryA = "Reunião teste telegram A Paulo";
  const testSummaryB = "Reunião teste telegram B Paulo";

  let messageId = 1;

  async function createTempEvent(summary: string, hour: number, account: string): Promise<void> {
    const result = await core.executeToolDirect("create_calendar_event", {
      summary,
      start: buildIso(testDate, hour),
      end: buildIso(testDate, hour + 1),
      account,
      reminder_minutes: 30,
    });
    const raw = result.rawResult as { ok?: boolean; error?: string; event?: { id?: string } };
    if (raw.ok === false || !raw.event?.id) {
      throw new Error(raw.error ?? `Failed to create temporary event in account ${account}`);
    }
    createdEvents.push({
      id: raw.event.id,
      account,
    });
  }

  async function sendPrompt(prompt: string): Promise<string> {
    const before = fakeApi.sentMessages.length;
    const message: TelegramMessage = {
      message_id: messageId,
      date: Math.floor(Date.now() / 1000),
      chat: {
        id: chatId,
        type: "private",
      },
      from: {
        id: userId,
        is_bot: false,
        first_name: "Paulo",
        username: "paulo",
      },
      text: prompt,
    };
    const update: TelegramUpdate = {
      update_id: messageId,
      message,
    };
    messageId += 1;

    await handleUpdate(update, bot);
    const reply = fakeApi.sentMessages
      .slice(before)
      .map((item) => item.text)
      .join("\n");
    return reply;
  }

  try {
    await createTempEvent(testSummaryA, 15, "primary");
    await createTempEvent(testSummaryB, 17, "primary");
    await createTempEvent(testSummaryA, 15, "abordagem");
    await createTempEvent(testSummaryB, 17, "abordagem");

    await delay(1500);

    const prompts = [
      "/reset",
      `mostre minha agenda principal em 20/04/2026`,
      `mostre minha agenda da conta abordagem em 20/04/2026`,
      `cancele o evento reuniao teste telegram em 20/04/2026 na conta abordagem`,
      "a primeira",
      "cancela",
      `renomeie o evento ${testSummaryA} em 20/04/2026 na conta primary para Reunião teste Telegram CAPS`,
      "cancelar rascunho",
      "crie um evento Reunião teste contexto curto amanhã às 10h",
      "na abordagem",
      "às 8h da manhã",
      "cancelar rascunho",
    ];

    let step = 1;
    for (const prompt of prompts) {
      const reply = await sendPrompt(prompt);
      transcript.push({
        step,
        prompt,
        reply,
      });
      step += 1;
    }

    const checks = {
      resetAck: transcript[0]?.reply.includes("Histórico curto deste chat foi limpo.") === true,
      primaryAgenda: transcript[1]?.reply.includes("| conta: primary") === true,
      abordagemAgenda: transcript[2]?.reply.includes("| conta: abordagem") === true,
      abordagemChoice: transcript[3]?.reply.includes("Responda com 1 ou 2") === true
        && transcript[3]?.reply.includes("| conta: abordagem") === true,
      naturalChoiceContinues: transcript[4]?.reply.includes("Rascunho de exclusão de evento Google pronto.") === true
        && transcript[4]?.reply.includes(`- Atual: ${testSummaryA}`),
      draftDiscarded: transcript[5]?.reply.includes("Rascunho pendente descartado. Nenhuma ação foi executada.") === true,
      primaryRenameDraft: transcript[6]?.reply.includes("Rascunho de atualização de evento Google pronto.") === true
        && transcript[6]?.reply.includes("- Título: Reunião teste Telegram CAPS"),
      finalDiscarded: transcript[7]?.reply.includes("Rascunho pendente descartado. Nenhuma ação foi executada.") === true,
      contextualDraftCreated: transcript[8]?.reply.includes("Rascunho de evento Google pronto.") === true,
      contextualAccountApplied: transcript[9]?.reply.includes("- Conta: abordagem") === true,
      contextualTimeApplied: transcript[10]?.reply.includes("08:00") === true
        && transcript[10]?.reply.includes("- Conta: abordagem") === true,
      contextualDraftDiscarded: transcript[11]?.reply.includes("Rascunho pendente descartado. Nenhuma ação foi executada.") === true,
    };

    const ok = Object.values(checks).every(Boolean);
    console.log(JSON.stringify({
      ok,
      chatId,
      checks,
      transcript: transcript.map((item) => ({
        step: item.step,
        prompt: item.prompt,
        replyPreview: summarize(item.reply, 320),
      })),
    }, null, 2));
    if (!ok) {
      process.exitCode = 1;
    }
  } finally {
    approvalEngine.listPending(chatId, 20).forEach((item) => {
      approvalEngine.updateStatus(item.id, "discarded");
    });

    for (const event of createdEvents) {
      try {
        await core.executeToolDirect("delete_calendar_event", {
          event_id: event.id,
          account: event.account,
        });
      } catch {
        // best effort cleanup
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
