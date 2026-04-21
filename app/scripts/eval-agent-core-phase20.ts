import process from "node:process";
import { AgentCore } from "../src/core/agent-core.js";
import type { Logger } from "../src/types/logger.js";

type EvalResult = {
  name: string;
  passed: boolean;
  detail?: string;
};

function assert(name: string, passed: boolean, detail?: string): EvalResult {
  return { name, passed, detail };
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

function buildOrchestration(): any {
  return {
    route: {
      primaryDomain: "secretario_operacional",
      secondaryDomains: [],
      confidence: 0.9,
      actionMode: "assist",
      reasons: ["eval"],
    },
    policy: {
      riskLevel: "medium",
      autonomyLevel: "draft_with_confirmation",
      guardrails: [],
      requiresApprovalFor: [],
      capabilities: {
        canReadSensitiveChannels: true,
        canDraftExternalReplies: true,
        canSendExternalReplies: false,
        canWriteWorkspace: false,
        canPersistMemory: true,
        canRunProjectTools: true,
        canModifyCalendar: true,
        canPublishContent: false,
      },
    },
  };
}

function buildCoreStub() {
  const core = Object.create(AgentCore.prototype) as AgentCore;
  const logger = makeLogger();
  const dailyResearchCalls: Array<Record<string, unknown>> = [];

  (core as any).logger = logger;
  (core as any).config = {
    google: {
      defaultTimezone: "America/Sao_Paulo",
    },
  };
  (core as any).contentOps = {
    listItems: () => [
      {
        id: 11,
        title: "Ideia de short",
        platform: "youtube",
        format: "short_video",
        status: "idea",
        pillar: "renda",
        audience: null,
        hook: null,
        callToAction: null,
        notes: null,
        targetDate: null,
        assetPath: null,
        channelKey: "riqueza_despertada_youtube",
        seriesKey: null,
        formatTemplateKey: null,
        ideaScore: 72,
        scoreReason: null,
        queuePriority: 5,
        reviewFeedbackCategory: null,
        reviewFeedbackReason: null,
        lastReviewedAt: null,
        createdAt: "2026-04-21T00:00:00.000Z",
        updatedAt: "2026-04-21T00:00:00.000Z",
      },
    ],
    listChannels: () => [
      {
        id: 1,
        key: "riqueza_despertada_youtube",
        name: "Riqueza Despertada",
        platform: "youtube",
        niche: null,
        persona: null,
        frequencyPerWeek: 5,
        status: "active",
        primaryGoal: "crescer",
        styleNotes: null,
        voiceProfile: null,
        language: "pt-BR",
        createdAt: "2026-04-21T00:00:00.000Z",
        updatedAt: "2026-04-21T00:00:00.000Z",
      },
    ],
    listSeries: () => [
      {
        id: 1,
        key: "serie_caixa",
        channelKey: "riqueza_despertada_youtube",
        title: "Série Caixa",
        premise: "premissa",
        cadence: "semanal",
        status: "active",
        createdAt: "2026-04-21T00:00:00.000Z",
        updatedAt: "2026-04-21T00:00:00.000Z",
      },
    ],
    listFormatTemplates: () => [
      {
        id: 1,
        key: "hook_story",
        label: "Hook Story",
        description: "descrição",
        structure: "gancho > história > CTA",
        active: true,
        createdAt: "2026-04-21T00:00:00.000Z",
        updatedAt: "2026-04-21T00:00:00.000Z",
      },
    ],
    listHookTemplates: () => [
      {
        id: 1,
        label: "Erro caro",
        template: "O erro mais caro...",
        category: "finanças",
        effectivenessScore: 91,
        notes: null,
        createdAt: "2026-04-21T00:00:00.000Z",
        updatedAt: "2026-04-21T00:00:00.000Z",
      },
    ],
  };
  (core as any).socialAssistant = {
    listNotes: () => [
      {
        id: 7,
        title: "Família Silva",
        noteType: "case_note",
        sensitivity: "restricted",
        personLabel: null,
        summary: "Resumo curto",
        details: null,
        nextAction: "Visita",
        followUpDate: "2026-04-22",
        tags: [],
        createdAt: "2026-04-21T00:00:00.000Z",
        updatedAt: "2026-04-21T00:00:00.000Z",
      },
    ],
  };
  (core as any).runDailyEditorialResearch = async (input: Record<string, unknown>) => {
    dailyResearchCalls.push(input);
    return {
      reply: "Research Kernel pronto.",
      runDate: "2026-04-21",
      createdItemIds: [11, 12],
      skipped: false,
    };
  };

  return { core, dailyResearchCalls };
}

async function run(): Promise<void> {
  const results: EvalResult[] = [];
  const { core, dailyResearchCalls } = buildCoreStub();
  const orchestration = buildOrchestration();
  const logger = makeLogger();

  {
    const result = await (core as any).tryRunDirectContentOverview(
      "me mostre meus conteúdos",
      "req-phase20-content-overview",
      logger,
      orchestration,
    );

    results.push(assert(
      "agent_core_content_overview_wrapper_uses_content_direct_service",
      Boolean(
        result?.reply?.includes("Conteudo encontrado: 1 item(ns).") &&
        result.toolExecutions[0]?.toolName === "list_content_items",
      ),
      result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectContentChannels(
      "liste meus canais editoriais",
      "req-phase20-content-channels",
      logger,
      orchestration,
    );

    results.push(assert(
      "agent_core_content_channels_wrapper_uses_content_direct_service",
      Boolean(
        result?.reply?.includes("Canais editoriais: 1.") &&
        result.toolExecutions[0]?.toolName === "list_content_channels",
      ),
      result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectDailyEditorialResearch(
      "rode meu research kernel editorial",
      "req-phase20-daily-research",
      logger,
      orchestration,
    );

    results.push(assert(
      "agent_core_daily_editorial_research_wrapper_uses_content_direct_service",
      Boolean(
        result?.reply === "Research Kernel pronto." &&
        dailyResearchCalls.length === 1 &&
        result.toolExecutions[0]?.toolName === "daily_editorial_research",
      ),
      JSON.stringify({ dailyResearchCalls, reply: result?.reply }),
    ));
  }

  {
    const result = await (core as any).tryRunDirectCaseNotes(
      "liste minhas notas sociais restritas",
      "req-phase20-case-notes",
      logger,
      orchestration,
    );

    results.push(assert(
      "agent_core_case_notes_wrapper_uses_content_direct_service",
      Boolean(
        result?.reply?.includes("Notas sociais encontradas: 1.") &&
        result.toolExecutions[0]?.toolName === "list_case_notes",
      ),
      result?.reply,
    ));
  }

  const failed = results.filter((item) => !item.passed);
  for (const result of results) {
    const prefix = result.passed ? "PASS" : "FAIL";
    const suffix = result.detail ? ` :: ${result.detail}` : "";
    console.log(`${prefix} ${result.name}${suffix}`);
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("eval-agent-core-phase20 failed", error);
  process.exitCode = 1;
});
