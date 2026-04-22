import os from "node:os";
import path from "node:path";
import process from "node:process";
import { mkdtempSync } from "node:fs";
import { DirectRouteRunner, defineDirectRoute } from "../src/core/direct-route-runner.js";
import { OperationalContextDirectService } from "../src/core/operational-context-direct-service.js";
import { RouteDecisionAuditStore } from "../src/core/routing/route-decision-audit-store.js";
import { buildTurnFrame } from "../src/core/routing/turn-understanding-service.js";
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

const orchestration: any = {
  route: {
    primaryDomain: "secretario_operacional",
    secondaryDomains: [],
    confidence: 0.9,
    actionMode: "communicate",
    reasons: ["eval"],
  },
  policy: {
    riskLevel: "low",
    autonomyLevel: "draft_with_confirmation",
    guardrails: [],
    requiresApprovalFor: [],
    capabilities: {
      canReadSensitiveChannels: true,
      canDraftExternalReplies: true,
      canSendExternalReplies: false,
      canWriteWorkspace: false,
      canPersistMemory: true,
      canRunProjectTools: false,
      canModifyCalendar: false,
      canPublishContent: false,
    },
  },
};

const preferences: any = {
  responseStyle: "secretary",
  responseLength: "short",
  proactiveNextStep: false,
  autoSourceFallback: false,
  preferredAgentName: "Atlas",
};

const baseMessages = [{ role: "user", content: "eval" }];
const currentProfile: any = { briefingProfiles: [] };

const helpers: any = {
  isOperationalBriefPrompt: () => false,
  buildOperationalBriefReply: () => "operational brief",
  isMorningBriefPrompt: () => false,
  buildMorningBriefReply: () => "briefing",
  resolveEffectiveOperationalMode: () => null,
  isPersonalOperationalProfileShowPrompt: () => false,
  buildPersonalOperationalProfileReply: () => "perfil",
  isOperationalStateShowPrompt: () => false,
  buildOperationalStateReply: () => "estado",
  isLearnedPreferencesListPrompt: () => false,
  resolveLearnedPreferencesListFilter: () => ({}),
  buildLearnedPreferencesReply: () => "",
  isLearnedPreferencesDeletePrompt: () => false,
  extractLearnedPreferenceId: () => undefined,
  extractLearnedPreferenceDeleteTarget: () => undefined,
  buildLearnedPreferenceDeactivatedReply: () => "",
  isPersonalOperationalProfileUpdatePrompt: () => false,
  extractPersonalOperationalProfileUpdate: () => ({ profile: { morningBriefTime: "06:00" }, changeLabels: ["briefing 06:00"] }),
  buildPersonalOperationalProfileUpdatedReply: (_profile: unknown, labels: string[]) => `perfil atualizado: ${labels.join(", ")}`,
  isPersonalOperationalProfileDeletePrompt: () => false,
  extractPersonalOperationalProfileRemoveQuery: () => "briefing",
  removeFromPersonalOperationalProfile: () => ({ profileUpdate: {}, removedLabels: ["briefing"] }),
  buildPersonalOperationalProfileRemovedReply: () => "perfil removido",
  isPersonalMemoryListPrompt: () => false,
  buildPersonalMemoryListReply: () => "",
  isPersonalMemorySavePrompt: () => false,
  extractPersonalMemoryStatement: () => undefined,
  inferPersonalMemoryKind: () => "rule",
  buildPersonalMemoryTitle: () => "",
  buildPersonalMemorySavedReply: () => "",
  isPersonalMemoryUpdatePrompt: () => false,
  extractPersonalMemoryId: () => undefined,
  extractPersonalMemoryUpdateTarget: () => undefined,
  extractPersonalMemoryUpdateContent: () => undefined,
  buildPersonalMemoryAmbiguousReply: () => "",
  buildPersonalMemoryUpdatedReply: () => "",
  isPersonalMemoryDeletePrompt: () => false,
  extractPersonalMemoryDeleteTarget: () => undefined,
  buildPersonalMemoryDeletedReply: () => "",
};

