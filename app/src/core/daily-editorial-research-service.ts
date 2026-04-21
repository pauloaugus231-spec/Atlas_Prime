import type { AppConfig } from "../types/config.js";
import type { LlmClient } from "../types/llm.js";
import type { Logger } from "../types/logger.js";
import { normalizeEmailAnalysisText } from "../integrations/email/email-analysis.js";
import { ContentOpsStore } from "./content-ops.js";
import { GoogleTrendsIntakeService, type GoogleTrendItem } from "./trend-intake.js";
import { WebResearchService } from "./web-research.js";
import {
  buildDailyEditorialResearchReply,
  buildDailyEditorialSlotFallbackIdeas,
  buildFallbackEditorialIdeas,
  extractEditorialSlotKeyFromNotes,
  filterSelectedTrendsForChannel,
  formatDateForTimezone,
  hasSavedShortPackage,
  normalizeEditorialSlotKey,
  stripCodeFences,
  truncateBriefText,
  type EditorialSlotKey,
} from "./agent-core-helpers.js";

export interface DailyEditorialResearchInput {
  channelKey?: string;
  timezone?: string;
  trendsLimit?: number;
  ideasLimit?: number;
  now?: Date;
}

export interface DailyEditorialResearchResult {
  reply: string;
  runDate: string;
  createdItemIds: number[];
  skipped: boolean;
}

interface DailyEditorialResearchServiceDependencies {
  config: AppConfig;
  logger: Logger;
  client: LlmClient;
  contentOps: ContentOpsStore;
  runUserPrompt: (prompt: string) => Promise<unknown>;
}

type GeneratedEditorialIdea = {
  slotKey?: EditorialSlotKey;
  title: string;
  hook?: string;
  pillar?: string;
  audience?: string;
  formatTemplateKey?: string;
  seriesKey?: string | null;
  notes?: string;
};

export class DailyEditorialResearchService {
  constructor(private readonly deps: DailyEditorialResearchServiceDependencies) {}

