import type { AgentRunResult } from "./agent-core.js";
import type { ConversationMessage, LlmClient } from "../types/llm.js";
import type { Logger } from "../types/logger.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type {
  ContentChannelRecord,
  ContentFormatTemplateRecord,
  ContentHookTemplateRecord,
  ContentItemRecord,
  ContentSeriesRecord,
  CreateContentItemInput,
  UpdateContentItemInput,
} from "../types/content-ops.js";
import type { PexelsMediaService, PexelsVideoSuggestion } from "../integrations/media/pexels.js";

type ShortStyleMode = "operator" | "motivational" | "emotional" | "contrarian";

type ShortScenePlan = {
  order: number;
  durationSeconds: number;
  narrativeFunction?: string;
  scenePurpose?: string;
  voiceover: string;
  overlay: string;
  overlayHighlightWords?: string[];
  emotionalTrigger?: string;
  proofType?: string;
  visualDirection: string;
  visualEnvironment?: string;
  visualAction?: string;
  visualCamera?: string;
  visualPacing?: string;
  assetProviderHint?: string;
  assetSearchQuery: string;
  assetFallbackQuery?: string;
  forbiddenVisuals?: string[];
  retentionDriver?: string;
};

type ShortPlatformVariants = {
  youtubeShort: {
    title: string;
    caption: string;
    coverText: string;
  };
  tiktok: {
    caption: string;
    coverText: string;
    hook: string;
  };
};

type ShortQualityAssessment = {
  score: number;
  passed: boolean;
  reasons: string[];
};

type ShortProductionPack = {
  voiceStyle: string;
  editRhythm: string;
  subtitleStyle: string;
  scenes: Array<{
    order: number;
    subtitleLine: string;
    emphasisWords: string[];
    editInstruction: string;
    selectedAsset?: string;
  }>;
};

type DistributionPlan = {
  primaryPlatform: string;
  secondaryPlatform: string;
  recommendedWindow: string;
  secondaryWindow: string;
  hypothesis: string;
  rationale: string;
};

type ShortFormPackage = {
  styleMode: ShortStyleMode;
  mode: string;
  targetDurationSeconds: number;
  hook: string;
  script: string;
  cta: string;
  description: string;
  titleOptions: string[];
  scenes: ShortScenePlan[];
  platformVariants: ShortPlatformVariants;
  qualityAssessment?: ShortQualityAssessment;
};

type SceneAssetSelection = {
  order: number;
  searchQuery: string;
  suggestions: PexelsVideoSuggestion[];
};

type GeneratedIdea = {
  title: string;
  hook?: string;
  pillar?: string;
  audience?: string;
  formatTemplateKey?: string;
  seriesKey?: string | null;
  notes?: string;
};

interface ContentOpsLike {
  listItems(input?: {
    platform?: string;
    channelKey?: string;
    limit?: number;
  }): ContentItemRecord[];
  listChannels(input?: {
    platform?: string;
    limit?: number;
  }): ContentChannelRecord[];
  listSeries(input?: {
    channelKey?: string;
    limit?: number;
  }): ContentSeriesRecord[];
  listFormatTemplates(input?: {
    activeOnly?: boolean;
    limit?: number;
  }): ContentFormatTemplateRecord[];
  listHookTemplates(input?: {
    limit?: number;
  }): ContentHookTemplateRecord[];
  getItemById(id: number): ContentItemRecord | null;
  createItem(input: CreateContentItemInput): ContentItemRecord;
  updateItem(input: UpdateContentItemInput): ContentItemRecord;
}

