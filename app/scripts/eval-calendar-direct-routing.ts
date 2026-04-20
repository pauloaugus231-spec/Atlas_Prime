import process from "node:process";
import { AgentCore } from "../src/core/agent-core.js";
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

function buildOrchestration(): any {
  return {
    route: {
      primaryDomain: "secretario_operacional",
      secondaryDomains: [],
      confidence: 0.92,
      actionMode: "schedule",
      reasons: ["eval"],
    },
    policy: {
      riskLevel: "medium",
      autonomyLevel: "draft_with_confirmation",
      guardrails: ["confirmar antes de escrever"],
      requiresApprovalFor: ["calendar.write"],
      capabilities: {
        canReadSensitiveChannels: true,
        canDraftExternalReplies: true,
        canSendExternalReplies: false,
        canWriteWorkspace: false,
        canPersistMemory: true,
        canRunProjectTools: false,
        canModifyCalendar: true,
        canPublishContent: false,
      },
    },
  };
}

function buildCoreStub(readyAliases: string[]) {
  const workspaces = new Map<string, any>([
    [
      "primary",
      {
        getStatus: () => ({
          ready: readyAliases.includes("primary"),
          writeReady: true,
          message: readyAliases.includes("primary") ? "ready" : "primary indisponível",
        }),
        getCalendarAliases: () => ({ primary: "primary" }),
      },
    ],
    [
      "abordagem",
      {
        getStatus: () => ({
          ready: readyAliases.includes("abordagem"),
          writeReady: true,
          message: readyAliases.includes("abordagem") ? "ready" : "abordagem indisponível",
        }),
        getCalendarAliases: () => ({ abordagem: "abordagem" }),
      },
    ],
  ]);

  const core = Object.create(AgentCore.prototype) as AgentCore;
  (core as any).config = {
    google: {
      defaultTimezone: "America/Sao_Paulo",
    },
  };
  (core as any).googleWorkspaces = {
    getAliases: () => ["primary", "abordagem"],
    getWorkspace: (alias?: string) => workspaces.get(alias ?? "primary"),
  };
  (core as any).googleMaps = {
    getStatus: () => ({
      ready: true,
      message: "maps enabled in eval",
    }),
    lookupPlace: async () => ({
      name: "CAPS Girassol",
      formattedAddress: "Av. João Antônio da Silveira, 440 - Restinga, Porto Alegre - RS",
      mapsUrl: "https://maps.google.com/?q=CAPS+Girassol",
    }),
  };
  return core;
}

async function run() {
  const results: EvalResult[] = [];
  const orchestration = buildOrchestration();
  const prompt = "Amanhã terei uma reunião no Caps Girassol, às 9h da manhã.";

  const multiAccountCore = buildCoreStub(["primary", "abordagem"]);
  const lookupResult = await (multiAccountCore as any).tryRunDirectCalendarLookup(
    prompt,
    "req-lookup",
    logger,
    orchestration,
  );
  results.push({
    name: "declarative_event_prompt_does_not_fall_into_calendar_lookup",
    passed: lookupResult === null,
    detail: JSON.stringify(lookupResult, null, 2),
  });

  const multiAccountDraftResult = await (multiAccountCore as any).tryRunDirectGoogleEventDraft(
    prompt,
    "req-draft",
    logger,
    orchestration,
  );
  results.push({
    name: "multiple_ready_accounts_require_account_clarification",
    passed: Boolean(
      multiAccountDraftResult &&
      typeof multiAccountDraftResult.reply === "string" &&
      multiAccountDraftResult.reply.includes("Preciso saber em qual agenda salvar: pessoal ou abordagem?")
      && !multiAccountDraftResult.reply.includes("- Conta:")
      && multiAccountDraftResult.reply.includes("Reunião no CAPS Girassol"),
    ),
    detail: multiAccountDraftResult?.reply,
  });

  const explicitAccountDraftResult = await (multiAccountCore as any).tryRunDirectGoogleEventDraft(
    "Amanhã terei uma reunião no Caps Girassol, às 9h da manhã, na abordagem.",
    "req-draft-account",
    logger,
    orchestration,
  );
  results.push({
    name: "explicit_account_skips_clarification_and_sets_account",
    passed: Boolean(
      explicitAccountDraftResult &&
      typeof explicitAccountDraftResult.reply === "string" &&
      !explicitAccountDraftResult.reply.includes("Preciso saber em qual agenda salvar")
      && explicitAccountDraftResult.reply.includes("- Conta: abordagem"),
    ),
    detail: explicitAccountDraftResult?.reply,
  });

  const singleAccountCore = buildCoreStub(["primary"]);
  const singleAccountDraftResult = await (singleAccountCore as any).tryRunDirectGoogleEventDraft(
    prompt,
    "req-draft-single",
    logger,
    orchestration,
  );
  results.push({
    name: "single_ready_account_defaults_without_clarification",
    passed: Boolean(
      singleAccountDraftResult &&
      typeof singleAccountDraftResult.reply === "string" &&
      !singleAccountDraftResult.reply.includes("Preciso saber em qual agenda salvar")
      && singleAccountDraftResult.reply.includes("- Conta: primary"),
    ),
    detail: singleAccountDraftResult?.reply,
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

  console.log(`\nCalendar direct routing evals ok: ${results.length}/${results.length}`);
}

void run();