  async run(input?: DailyEditorialResearchInput): Promise<DailyEditorialResearchResult> {
    const timezone = input?.timezone?.trim() || this.deps.config.google.defaultTimezone;
    const now = input?.now ?? new Date();
    const runDate = formatDateForTimezone(now, timezone);
    const runType = "daily_research_brief";
    const channelKey = input?.channelKey ?? "riqueza_despertada_youtube";
    const existing = this.deps.contentOps.getLatestResearchRun(channelKey, runType, runDate);
    if (existing?.status === "success") {
      return {
        reply: existing.summary ?? `Research Kernel já executado para ${channelKey} em ${runDate}.`,
        runDate,
        createdItemIds: [],
        skipped: true,
      };
    }

    const channel = this.deps.contentOps.listChannels({ limit: 20 }).find((item) => item.key === channelKey);
    if (!channel) {
      const summary = `Nao encontrei o canal editorial ${channelKey} para rodar o Research Kernel.`;
      this.deps.contentOps.createResearchRun({
        channelKey,
        runType,
        runDate,
        status: "failed",
        summary,
      });
      return {
        reply: summary,
        runDate,
        createdItemIds: [],
        skipped: false,
      };
    }

    const trendService = new GoogleTrendsIntakeService(this.deps.logger.child({ scope: "google-trends" }));
    const researchService = new WebResearchService(this.deps.logger.child({ scope: "web-research" }));
    const trends = await trendService.fetchBrazilDailyTrends(input?.trendsLimit ?? 10);
    const formats = this.deps.contentOps.listFormatTemplates({ activeOnly: true, limit: 20 });
    const hooks = this.deps.contentOps.listHookTemplates({ limit: 20 });
    const series = this.deps.contentOps.listSeries({ channelKey: channel.key, limit: 20 });
    const ideasLimit = input?.ideasLimit ?? 6;

    const shortlistFallback: Array<{
      title: string;
      approxTraffic?: string;
      fitScore: number;
      angle: string;
      useTrend: boolean;
    }> = trends.slice(0, 3).map((trend, index) => ({
      title: trend.title,
      approxTraffic: trend.approxTraffic,
      fitScore: Math.max(55 - index * 7, 20),
      angle: "Se não houver aderência forte ao canal, usar como contraste e cair para pauta evergreen.",
      useTrend: false,
    }));

    let selectedTrends = shortlistFallback;
    try {
      const response = await this.deps.client.chat({
        messages: [
          {
            role: "system",
            content: [
              "Você é o editor-chefe do canal Riqueza Despertada.",
              "Analise trends do Brasil e selecione no máximo 3 com melhor aderência ao canal.",
              "O canal fala apenas de finanças, negócios, renda, vendas, SaaS, produtos e execução para ganhar dinheiro.",
              "Rejeite esporte, celebridade, entretenimento e notícia geral sem impacto financeiro prático para o público.",
              "Só marque useTrend=true se o tema puder virar conteúdo útil para ganhar, vender, economizar ou decidir melhor financeiramente.",
              "Se o fitScore for menor que 60, useTrend deve ser false.",
              "Se nenhum trend servir, marque useTrend=false e proponha fallback evergreen.",
              "Responda somente JSON válido no formato {\"selectedTrends\":[...]}",
              "Cada item: title, fitScore, angle, useTrend.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Canal: ${channel.name}`,
              `Nicho: ${channel.niche ?? ""}`,
              `Persona: ${channel.persona ?? ""}`,
              `Objetivo: ${channel.primaryGoal ?? ""}`,
              "",
              "Trends BR do momento:",
              ...trends.slice(0, 8).map((trend) =>
                `- ${trend.title}${trend.approxTraffic ? ` | tráfego: ${trend.approxTraffic}` : ""}${trend.newsItems[0]?.title ? ` | notícia: ${trend.newsItems[0].title}` : ""}`,
              ),
            ].join("\n"),
          },
        ],
      });

      const parsed = JSON.parse(stripCodeFences(response.message.content ?? "")) as {
        selectedTrends?: Array<{ title?: string; fitScore?: number; angle?: string; useTrend?: boolean }>;
      };
      if (Array.isArray(parsed.selectedTrends) && parsed.selectedTrends.length > 0) {
        selectedTrends = parsed.selectedTrends
          .filter((item) => item && typeof item.title === "string" && item.title.trim())
          .map((item) => {
            const original = trends.find((trend) => normalizeEmailAnalysisText(trend.title) === normalizeEmailAnalysisText(item.title ?? ""));
            return {
              title: item.title!.trim(),
              fitScore: typeof item.fitScore === "number" ? Math.max(0, Math.min(100, Math.round(item.fitScore))) : 50,
              angle:
                typeof item.angle === "string" && item.angle.trim().length > 0
                  ? item.angle.trim()
                  : "Trend com potencial, mas precisa de recorte editorial mais forte.",
              useTrend: item.useTrend !== false,
              approxTraffic: original?.approxTraffic,
            };
          })
          .slice(0, 3);
      }
    } catch (error) {
      this.deps.logger.warn("Trend shortlist fell back to deterministic ranking", {
        channelKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    selectedTrends = filterSelectedTrendsForChannel({
      channelKey: channel.key,
      selectedTrends,
      rawTrends: trends,
    });

    const usableTrends = selectedTrends.filter((item) => item.useTrend);
    const fallbackMode = usableTrends.length === 0;

    const enrichedTrendContext: Array<{
      trend: GoogleTrendItem;
      angle?: string;
      fitScore?: number;
      research: Array<{ title: string; url: string; snippet: string; sourceHost: string }>;
    }> = [];
    for (const item of usableTrends.slice(0, 3)) {
      const trend = trends.find((entry) => normalizeEmailAnalysisText(entry.title) === normalizeEmailAnalysisText(item.title));
      if (!trend) {
        continue;
      }
      let research = [] as Array<{ title: string; url: string; snippet: string; sourceHost: string }>;
      try {
        research = (await researchService.search({
          query: trend.title,
          maxResults: 3,
          includePageExcerpt: false,
          mode: "executive",
        })).map((entry) => ({
          title: entry.title,
          url: entry.url,
          snippet: entry.snippet,
          sourceHost: entry.sourceHost,
        }));
      } catch (error) {
        this.deps.logger.warn("Trend enrichment failed", {
          trend: trend.title,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      enrichedTrendContext.push({
        trend,
        angle: item.angle,
        fitScore: item.fitScore,
        research,
      });
    }

    const slotFallbacks = buildDailyEditorialSlotFallbackIdeas({
      fallbackMode,
      usableTrendTitle: usableTrends[0]?.title,
    });
    let generatedIdeas: GeneratedEditorialIdea[] = slotFallbacks.flatMap((slot) =>
      buildFallbackEditorialIdeas({
        channelName: channel.name,
        seed: slot.seed,
        formatKeys: formats.map((item) => item.key),
        seriesKeys: series.map((item) => item.key),
        limit: 2,
      }).map((idea) => ({
        ...idea,
        slotKey: slot.slotKey,
        audience: channel.persona ?? idea.audience,
        notes: [`[slot:${slot.slotKey}]`, idea.notes, fallbackMode ? "fallback evergreen por baixa aderência do trend." : ""]
          .filter(Boolean)
          .join(" | "),
      })),
    ).slice(0, ideasLimit);

    try {
      const response = await this.deps.client.chat({
        messages: [
          {
            role: "system",
            content: [
              "Você gera pautas para short-form content do canal Riqueza Despertada.",
              "Cada pauta deve ajudar o espectador a ganhar dinheiro, vender melhor, economizar ou tomar decisão financeira mais inteligente.",
              "Não use futebol, celebridade, entretenimento ou curiosidade sem mecanismo claro de receita, caixa, venda, negócio ou patrimônio.",
              "Responda somente JSON válido.",
              "Formato: {\"ideas\":[...]}",
              "Cada item: slotKey, title, hook, pillar, audience, formatTemplateKey, seriesKey, notes.",
              "Gere exatamente 6 ideias: 2 para morning_finance, 2 para lunch_income, 2 para night_trends.",
              "morning_finance = notícia financeira ou de negócios com impacto prático no bolso ou no mercado.",
              "lunch_income = meios reais de renda extra, serviços, micro-ofertas, execução simples e aplicável.",
              "night_trends = trend do dia adaptado para dinheiro, negócio, renda ou execução. Se não houver trend útil, use evergreen com cara de trend.",
              "Se os trends não servirem, crie pautas evergreen fortes para riqueza, renda, SaaS e execução.",
              "Não gere placeholders nem títulos genéricos.",
              "Use apenas formatTemplateKey e seriesKey que existirem no contexto.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Canal: ${channel.name}`,
              `Plataforma: ${channel.platform}`,
              `Nicho: ${channel.niche ?? ""}`,
              `Persona: ${channel.persona ?? ""}`,
              `Objetivo: ${channel.primaryGoal ?? ""}`,
              `Modo: ${fallbackMode ? "evergreen fallback" : "trend-first"}`,
              `Quantidade: ${ideasLimit}`,
              "",
              "Slots obrigatórios:",
              "- morning_finance => publicação das 07:00",
              "- lunch_income => publicação das 12:00",
              "- night_trends => publicação das 20:00",
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
              "",
              "Contexto de trends:",
              ...(enrichedTrendContext.length > 0
                ? enrichedTrendContext.flatMap((item) => [
                    `- Trend: ${item.trend.title}${item.trend.approxTraffic ? ` | tráfego: ${item.trend.approxTraffic}` : ""}${item.angle ? ` | ângulo: ${item.angle}` : ""}`,
                    ...item.research.map((entry) => `  - Fonte: ${entry.title} | ${entry.sourceHost} | ${truncateBriefText(entry.snippet, 96)}`),
                  ])
                : ["- Nenhum trend com aderência suficiente; use temas evergreen do canal."]),
            ].join("\n"),
          },
        ],
      });

      const parsed = JSON.parse(stripCodeFences(response.message.content ?? "")) as { ideas?: GeneratedEditorialIdea[] } | GeneratedEditorialIdea[];
      const rawIdeas = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.ideas)
          ? parsed.ideas
          : [];
      if (rawIdeas.length > 0) {
        generatedIdeas = rawIdeas
          .filter((item) => item && typeof item.title === "string" && item.title.trim().length > 0)
          .slice(0, ideasLimit)
          .map((item) => ({
            slotKey: normalizeEditorialSlotKey(item.slotKey, "morning_finance"),
            title: item.title.trim(),
            hook: typeof item.hook === "string" ? item.hook.trim() : undefined,
            pillar: typeof item.pillar === "string" ? item.pillar.trim() : undefined,
            audience: item.audience ?? channel.persona ?? "público buscando riqueza e renda",
            formatTemplateKey: item.formatTemplateKey,
            seriesKey: item.seriesKey,
            notes: [`[slot:${normalizeEditorialSlotKey(item.slotKey, "morning_finance")}]`, typeof item.notes === "string" ? item.notes.trim() : ""]
              .filter(Boolean)
              .join(" | "),
          }));
      }
    } catch (error) {
      this.deps.logger.warn("Daily editorial research ideas fell back to deterministic ideas", {
        channelKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const savedItems = generatedIdeas.map((idea) =>
      this.deps.contentOps.createItem({
        title: idea.title,
        platform: channel.platform,
        format: "short_video",
        status: "idea",
        pillar: idea.pillar,
        audience: idea.audience,
        hook: idea.hook,
        notes: idea.notes,
        channelKey: channel.key,
        seriesKey: idea.seriesKey ?? undefined,
        formatTemplateKey: idea.formatTemplateKey ?? undefined,
      }),
    );

    const packagedItemIds: number[] = [];
    const packageFailures: Array<{ id: number; error: string }> = [];
    for (const createdItem of savedItems) {
      try {
        await this.deps.runUserPrompt(`gere roteiro para o item #${createdItem.id}`);
        const refreshed = this.deps.contentOps.getItemById(createdItem.id);
        if (refreshed && hasSavedShortPackage(refreshed.notes)) {
          packagedItemIds.push(createdItem.id);
          continue;
        }
        packageFailures.push({
          id: createdItem.id,
          error: "pacote não foi salvo após a geração",
        });
      } catch (error) {
        packageFailures.push({
          id: createdItem.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const refreshedItems = savedItems.map((item) => this.deps.contentOps.getItemById(item.id) ?? item);

    const reply = buildDailyEditorialResearchReply({
      channelName: channel.name,
      runDate,
      primaryTrend: usableTrends[0]?.title,
      selectedTrends: usableTrends,
      items: refreshedItems.map((item) => ({
        ...item,
        slotKey: extractEditorialSlotKeyFromNotes(item.notes),
        hasScriptPackage: hasSavedShortPackage(item.notes),
      })),
      fallbackMode,
      packageReadyCount: packagedItemIds.length,
      packageFailedCount: packageFailures.length,
    });

    this.deps.contentOps.createResearchRun({
      channelKey: channel.key,
      runType,
      runDate,
      status: "success",
      primaryTrend: usableTrends[0]?.title,
      summary: reply,
      payloadJson: JSON.stringify({
        selectedTrends: usableTrends,
        fallbackMode,
        createdItemIds: savedItems.map((item) => item.id),
        packagedItemIds,
        packageFailures,
        slots: savedItems.map((item) => ({
          id: item.id,
          slotKey: extractEditorialSlotKeyFromNotes(item.notes) ?? null,
        })),
      }),
    });

    return {
      reply,
      runDate,
      createdItemIds: savedItems.map((item) => item.id),
      skipped: false,
    };
  }
}