interface ContentGenerationDirectHelpers {
  isContentIdeaGenerationPrompt: (prompt: string) => boolean;
  isContentReviewPrompt: (prompt: string) => boolean;
  isContentScriptGenerationPrompt: (prompt: string) => boolean;
  isContentBatchPlanningPrompt: (prompt: string) => boolean;
  isContentBatchGenerationPrompt: (prompt: string) => boolean;
  isContentDistributionStrategyPrompt: (prompt: string) => boolean;
  extractContentPlatform: (prompt: string) => string | undefined;
  extractContentChannelKey: (prompt: string) => string | undefined;
  inferDefaultContentChannelKey: (prompt: string) => string;
  extractContentIdeaSeed: (prompt: string) => string | undefined;
  extractPromptLimit: (prompt: string, fallback: number, max: number) => number;
  buildFallbackEditorialIdeas: (input: {
    channelName: string;
    seed?: string;
    formatKeys: string[];
    seriesKeys: string[];
    limit: number;
  }) => GeneratedIdea[];
  stripCodeFences: (value: string) => string;
  buildContentIdeaGenerationReply: (items: ContentItemRecord[]) => string;
  extractContentItemId: (prompt: string) => number | undefined;
  extractContentQueueOrdinal: (prompt: string) => number | undefined;
  normalizeEmailAnalysisText: (value: string) => string;
  extractContentReviewReason: (prompt: string) => string | undefined;
  classifyContentReviewFeedback: (reason: string | undefined) => string | undefined;
  buildContentReviewNotFoundReply: (input: {
    requestedId: number;
    channelKey: string;
    queue: Array<{ id: number; title: string }>;
  }) => string;
  buildContentReviewReply: (input: {
    action: "approved" | "rejected";
    item: ContentItemRecord;
  }) => string;
  buildManualShortFormPackage: (input: {
    item: {
      title: string;
      pillar: string | null;
      hook: string | null;
      formatTemplateKey?: string | null;
      seriesKey?: string | null;
      notes?: string | null;
    };
    platform: string;
  }) => ShortFormPackage | null;
  buildShortFormFallbackPackage: (input: {
    item: {
      title: string;
      pillar: string | null;
      hook: string | null;
      formatTemplateKey?: string | null;
      seriesKey?: string | null;
      notes?: string | null;
    };
    platform: string;
  }) => ShortFormPackage;
  normalizeShortStyleMode: (value: string | undefined, fallback: ShortStyleMode) => ShortStyleMode;
  clampShortTargetDuration: (value: number | undefined, fallback?: number) => number;
  normalizeScenePlan: any;
  validateShortFormPackage: any;
  resolveSceneAssets: any;
  buildShortProductionPack: any;
  buildDistributionPlan: (input: {
    item: {
      platform: string;
      formatTemplateKey?: string | null;
      pillar?: string | null;
      hook?: string | null;
    };
    channelKey?: string | null;
    orderOffset?: number;
  }) => DistributionPlan;
  buildContentScriptReply: (input: {
    item: {
      id: number;
      title: string;
      hook: string | null;
      callToAction: string | null;
      notes: string | null;
    };
    styleMode: ShortStyleMode;
    mode: string;
    targetDurationSeconds: number;
    headlineOptions: string[];
    script: string;
    description: string;
    scenes: ShortScenePlan[];
    platformVariants: ShortPlatformVariants;
    sceneAssets: SceneAssetSelection[];
    productionPack: ShortProductionPack;
    distributionPlan: DistributionPlan;
    qualityAssessment?: ShortQualityAssessment;
  }) => string;
  hasSavedShortPackage: (notes: string | null | undefined) => boolean;
  buildContentBatchReply: (input: {
    channelKey: string;
    items: Array<{
      id: number;
      title: string;
      status: string;
      queuePriority: number | null;
      ideaScore: number | null;
      hasScriptPackage: boolean;
      recommendedWindow: string;
      hypothesis: string;
    }>;
  }) => string;
  buildContentBatchGenerationReply: (input: {
    channelKey: string;
    generated: Array<{
      id: number;
      title: string;
      status: string;
      recommendedWindow: string;
      hasAssets: boolean;
    }>;
  }) => string;
  isRiquezaContentItemEligible: (item: ContentItemRecord) => boolean;
  buildContentDistributionStrategyReply: (input: {
    channelKey: string;
    items: Array<{
      id: number;
      title: string;
      recommendedWindow: string;
      secondaryWindow: string;
      hypothesis: string;
      rationale: string;
    }>;
  }) => string;
}

export interface ContentGenerationDirectServiceDependencies {
  logger: Logger;
  client: Pick<LlmClient, "chat">;
  contentOps: ContentOpsLike;
  pexelsMedia: PexelsMediaService;
  pexelsMaxScenesPerRequest: number;
  buildBaseMessages: (userPrompt: string, orchestration: OrchestrationContext) => ConversationMessage[];
  helpers: ContentGenerationDirectHelpers;
}

interface ContentGenerationDirectInput {
  userPrompt: string;
  requestId: string;
  requestLogger: Logger;
  orchestration: OrchestrationContext;
}

const SHORT_FORM_SYSTEM_PROMPT = [
  "Você é roteirista de short-form content para o canal Riqueza Despertada.",
  "Sua tarefa é gerar um short com retenção forte para YouTube Shorts e TikTok.",
  "O Atlas não cria vídeos; o Atlas cria retenção.",
  "Responda somente JSON válido.",
  "Formato: styleMode, mode, targetDurationSeconds, hook, script, cta, description, titleOptions, scenes, platformVariants.",
  "styleMode deve ser um destes: operator, motivational, emotional, contrarian.",
  "mode deve ser viral_short.",
  "targetDurationSeconds entre 22 e 32.",
  "titleOptions deve ser array com 3 títulos curtos.",
  "Crie cenas curtas com os campos order, durationSeconds, voiceover, overlay, visualDirection, assetSearchQuery.",
  "assetSearchQuery deve ser uma busca curta em inglês, de 2 a 5 palavras, boa para achar b-roll em banco de vídeo.",
  "O canal é dark/faceless: assetSearchQuery deve priorizar dashboard, laptop, hands, UI, app interface, small business, money desk e phone UI.",
  "Nunca use termos como presenter, speaker, host, selfie, portrait, face, webcam, person talking, business meeting, corporate office, whiteboard, presentation, generic laptop typing ou stock office smiling.",
  "Cada vídeo deve ter UMA ideia central. Sem lista longa, sem densidade excessiva, sem jargão demais.",
  "O hook precisa abrir tensão real em até 2 segundos.",
  "Overlay principal com no máximo 4 palavras. Texto punch, não frase corporativa.",
  "Cenas genéricas ou intercambiáveis com qualquer canal financeiro devem ser rejeitadas.",
  "O CTA deve ser curto. Não invente link, checklist ou oferta que ainda não existem.",
  "Mantenha tom pragmático, sem promessa milagrosa.",
].join(" ");

