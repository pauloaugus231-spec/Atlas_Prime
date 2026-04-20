import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ApprovalEngine } from "../src/core/approval-engine.js";
import { ApprovalInboxStore } from "../src/core/approval-inbox.js";
import { ApprovalPolicyService } from "../src/core/approval-policy.js";
import { DraftApprovalService } from "../src/core/draft-approval-service.js";
import { TelegramMessageRouter } from "../src/integrations/telegram/telegram-message-router.js";
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

async function run(): Promise<void> {
  const logger = makeLogger();
  const results: EvalResult[] = [];

  {
    const tempDir = mkdtempSync(path.join(tmpdir(), "atlas-phase2-"));
    try {
      const store = new ApprovalInboxStore(path.join(tempDir, "approval.sqlite"), logger);
      const engine = new ApprovalEngine(store, new ApprovalPolicyService(), logger);
      const service = new DraftApprovalService(engine, logger);

      const approval = service.persist({
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

      const hydrated = service.hydrateLatest(42, {
        excludeKinds: ["monitored_channel_alert"],
      });
      const loaded = service.loadApprovalDraft(approval.id, {
        expectedChatId: 42,
        requirePending: true,
      });

      results.push(assert(
        "draft_approval_service_persists_and_hydrates_latest_draft",
        hydrated?.kind === "google_event"
          && hydrated.summary === "Reunião no CAPS"
          && loaded.kind === "ok"
          && loaded.draft.kind === "google_event",
        JSON.stringify({ approval, hydrated, loaded }, null, 2),
      ));

      service.updateApprovalStatus(approval.id, "discarded");
      const blocked = service.loadApprovalDraft(approval.id, {
        expectedChatId: 42,
        requirePending: true,
      });
      results.push(assert(
        "draft_approval_service_blocks_non_pending_approvals",
        blocked.kind === "not_pending",
        JSON.stringify(blocked, null, 2),
      ));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  {
    const routed: string[] = [];
    const router = new TelegramMessageRouter(
      logger,
      { allowedUserIds: [7] },
      {
        async onCallbackQuery() {
          routed.push("callback");
        },
        async onUnauthorizedMessage() {
          routed.push("unauthorized");
        },
        async onUnsupportedMessage() {
          routed.push("unsupported");
        },
        async onCommand(input) {
          routed.push(`command:${input.command}`);
        },
        async onTextMessage() {
          routed.push("text");
        },
        async onVoiceMessage() {
          routed.push("voice");
        },
        async onImportAttachment(input) {
          routed.push(`import:${input.attachment.kind}`);
        },
      },
    );

    const bot = {
      id: 99,
      is_bot: true,
      first_name: "Atlas",
      username: "atlas_prime_bot",
    };

    await router.routeUpdate({
      update_id: 1,
      message: {
        message_id: 10,
        date: 1,
        chat: { id: 77, type: "private" },
        from: { id: 999, is_bot: false, first_name: "Other" },
        text: "oi",
      },
    }, bot);
    await router.routeUpdate({
      update_id: 2,
      message: {
        message_id: 11,
        date: 1,
        chat: { id: 77, type: "private" },
        from: { id: 7, is_bot: false, first_name: "Paulo" },
        text: "/reset",
      },
    }, bot);
    await router.routeUpdate({
      update_id: 3,
      message: {
        message_id: 12,
        date: 1,
        chat: { id: 77, type: "private" },
        from: { id: 7, is_bot: false, first_name: "Paulo" },
        document: {
          file_id: "doc-1",
          file_name: "agenda.pdf",
          mime_type: "application/pdf",
        },
      },
    }, bot);
    await router.routeUpdate({
      update_id: 4,
      message: {
        message_id: 13,
        date: 1,
        chat: { id: 77, type: "private" },
        from: { id: 7, is_bot: false, first_name: "Paulo" },
        voice: {
          file_id: "voice-1",
          duration: 10,
          mime_type: "audio/ogg",
        },
      },
    }, bot);
    await router.routeUpdate({
      update_id: 5,
      message: {
        message_id: 14,
        date: 1,
        chat: { id: 77, type: "private" },
        from: { id: 7, is_bot: false, first_name: "Paulo" },
        text: "oi atlas",
      },
    }, bot);
    await router.routeUpdate({
      update_id: 6,
      callback_query: {
        id: "cb-1",
        from: { id: 7, is_bot: false, first_name: "Paulo" },
        data: "approval:send:1",
        message: {
          message_id: 15,
          date: 1,
          chat: { id: 77, type: "private" },
        },
      },
    }, bot);

    results.push(assert(
      "telegram_message_router_routes_core_update_types",
      routed.join("|") === "unauthorized|command:reset|import:pdf|voice|text|callback",
      routed.join("|"),
    ));
  }

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
