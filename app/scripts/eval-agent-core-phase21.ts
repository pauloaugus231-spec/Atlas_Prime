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
      primaryDomain: "social_media",
      secondaryDomains: [],
      confidence: 0.92,
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
        canModifyCalendar: false,
        canPublishContent: false,
      },
    },
  };
}

function buildCoreStub() {
  const core = Object.create(AgentCore.prototype) as AgentCore;
  const logger = makeLogger();
  let nextId = 20;
  const items = [
    {
      id: 12,
      title: "Item sem roteiro",
      platform: "youtube",
      format: "short_video",
      status: "idea",
      pillar: "renda",
      audience: "autonomos",
      hook: null,
      callToAction: null,
      notes: null,
      targetDate: null,
      assetPath: null,
      channelKey: "riqueza_despertada_youtube",
      seriesKey: null,
      formatTemplateKey: "hook_story",
      ideaScore: 91,
      scoreReason: null,
      queuePriority: 9,
      reviewFeedbackCategory: null,
      reviewFeedbackReason: null,
      lastReviewedAt: null,
      createdAt: "2026-04-21T00:00:00.000Z",
      updatedAt: "2026-04-21T00:00:00.000Z",
    },
    {
      id: 13,
      title: "Item batch 1",
      platform: "youtube",
      format: "short_video",
      status: "idea",
      pillar: "gestao",
      audience: "pequenos negocios",
      hook: null,
      callToAction: null,
      notes: null,
      targetDate: null,
      assetPath: null,
      channelKey: "riqueza_despertada_youtube",
      seriesKey: null,
      formatTemplateKey: "hook_story",
      ideaScore: 88,
      scoreReason: null,
      queuePriority: 8,
      reviewFeedbackCategory: null,
      reviewFeedbackReason: null,
      lastReviewedAt: null,
      createdAt: "2026-04-21T00:00:00.000Z",
      updatedAt: "2026-04-21T00:00:00.000Z",
    },
    {
      id: 14,
      title: "Item batch 2",
      platform: "youtube",
      format: "short_video",
      status: "idea",
      pillar: "marketing",
      audience: "pmes",
      hook: null,
      callToAction: null,
      notes: null,
      targetDate: null,
      assetPath: null,
      channelKey: "riqueza_despertada_youtube",
      seriesKey: null,
      formatTemplateKey: "hook_story",
      ideaScore: 84,
      scoreReason: null,
      queuePriority: 7,
      reviewFeedbackCategory: null,
      reviewFeedbackReason: null,
      lastReviewedAt: null,
      createdAt: "2026-04-21T00:00:00.000Z",
      updatedAt: "2026-04-21T00:00:00.000Z",
    },
  ];

  const contentOps = {
    listItems: (input?: { channelKey?: string; limit?: number }) => {
      const filtered = input?.channelKey ? items.filter((item) => item.channelKey === input.channelKey) : items;
      return filtered.slice(0, input?.limit ?? filtered.length);
    },
    listChannels: () => [
      {
        id: 1,
        key: "riqueza_despertada_youtube",
        name: "Riqueza Despertada",
        platform: "youtube",
        niche: "financas",
        persona: "operadores",
        frequencyPerWeek: 5,
        status: "active",
        primaryGoal: "crescer",
        styleNotes: "direto",
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
        title: "Serie Caixa",
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
        description: "descricao",
        structure: "gancho > historia > CTA",
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
        category: "financas",
        effectivenessScore: 91,
        notes: null,
        createdAt: "2026-04-21T00:00:00.000Z",
        updatedAt: "2026-04-21T00:00:00.000Z",
      },
    ],
    getItemById: (id: number) => items.find((item) => item.id === id) ?? null,
    createItem: (input: any) => {
      const item = {
        id: nextId++,
        platform: "youtube",
        format: "short_video",
        status: input.status ?? "idea",
        pillar: input.pillar ?? null,
        audience: input.audience ?? null,
        hook: input.hook ?? null,
        callToAction: input.callToAction ?? null,
        notes: input.notes ?? null,
        targetDate: null,
        assetPath: null,
        channelKey: input.channelKey ?? null,
        seriesKey: input.seriesKey ?? null,
        formatTemplateKey: input.formatTemplateKey ?? null,
        ideaScore: input.ideaScore ?? null,
        scoreReason: input.scoreReason ?? null,
        queuePriority: input.queuePriority ?? null,
        reviewFeedbackCategory: null,
        reviewFeedbackReason: null,
        lastReviewedAt: null,
        createdAt: "2026-04-21T00:00:00.000Z",
        updatedAt: "2026-04-21T00:00:00.000Z",
        ...input,
      };
      items.push(item);
      return item;
    },
    updateItem: (input: any) => {
      const current = items.find((item) => item.id === input.id);
      if (!current) {
        throw new Error(`Missing item ${input.id}`);
      }
      Object.assign(current, input, { updatedAt: "2026-04-21T01:00:00.000Z" });
      return current;
    },
  };

  (core as any).logger = logger;
  (core as any).config = {
    google: {
      defaultTimezone: "America/Sao_Paulo",
    },
    media: {
      pexelsMaxScenesPerRequest: 2,
    },
  };
  (core as any).contentOps = contentOps;
  (core as any).client = {
    chat: async (input: { messages: Array<{ content?: string }> }) => {
      const userContent = String(input.messages[input.messages.length - 1]?.content ?? "");
      if (userContent.includes("Quantidade: 2")) {
        return {
          message: {
            content: JSON.stringify({
              ideas: [
                {
                  title: "Ideia forte 1",
                  hook: "Gancho 1",
                  pillar: "renda",
                  audience: "operadores",
                  formatTemplateKey: "hook_story",
                  seriesKey: "serie_caixa",
                  notes: "nota 1",
                },
                {
                  title: "Ideia forte 2",
                  hook: "Gancho 2",
                  pillar: "marketing",
                  audience: "operadores",
                  formatTemplateKey: "hook_story",
                  seriesKey: null,
                  notes: "nota 2",
                },
              ],
            }),
          },
        };
      }

      return {
        message: {
          content: JSON.stringify({
            styleMode: "operator",
            mode: "viral_short",
            targetDurationSeconds: 26,
            hook: "Comece pelo mecanismo certo.",
            script: "Cena um. Cena dois. Cena tres.",
            cta: "Comente a sua metricA.",
            description: "Descricao curta para o short.",
            titleOptions: ["Titulo 1", "Titulo 2", "Titulo 3"],
            scenes: [
              {
                order: 1,
                durationSeconds: 8,
                voiceover: "Cena um.",
                overlay: "GANCHO FORTE",
                visualDirection: "dashboard vertical",
                assetSearchQuery: "analytics dashboard vertical",
              },
              {
                order: 2,
                durationSeconds: 8,
                voiceover: "Cena dois.",
                overlay: "MECANISMO",
                visualDirection: "phone ui vertical",
                assetSearchQuery: "phone ui vertical",
              },
              {
                order: 3,
                durationSeconds: 10,
                voiceover: "Cena tres.",
                overlay: "CTA",
                visualDirection: "money desk vertical",
                assetSearchQuery: "money desk vertical",
              },
            ],
            platformVariants: {
              youtubeShort: {
                title: "Titulo YT",
                caption: "Caption YT",
                coverText: "CAPA YT",
              },
              tiktok: {
                hook: "Gancho TikTok",
                caption: "Caption TikTok",
                coverText: "CAPA TT",
              },
            },
          }),
        },
      };
    },
  };
  (core as any).pexelsMedia = {
    isEnabled: () => true,
    searchVideos: async (query: string) => [
      {
        provider: "pexels",
        id: 101,
        width: 1080,
        height: 1920,
        durationSeconds: 8,
        pageUrl: `https://pexels.example/${encodeURIComponent(query)}`,
        videoUrl: `https://cdn.pexels.example/${encodeURIComponent(query)}.mp4`,
        creator: "Pexels",
      },
    ],
  };

  return { core, items };
}