export class ContentGenerationDirectService {
  constructor(private readonly deps: ContentGenerationDirectServiceDependencies) {}

  async tryRunContentIdeaGeneration(input: ContentGenerationDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isContentIdeaGenerationPrompt(input.userPrompt)) {
      return null;
    }

    const channelKey = this.deps.helpers.inferDefaultContentChannelKey(input.userPrompt);
    const requestedPlatform = this.deps.helpers.extractContentPlatform(input.userPrompt);
    const seed = this.deps.helpers.extractContentIdeaSeed(input.userPrompt);
    const limit = this.deps.helpers.extractPromptLimit(input.userPrompt, 8, 20);
    const channels = this.deps.contentOps.listChannels({ limit: 20 });
    const channel = channels.find((item) => item.key === channelKey)
      ?? channels.find((item) => item.platform === requestedPlatform)
      ?? channels[0];

    if (!channel) {
      return {
        requestId: input.requestId,
        reply: "Nao encontrei nenhum canal editorial configurado para gerar pautas.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
        toolExecutions: [],
      };
    }

    const formats = this.deps.contentOps.listFormatTemplates({ activeOnly: true, limit: 20 });
    const hooks = this.deps.contentOps.listHookTemplates({ limit: 20 });
    const series = this.deps.contentOps.listSeries({ channelKey: channel.key, limit: 20 });

    input.requestLogger.info("Using direct content idea generation route", {
      channelKey: channel.key,
      platform: channel.platform,
      limit,
      seed,
    });

    const fallbackIdeas = this.deps.helpers.buildFallbackEditorialIdeas({
      channelName: channel.name,
      seed,
      formatKeys: formats.map((item) => item.key),
      seriesKeys: series.map((item) => item.key),
      limit,
    }).map((idea) => ({
      ...idea,
      audience: channel.persona ?? idea.audience,
    }));