const service = new OperationalContextDirectService({
  logger,
  googleWorkspace: {
    getStatus: () => ({ ready: true, message: "ok" }),
    getDailyBrief: async () => ({}) as any,
  },
  memory: {
    getDailyFocus: () => [],
  },
  personalOs: {
    getExecutiveMorningBrief: async () => ({}) as any,
  },
  briefingProfiles: {
    resolveProfileForPrompt: () => undefined,
    render: async () => ({
      profile: { id: "default", audience: "self", name: "briefing padrão" },
      brief: {
        events: [],
        taskBuckets: { actionableCount: 0 },
        emails: [],
        approvals: [],
        workflows: [],
        founderSnapshot: { sections: [] },
      } as any,
      reply: "briefing renderizado",
    }) as any,
  },
  preferences: {
    get: () => preferences,
    update: () => preferences,
  },
  personalMemory: {
    getProfile: () => currentProfile,
    getOperationalState: () => ({}) as any,
    findLearnedPreferences: () => [],
    findItems: () => [],
  },
  goalStore: {
    list: () => [],
    get: () => undefined,
    upsert: (goal: any) => goal,
    updateProgress: () => undefined,
    remove: () => false,
    summarize: () => "",
  },
  accountLinking: {
    renderOverview: () => "permissões ativas",
    startConnection: () => ({ reply: "link de conexão" }),
    revokeConnection: () => "google desconectado",
  },
  destinationRegistry: {
    renderList: () => "destinos cadastrados",
    resolve: () => undefined,
    upsert: (input: any) => ({ label: input.label, channel: input.channel, audience: input.audience, address: input.address }),
  },
  sharedBriefingComposer: {
    compose: () => ({ reply: "briefing compartilhável", removedSections: [], blocked: false }),
  },
  commandCenter: {
    render: async () => "painel operacional",
  },
  executeToolDirect: async () => ({ requestId: "tool", content: "ok", rawResult: { profile: { morningBriefTime: "06:00" } } }),
  buildBaseMessages: () => baseMessages as any,
  helpers,
});

function buildInput(text: string) {
  return {
    userPrompt: text,
    requestId: `req-${Math.random().toString(36).slice(2, 8)}`,
    orchestration,
    preferences,
    turnFrame: buildTurnFrame({ text }),
  };
}

async function run() {
  const results: EvalResult[] = [];

  const morningBrief = await service.tryRunMorningBrief(buildInput("quero ver meu briefing agora"));
  results.push({
    name: "morning_brief_accepts_turn_frame_even_without_legacy_prompt_match",
    passed: morningBrief?.reply === "briefing renderizado",
    detail: JSON.stringify(morningBrief, null, 2),
  });

  const profileUpdate = await service.tryRunProfileUpdate(buildInput("quero meu briefing às 6h"));
  results.push({
    name: "profile_update_accepts_briefing_update_intent_without_legacy_gate",
    passed: Boolean(profileUpdate?.reply.includes("perfil atualizado")),
    detail: JSON.stringify(profileUpdate, null, 2),
  });

  const commandCenter = await service.tryRunCommandCenter(buildInput("o que está pegando agora?"));
  results.push({
    name: "command_center_accepts_structured_intent",
    passed: commandCenter?.reply === "painel operacional",
    detail: JSON.stringify(commandCenter, null, 2),
  });

  const connectionStart = await service.tryRunConnectionStart(buildInput("conectar google"));
  results.push({
    name: "connection_start_accepts_structured_intent",
    passed: connectionStart?.reply === "link de conexão",
    detail: JSON.stringify(connectionStart, null, 2),
  });

  const tempDir = mkdtempSync(path.join(os.tmpdir(), "atlas-routing-intent-first-"));
  const audit = new RouteDecisionAuditStore(path.join(tempDir, "routing.sqlite"), logger);
  const runner = new DirectRouteRunner(logger, audit);
  const runnerResult = await runner.run(
    {
      userPrompt: "quero meu briefing às 6h",
      activeUserPrompt: "quero meu briefing às 6h",
      requestId: "req-intent-first",
      requestLogger: logger,
      intent: {
        rawPrompt: "quero meu briefing às 6h",
        activeUserPrompt: "quero meu briefing às 6h",
        historyUserTurns: [],
        orchestration,
        mentionedDomains: ["secretario_operacional"],
        compoundIntent: false,
        turnFrame: buildTurnFrame({ text: "quero meu briefing às 6h" }),
      },
      orchestration,
      preferences,
    },
    [
      defineDirectRoute("legacy_first", "test", async (input) => ({ requestId: input.requestId, reply: "legacy", messages: [], toolExecutions: [] }), {
        intents: ["command_center.show"],
        objects: ["command_center"],
        operations: ["show"],
      }),
      defineDirectRoute("personal_profile_update", "test", async (input) => ({ requestId: input.requestId, reply: "intent-first", messages: [], toolExecutions: [] }), {
        intents: ["briefing.update"],
        objects: ["briefing", "profile"],
        operations: ["update"],
        priority: 30,
      }),
    ],
  );
  const auditRow = audit.listRecent(1)[0];
  results.push({
    name: "intent_first_runner_executes_selected_route_for_phase4_intent",
    passed: runnerResult?.reply === "intent-first"
      && auditRow?.mode === "intent_first"
      && auditRow?.executedRoute === "personal_profile_update",
    detail: JSON.stringify({ runnerResult, auditRow }, null, 2),
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

  console.log(`\nRouting phase 4 evals ok: ${results.length}/${results.length}`);
}

void run();