async function run(): Promise<void> {
  const results: EvalResult[] = [];
  const { core, items } = buildCoreStub();
  const orchestration = buildOrchestration();
  const logger = makeLogger();

  {
    const result = await (core as any).tryRunDirectContentIdeaGeneration(
      "gere 2 ideias para o canal riqueza despertada no youtube",
      "req-phase21-content-ideas",
      logger,
      orchestration,
    );

    results.push(assert(
      "agent_core_content_idea_generation_wrapper_uses_content_generation_direct_service",
      Boolean(
        result?.reply?.includes("Pautas geradas e salvas: 2.") &&
        result.toolExecutions[0]?.toolName === "save_content_item",
      ),
      result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectContentReview(
      "aprove o item #12 do conteudo",
      "req-phase21-content-review",
      logger,
      orchestration,
    );

    results.push(assert(
      "agent_core_content_review_wrapper_uses_content_generation_direct_service",
      Boolean(
        result?.reply?.includes("Item editorial aprovado.") &&
        result.toolExecutions[0]?.toolName === "update_content_item" &&
        items.find((item) => item.id === 12)?.status === "draft",
      ),
      result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectContentScriptGeneration(
      "gere roteiro do item #12 de conteudo",
      "req-phase21-content-script",
      logger,
      orchestration,
    );

    results.push(assert(
      "agent_core_content_script_wrapper_uses_content_generation_direct_service",
      Boolean(
        result?.reply?.includes("Roteiro pronto para o item #12.") &&
        result.toolExecutions[0]?.toolName === "update_content_item" &&
        items.find((item) => item.id === 12)?.notes?.includes("SHORT_PACKAGE_V3"),
      ),
      result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectContentBatchPlanning(
      "monte o lote de videos do canal riqueza despertada",
      "req-phase21-content-batch-planning",
      logger,
      orchestration,
    );

    results.push(assert(
      "agent_core_content_batch_planning_wrapper_uses_content_generation_direct_service",
      Boolean(
        result?.reply?.includes("Lote inicial montado:") &&
        result.toolExecutions[0]?.toolName === "list_content_items",
      ),
      result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectContentBatchGeneration(
      "gere o lote completo de conteudo do canal riqueza despertada",
      "req-phase21-content-batch-generation",
      logger,
      orchestration,
    );

    results.push(assert(
      "agent_core_content_batch_generation_wrapper_uses_content_generation_direct_service",
      Boolean(
        result?.reply?.includes("Lote completo gerado:") &&
        result.toolExecutions[0]?.toolName === "update_content_item" &&
        items.filter((item) => item.notes?.includes("SHORT_PACKAGE_V3")).length >= 2,
      ),
      result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectContentDistributionStrategy(
      "me mostre a estrategia de distribuicao do canal riqueza despertada",
      "req-phase21-content-distribution",
      logger,
      orchestration,
    );

    results.push(assert(
      "agent_core_content_distribution_wrapper_uses_content_generation_direct_service",
      Boolean(
        result?.reply?.includes("Estratégia de distribuição para riqueza_despertada_youtube.") &&
        result.toolExecutions[0]?.toolName === "list_content_items",
      ),
      result?.reply,
    ));
  }

  const failed = results.filter((item) => !item.passed);
  for (const result of results) {
    const status = result.passed ? "PASS" : "FAIL";
    console.log(`${status} ${result.name}${result.detail ? ` :: ${result.detail}` : ""}`);
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

await run();