    let generatedIdeas: GeneratedIdea[] = fallbackIdeas;
    try {
      const response = await this.deps.client.chat({
        messages: [
          {
            role: "system",
            content: [
              "Você é o editor-chefe do Atlas para short-form content.",
              "Responda somente JSON válido.",
              "Formato: um array chamado ideas.",
              "Cada item deve ter: title, hook, pillar, audience, formatTemplateKey, seriesKey, notes.",
              "Não repita ideias.",
              "Faça ideias com potencial de retenção e série.",
              "Se não houver série adequada, use null em seriesKey.",
              "Use somente formatTemplateKey e seriesKey existentes no contexto.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Canal: ${channel.name}`,
              `Channel key: ${channel.key}`,
              `Plataforma: ${channel.platform}`,
              `Nicho: ${channel.niche ?? ""}`,
              `Persona: ${channel.persona ?? ""}`,
              `Objetivo: ${channel.primaryGoal ?? ""}`,
              `Estilo: ${channel.styleNotes ?? ""}`,
              `Idioma: ${channel.language ?? "pt-BR"}`,
              `Quantidade: ${limit}`,
              `Seed opcional: ${seed ?? "nenhuma"}`,
              "",
              "Formatos disponíveis:",
              ...formats.map((item) => `- ${item.key}: ${item.label} | ${item.structure}`),
              "",
              "Séries disponíveis:",
              ...(series.length > 0
                ? series.map((item) => `- ${item.key}: ${item.title} | ${item.premise ?? ""}`)
                : ["- nenhuma série específica"]),
              "",
              "Hooks de referência:",
              ...hooks.slice(0, 8).map((item) => `- ${item.label}: ${item.template}`),
            ].join("\n"),
          },
        ],
      });

      const parsed = JSON.parse(this.deps.helpers.stripCodeFences(response.message.content ?? "")) as
        | { ideas?: GeneratedIdea[]; items?: GeneratedIdea[] }
        | GeneratedIdea[];
      const rawIdeas = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.ideas)
          ? parsed.ideas
          : Array.isArray(parsed.items)
            ? parsed.items
            : [];
      if (rawIdeas.length > 0) {
        generatedIdeas = rawIdeas
          .filter((item) => item && typeof item.title === "string" && item.title.trim().length > 0)
          .slice(0, limit);
      }
    } catch (error) {
      input.requestLogger.warn("Content idea generation fell back to deterministic ideas", {
        channelKey: channel.key,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const savedItems = generatedIdeas.map((idea) =>
      this.deps.contentOps.createItem({
        title: idea.title,
        platform: channel.platform === "youtube" ? "youtube" : channel.platform,
        format: "short_video",
        status: "idea",
        pillar: idea.pillar,
        audience: idea.audience,
        hook: idea.hook,
        notes: idea.notes,
        channelKey: channel.key,
        seriesKey: idea.seriesKey ?? undefined,
        formatTemplateKey: idea.formatTemplateKey ?? undefined,
      })
    );

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildContentIdeaGenerationReply(savedItems),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
      toolExecutions: [
        {
          toolName: "save_content_item",
          resultPreview: JSON.stringify(
            {
              total: savedItems.length,
              channelKey: channel.key,
              platform: channel.platform,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async tryRunContentReview(input: ContentGenerationDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isContentReviewPrompt(input.userPrompt)) {
      return null;
    }

    const requestedItemId = this.deps.helpers.extractContentItemId(input.userPrompt);
    const requestedOrdinal = this.deps.helpers.extractContentQueueOrdinal(input.userPrompt);
    if (!requestedItemId && !requestedOrdinal) {
      return {
        requestId: input.requestId,
        reply: "Diga qual item editorial devo revisar, por exemplo: `aprove o item #12` ou `aprove o primeiro item`.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
        toolExecutions: [],
      };
    }

    const normalized = this.deps.helpers.normalizeEmailAnalysisText(input.userPrompt);
    const action: "approved" | "rejected" = normalized.includes("reprovar") || normalized.includes("reprove")
      ? "rejected"
      : "approved";
    const reason = this.deps.helpers.extractContentReviewReason(input.userPrompt);
    const now = new Date().toISOString();
    const channelKey = this.deps.helpers.extractContentChannelKey(input.userPrompt) ?? this.deps.helpers.inferDefaultContentChannelKey(input.userPrompt);
    const queueItems = this.deps.contentOps.listItems({
      channelKey,
      limit: 20,
    });
    let resolvedItemId = requestedItemId;
    if (requestedOrdinal && requestedOrdinal >= 1 && requestedOrdinal <= queueItems.length) {
      resolvedItemId = queueItems[requestedOrdinal - 1]?.id;
    }
    const directItem = requestedItemId ? this.deps.contentOps.getItemById(requestedItemId) : null;
    if (!directItem && !resolvedItemId) {
      return this.buildReviewNotFoundResult(input, channelKey, requestedItemId ?? requestedOrdinal ?? 0, queueItems);
    }
    if (directItem) {
      resolvedItemId = directItem.id;
    }

    if (!resolvedItemId) {
      return this.buildReviewNotFoundResult(input, channelKey, requestedItemId ?? requestedOrdinal ?? 0, queueItems);
    }

    input.requestLogger.info("Using direct content review route", {
      requestedItemId,
      resolvedItemId,
      requestedOrdinal,
      action,
    });

    const item = this.deps.contentOps.updateItem({
      id: resolvedItemId,
      status: action === "approved" ? "draft" : "archived",
      reviewFeedbackCategory: action === "rejected" ? this.deps.helpers.classifyContentReviewFeedback(reason) ?? "reprovado_manual" : null,
      reviewFeedbackReason: action === "rejected" ? reason ?? "reprovado sem motivo detalhado" : null,
      lastReviewedAt: now,
    });

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildContentReviewReply({
        action,
        item,
      }),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
      toolExecutions: [
        {
          toolName: "update_content_item",
          resultPreview: JSON.stringify(
            {
              id: item.id,
              status: item.status,
              reviewFeedbackCategory: item.reviewFeedbackCategory,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async tryRunContentScriptGeneration(input: ContentGenerationDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isContentScriptGenerationPrompt(input.userPrompt)) {
      return null;
    }

    const channelKey = this.deps.helpers.extractContentChannelKey(input.userPrompt) ?? this.deps.helpers.inferDefaultContentChannelKey(input.userPrompt);
    const item = this.resolveRequestedContentItem(input.userPrompt, channelKey);
    if (!item) {
      return this.buildItemNotFoundResult(input, channelKey);
    }

    input.requestLogger.info("Using direct content script generation route", {
      itemId: item.id,
      channelKey: item.channelKey,
    });

    const prepared = await this.prepareShortPackage({
      item,
      channelKey,
      orderOffset: 0,
      requestLogger: input.requestLogger,
      operation: "script_generation",
    });

    const scriptPackage = this.serializeShortPackage(prepared.payload, prepared.sceneAssets, prepared.productionPack, prepared.distributionPlan);
    const updated = this.deps.contentOps.updateItem({
      id: item.id,
      hook: prepared.payload.hook,
      callToAction: prepared.payload.cta,
      notes: item.notes ? `${item.notes}\n\n${scriptPackage}` : scriptPackage,
      status: "draft",
    });

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildContentScriptReply({
        item: updated,
        styleMode: prepared.payload.styleMode,
        mode: prepared.payload.mode,
        targetDurationSeconds: prepared.payload.targetDurationSeconds,
        headlineOptions: prepared.payload.titleOptions,
        script: prepared.payload.script,
        description: prepared.payload.description,
        scenes: prepared.payload.scenes,
        platformVariants: prepared.payload.platformVariants,
        sceneAssets: prepared.sceneAssets,
        productionPack: prepared.productionPack,
        distributionPlan: prepared.distributionPlan,
        qualityAssessment: prepared.payload.qualityAssessment,
      }),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
      toolExecutions: [
        {
          toolName: "update_content_item",
          resultPreview: JSON.stringify(
            {
              id: updated.id,
              status: updated.status,
              hasScriptPackage: true,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async tryRunContentBatchPlanning(input: ContentGenerationDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isContentBatchPlanningPrompt(input.userPrompt)) {
      return null;
    }

    const channelKey = this.deps.helpers.extractContentChannelKey(input.userPrompt) ?? this.deps.helpers.inferDefaultContentChannelKey(input.userPrompt);
    const limit = Math.min(10, this.deps.helpers.extractPromptLimit(input.userPrompt, 5, 10));
    const items = this.listEligibleBatchItems(channelKey, limit);

    input.requestLogger.info("Using direct content batch planning route", {
      channelKey,
      limit,
      selected: items.length,
    });

    const batchItems = items.map((item, index) => {
      const distributionPlan = this.deps.helpers.buildDistributionPlan({
        item,
        channelKey: item.channelKey ?? channelKey,
        orderOffset: index,
      });
      return {
        id: item.id,
        title: item.title,
        status: item.status,
        queuePriority: item.queuePriority,
        ideaScore: item.ideaScore,
        hasScriptPackage: this.deps.helpers.hasSavedShortPackage(item.notes),
        recommendedWindow: distributionPlan.recommendedWindow,
        hypothesis: distributionPlan.hypothesis,
      };
    });

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildContentBatchReply({
        channelKey,
        items: batchItems,
      }),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
      toolExecutions: [
        {
          toolName: "list_content_items",
          resultPreview: JSON.stringify(
            {
              channelKey,
              selected: batchItems.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async tryRunContentBatchGeneration(input: ContentGenerationDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isContentBatchGenerationPrompt(input.userPrompt)) {
      return null;
    }

    const channelKey = this.deps.helpers.extractContentChannelKey(input.userPrompt) ?? this.deps.helpers.inferDefaultContentChannelKey(input.userPrompt);
    const limit = Math.min(10, this.deps.helpers.extractPromptLimit(input.userPrompt, 5, 10));
    const items = this.listEligibleBatchItems(channelKey, limit);

    input.requestLogger.info("Using direct content batch generation route", {
      channelKey,
      limit,
      selected: items.length,
    });

    if (items.length === 0) {
      return {
        requestId: input.requestId,
        reply: this.deps.helpers.buildContentBatchGenerationReply({ channelKey, generated: [] }),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
        toolExecutions: [],
      };
    }

    const generated: Array<{
      id: number;
      title: string;
      status: string;
      recommendedWindow: string;
      hasAssets: boolean;
    }> = [];

    for (const [index, sourceItem] of items.entries()) {
      const item = this.deps.contentOps.getItemById(sourceItem.id) ?? sourceItem;
      const prepared = await this.prepareShortPackage({
        item,
        channelKey,
        orderOffset: index,
        requestLogger: input.requestLogger,
        operation: "batch_generation",
      });
      const scriptPackage = this.serializeShortPackage(prepared.payload, prepared.sceneAssets, prepared.productionPack, prepared.distributionPlan);
      const updated = this.deps.contentOps.updateItem({
        id: item.id,
        hook: prepared.payload.hook,
        callToAction: prepared.payload.cta,
        notes: item.notes ? `${item.notes}\n\n${scriptPackage}` : scriptPackage,
        status: "draft",
      });

      generated.push({
        id: updated.id,
        title: updated.title,
        status: updated.status,
        recommendedWindow: prepared.distributionPlan.recommendedWindow,
        hasAssets: prepared.sceneAssets.some((scene) => scene.suggestions.length > 0),
      });
    }

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildContentBatchGenerationReply({
        channelKey,
        generated,
      }),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
      toolExecutions: [
        {
          toolName: "update_content_item",
          resultPreview: JSON.stringify(
            {
              channelKey,
              generated: generated.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async tryRunContentDistributionStrategy(input: ContentGenerationDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isContentDistributionStrategyPrompt(input.userPrompt)) {
      return null;
    }

    const channelKey = this.deps.helpers.extractContentChannelKey(input.userPrompt) ?? this.deps.helpers.inferDefaultContentChannelKey(input.userPrompt);
    const limit = Math.min(10, this.deps.helpers.extractPromptLimit(input.userPrompt, 5, 10));
    const items = this.deps.contentOps
      .listItems({ channelKey, limit: 20 })
      .filter((item) => this.deps.helpers.isRiquezaContentItemEligible(item))
      .filter((item) => item.status !== "archived" && item.status !== "published")
      .sort((left, right) =>
        (right.queuePriority ?? right.ideaScore ?? 0) - (left.queuePriority ?? left.ideaScore ?? 0)
        || left.id - right.id,
      )
      .slice(0, limit);

    input.requestLogger.info("Using direct content distribution strategy route", {
      channelKey,
      limit,
      selected: items.length,
    });

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildContentDistributionStrategyReply({
        channelKey,
        items: items.map((item, index) => {
          const plan = this.deps.helpers.buildDistributionPlan({
            item,
            channelKey: item.channelKey ?? channelKey,
            orderOffset: index,
          });
          return {
            id: item.id,
            title: item.title,
            recommendedWindow: plan.recommendedWindow,
            secondaryWindow: plan.secondaryWindow,
            hypothesis: plan.hypothesis,
            rationale: plan.rationale,
          };
        }),
      }),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
      toolExecutions: [
        {
          toolName: "list_content_items",
          resultPreview: JSON.stringify(
            {
              channelKey,
              selected: items.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private buildReviewNotFoundResult(
    input: ContentGenerationDirectInput,
    channelKey: string,
    requestedId: number,
    queueItems: ContentItemRecord[],
  ): AgentRunResult {
    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildContentReviewNotFoundReply({
        requestedId,
        channelKey,
        queue: queueItems.map((item) => ({ id: item.id, title: item.title })),
      }),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
      toolExecutions: [],
    };
  }

  private buildItemNotFoundResult(
    input: ContentGenerationDirectInput,
    channelKey: string,
  ): AgentRunResult {
    const requestedId = this.deps.helpers.extractContentItemId(input.userPrompt)
      ?? this.deps.helpers.extractContentQueueOrdinal(input.userPrompt)
      ?? 0;
    const queueItems = this.deps.contentOps.listItems({ channelKey, limit: 20 });
    return this.buildReviewNotFoundResult(input, channelKey, requestedId, queueItems);
  }

  private resolveRequestedContentItem(userPrompt: string, channelKey: string): ContentItemRecord | null {
    const requestedItemId = this.deps.helpers.extractContentItemId(userPrompt);
    const requestedOrdinal = this.deps.helpers.extractContentQueueOrdinal(userPrompt);
    const queueItems = this.deps.contentOps.listItems({
      channelKey,
      limit: 20,
    });

    let item = requestedItemId ? this.deps.contentOps.getItemById(requestedItemId) : null;
    if (!item && requestedOrdinal && requestedOrdinal >= 1 && requestedOrdinal <= queueItems.length) {
      item = queueItems[requestedOrdinal - 1] ?? null;
    }
    return item;
  }

  private listEligibleBatchItems(channelKey: string, limit: number): ContentItemRecord[] {
    return this.deps.contentOps
      .listItems({ channelKey, limit: 20 })
      .filter((item) => this.deps.helpers.isRiquezaContentItemEligible(item))
      .filter((item) => item.status !== "archived" && item.status !== "published")
      .sort((left, right) => {
        const statusWeight = (value: string) => value === "draft" ? 0 : value === "idea" ? 1 : value === "scheduled" ? 2 : 3;
        return statusWeight(left.status) - statusWeight(right.status)
          || (right.queuePriority ?? right.ideaScore ?? 0) - (left.queuePriority ?? left.ideaScore ?? 0)
          || left.id - right.id;
      })
      .slice(0, limit);
  }

  private async prepareShortPackage(input: {
    item: ContentItemRecord;
    channelKey: string;
    orderOffset: number;
    requestLogger: Logger;
    operation: "script_generation" | "batch_generation";
  }): Promise<{
    payload: ShortFormPackage;
    sceneAssets: SceneAssetSelection[];
    productionPack: ShortProductionPack;
    distributionPlan: DistributionPlan;
  }> {
    const { item, channelKey, orderOffset, requestLogger, operation } = input;
    const formatTemplates = this.deps.contentOps.listFormatTemplates({ activeOnly: true, limit: 20 });
    const formatTemplate = formatTemplates.find((entry) => entry.key === item.formatTemplateKey);
    const series = item.seriesKey
      ? this.deps.contentOps.listSeries({ channelKey: item.channelKey ?? undefined, limit: 20 }).find((entry) => entry.key === item.seriesKey)
      : undefined;

    const manualPayload = this.deps.helpers.buildManualShortFormPackage({
      item,
      platform: item.platform,
    });
    const fallbackPayload = manualPayload ?? this.deps.helpers.buildShortFormFallbackPackage({
      item,
      platform: item.platform,
    });

    let payload = { ...fallbackPayload };

    if (!manualPayload) {
      try {
        const response = await this.deps.client.chat({
          messages: [
            {
              role: "system",
              content: SHORT_FORM_SYSTEM_PROMPT,
            },
            {
              role: "user",
              content: [
                `Título atual: ${item.title}`,
                `Plataforma: ${item.platform}`,
                `Pilar: ${item.pillar ?? ""}`,
                `Audience: ${item.audience ?? ""}`,
                `Hook atual: ${item.hook ?? ""}`,
                `Notas: ${item.notes ?? ""}`,
                `Formato editorial: ${formatTemplate ? `${formatTemplate.label} | ${formatTemplate.structure}` : item.formatTemplateKey ?? ""}`,
                `Série: ${series ? `${series.title} | ${series.premise ?? ""}` : item.seriesKey ?? ""}`,
                `Plataforma principal: ${item.platform}`,
                "Objetivo: retenção forte, clareza, 1 mecanismo central, alto potencial de replay e comentário.",
              ].join("\n"),
            },
          ],
        });

        const parsed = JSON.parse(this.deps.helpers.stripCodeFences(response.message.content ?? "")) as {
          styleMode?: ShortStyleMode;
          mode?: string;
          targetDurationSeconds?: number;
          hook?: string;
          script?: string;
          cta?: string;
          description?: string;
          titleOptions?: string[];
          scenes?: ShortScenePlan[];
          platformVariants?: Partial<ShortPlatformVariants>;
        };

        payload = {
          styleMode: this.deps.helpers.normalizeShortStyleMode(parsed.styleMode, payload.styleMode),
          mode: parsed.mode === "viral_short" ? parsed.mode : payload.mode,
          targetDurationSeconds: this.deps.helpers.clampShortTargetDuration(parsed.targetDurationSeconds, payload.targetDurationSeconds),
          hook: typeof parsed.hook === "string" && parsed.hook.trim() ? parsed.hook.trim() : payload.hook,
          script: typeof parsed.script === "string" && parsed.script.trim() ? parsed.script.trim() : payload.script,
          cta: typeof parsed.cta === "string" && parsed.cta.trim() ? parsed.cta.trim() : payload.cta,
          description:
            typeof parsed.description === "string" && parsed.description.trim()
              ? parsed.description.trim()
              : payload.description,
          titleOptions: Array.isArray(parsed.titleOptions) && parsed.titleOptions.length > 0
            ? parsed.titleOptions.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).slice(0, 3)
            : payload.titleOptions,
          scenes: this.deps.helpers.normalizeScenePlan(parsed.scenes, payload.scenes),
          platformVariants: {
            youtubeShort: {
              title:
                typeof parsed.platformVariants?.youtubeShort?.title === "string" && parsed.platformVariants.youtubeShort.title.trim()
                  ? parsed.platformVariants.youtubeShort.title.trim()
                  : payload.platformVariants.youtubeShort.title,
              caption:
                typeof parsed.platformVariants?.youtubeShort?.caption === "string" && parsed.platformVariants.youtubeShort.caption.trim()
                  ? parsed.platformVariants.youtubeShort.caption.trim()
                  : payload.platformVariants.youtubeShort.caption,
              coverText:
                typeof parsed.platformVariants?.youtubeShort?.coverText === "string" && parsed.platformVariants.youtubeShort.coverText.trim()
                  ? parsed.platformVariants.youtubeShort.coverText.trim()
                  : payload.platformVariants.youtubeShort.coverText,
            },
            tiktok: {
              hook:
                typeof parsed.platformVariants?.tiktok?.hook === "string" && parsed.platformVariants.tiktok.hook.trim()
                  ? parsed.platformVariants.tiktok.hook.trim()
                  : payload.platformVariants.tiktok.hook,
              caption:
                typeof parsed.platformVariants?.tiktok?.caption === "string" && parsed.platformVariants.tiktok.caption.trim()
                  ? parsed.platformVariants.tiktok.caption.trim()
                  : payload.platformVariants.tiktok.caption,
              coverText:
                typeof parsed.platformVariants?.tiktok?.coverText === "string" && parsed.platformVariants.tiktok.coverText.trim()
                  ? parsed.platformVariants.tiktok.coverText.trim()
                  : payload.platformVariants.tiktok.coverText,
            },
          },
        };
      } catch (error) {
        requestLogger.warn(
          operation === "batch_generation"
            ? "Content batch generation fell back to deterministic package"
            : "Content script generation fell back to deterministic package",
          {
            itemId: item.id,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    } else {
      requestLogger.info(
        operation === "batch_generation"
          ? "Using manual short script package for batch generation"
          : "Using manual short script package",
        {
          itemId: item.id,
          scenes: manualPayload.scenes.length,
        },
      );
    }

    payload = this.deps.helpers.validateShortFormPackage(payload, fallbackPayload, {
      title: item.title,
      pillar: item.pillar,
      hook: item.hook,
      formatTemplateKey: item.formatTemplateKey,
      seriesKey: item.seriesKey,
      notes: item.notes,
    });
    const sceneAssets = await this.deps.helpers.resolveSceneAssets(
      this.deps.pexelsMedia,
      payload.scenes,
      this.deps.pexelsMaxScenesPerRequest,
    );
    const productionPack = this.deps.helpers.buildShortProductionPack(payload.styleMode, payload.scenes, sceneAssets);
    const distributionPlan = this.deps.helpers.buildDistributionPlan({
      item,
      channelKey: item.channelKey ?? channelKey,
      orderOffset,
    });

    return {
      payload,
      sceneAssets,
      productionPack,
      distributionPlan,
    };
  }

  private serializeShortPackage(
    payload: ShortFormPackage,
    sceneAssets: SceneAssetSelection[],
    productionPack: ShortProductionPack,
    distributionPlan: DistributionPlan,
  ): string {
    return [
      "SHORT_PACKAGE_V3",
      `style_mode: ${payload.styleMode}`,
      `mode: ${payload.mode}`,
      `target_duration_seconds: ${payload.targetDurationSeconds}`,
      `hook: ${payload.hook}`,
      `cta: ${payload.cta}`,
      "",
      "title_options:",
      ...payload.titleOptions.map((title, index) => `${index + 1}. ${title}`),
      "",
      "scene_plan:",
      ...payload.scenes.map((scene) =>
        `${scene.order}. ${scene.durationSeconds}s | VO=${scene.voiceover} | overlay=${scene.overlay} | visual=${scene.visualDirection} | search=${scene.assetSearchQuery}`,
      ),
      "",
      "scene_meta:",
      ...payload.scenes.map((scene) =>
        `scene_${scene.order}.meta: narrative=${scene.narrativeFunction ?? "mechanism"} | purpose=${scene.scenePurpose ?? "mostrar ação ou prova"} | highlights=${(scene.overlayHighlightWords ?? []).join(", ")} | emotional=${scene.emotionalTrigger ?? "curiosity"} | proof=${scene.proofType ?? "none"} | env=${scene.visualEnvironment ?? "workspace"} | action=${scene.visualAction ?? "mostrar contexto real"} | camera=${scene.visualCamera ?? "over_shoulder"} | pacing=${scene.visualPacing ?? "steady"} | provider=${scene.assetProviderHint ?? "pexels"} | fallback_search=${scene.assetFallbackQuery ?? scene.assetSearchQuery} | forbidden=${(scene.forbiddenVisuals ?? []).join(", ")} | retention=${scene.retentionDriver ?? "specific_mechanism"}`,
      ),
      "",
      "scene_assets:",
      ...(sceneAssets.length > 0
        ? sceneAssets.flatMap((scene) => [
            `scene_${scene.order}.query: ${scene.searchQuery}`,
            ...scene.suggestions.slice(0, 2).map((asset, index) => `scene_${scene.order}.asset_${index + 1}: ${asset.videoUrl ?? asset.pageUrl}`),
          ])
        : ["scene_assets: no_api_results"]),
      "",
      "production_pack:",
      `voice_style: ${productionPack.voiceStyle}`,
      `edit_rhythm: ${productionPack.editRhythm}`,
      `subtitle_style: ${productionPack.subtitleStyle}`,
      ...productionPack.scenes.map((scene) =>
        `scene_${scene.order}.edit: subtitle=${scene.subtitleLine} | emphasis=${scene.emphasisWords.join(", ")} | instruction=${scene.editInstruction}${scene.selectedAsset ? ` | selected_asset=${scene.selectedAsset}` : ""}`,
      ),
      "",
      "distribution_plan:",
      `primary_platform: ${distributionPlan.primaryPlatform}`,
      `secondary_platform: ${distributionPlan.secondaryPlatform}`,
      `recommended_window: ${distributionPlan.recommendedWindow}`,
      `secondary_window: ${distributionPlan.secondaryWindow}`,
      `hypothesis: ${distributionPlan.hypothesis}`,
      `rationale: ${distributionPlan.rationale}`,
      "",
      "platform_variants:",
      `youtube_short.title: ${payload.platformVariants.youtubeShort.title}`,
      `youtube_short.cover_text: ${payload.platformVariants.youtubeShort.coverText}`,
      `youtube_short.caption: ${payload.platformVariants.youtubeShort.caption}`,
      `tiktok.hook: ${payload.platformVariants.tiktok.hook}`,
      `tiktok.cover_text: ${payload.platformVariants.tiktok.coverText}`,
      `tiktok.caption: ${payload.platformVariants.tiktok.caption}`,
      "",
      "script:",
      payload.script,
      "",
      "description:",
      payload.description,
      "",
      "quality_gate:",
      `score: ${payload.qualityAssessment?.score ?? 0}`,
      `passed: ${payload.qualityAssessment?.passed === true ? "true" : "false"}`,
      `reasons: ${(payload.qualityAssessment?.reasons ?? []).join(" | ")}`,
      "END_SHORT_PACKAGE_V3",
    ].join("\n");
  }
}
