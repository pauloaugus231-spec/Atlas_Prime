import type { CapabilityPlan } from "./capability-planner.js";
import type { AgentRunResult } from "./agent-core.js";
import type { ConversationMessage, LlmClient } from "../types/llm.js";
import type { Logger } from "../types/logger.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type { UserPreferences } from "../types/user-preferences.js";
import type { GoogleMapsService, GoogleRouteLookupResult, GooglePlaceLookupResult } from "../integrations/google/google-maps.js";
import { WebResearchService, type WebResearchMode, type WebSearchResult } from "./web-research.js";
import { inferPreferredDomains, resolveKnowledgeAlias } from "./knowledge-aliases.js";

export type ResearchSynthesisProfile = "general" | "market";
export type ResearchFactType = "address" | "phone" | "hours" | "capacity";

interface ExternalIntelligenceDirectHelpers {
  isWebResearchPrompt: (prompt: string) => boolean;
  isImplicitResearchPrompt: (prompt: string) => boolean;
  extractWebResearchQuery: (prompt: string) => string | undefined;
  extractWebResearchMode: (prompt: string) => WebResearchMode;
  maxResearchResultsForMode: (mode: WebResearchMode) => number;
  excerptBudgetForResearchMode: (mode: WebResearchMode) => number;
  inferOfficialFallbackUrls: (query: string, aliasOfficialUrls?: string[]) => string[];
  buildResearchFocusTerms: (
    query: string,
    alias?: { terms?: string[]; matchedTerms?: string[] },
  ) => string[];
  extractRequestedResearchFactTypes: (prompt: string) => ResearchFactType[];
  inferResearchSynthesisProfile: (prompt: string, query: string) => ResearchSynthesisProfile;
  fetchOfficialAliasSources: (
    service: Pick<WebResearchService, "fetchPageExcerpt">,
    urls: string[],
    logger: Logger,
    focusTerms?: string[],
    maxChars?: number,
  ) => Promise<Array<{ title: string; url: string; sourceHost: string; excerpt?: string }>>;
  scoreFocusedExcerpt: (excerpt: string | undefined, focusTerms: string[]) => number;
  buildDeterministicFactLookupReply: (input: {
    query: string;
    aliasLabel?: string;
    facts: Partial<Record<ResearchFactType, string>>;
    requestedTypes: ResearchFactType[];
    sources: Array<{ label: string; url?: string; filePath?: string }>;
  }) => string;
  buildWebResearchReply: (input: {
    query: string;
    aliasLabel?: string;
    results: Array<{
      title: string;
      url: string;
      sourceHost: string;
      snippet: string;
      publishedAt?: string;
      excerpt?: string;
    }>;
  }) => string;
  stripResearchReplyMarkdown: (text: string) => string;
  extractResearchFacts: (text: string) => string[];
  buildMapsRouteReply: (input: {
    objective: CapabilityPlan["objective"];
    route: GoogleRouteLookupResult;
    roundTrip?: boolean;
    fuelPricePerLiter?: number;
    consumptionKmPerLiter?: number;
    alignedGoal?: string;
  }) => string;
  buildPlaceDiscoveryReply: (input: {
    categoryLabel: string;
    locationQuery: string;
    results: GooglePlaceLookupResult[];
  }) => string;
}

export interface ExternalIntelligenceDirectServiceDependencies {
  logger: Logger;
  client: Pick<LlmClient, "chat">;
  googleMaps: Pick<GoogleMapsService, "computeRoute" | "searchPlaces">;
  createWebResearchService: (logger: Logger) => Pick<WebResearchService, "search" | "fetchPageExcerpt">;
  buildBaseMessages: (
    userPrompt: string,
    orchestration: OrchestrationContext,
    preferences?: UserPreferences,
  ) => ConversationMessage[];
  helpers: ExternalIntelligenceDirectHelpers;
}

interface ExternalIntelligenceDirectInput {
  userPrompt: string;
  requestId: string;
  requestLogger: Logger;
  orchestration: OrchestrationContext;
  preferences?: UserPreferences;
}

export class ExternalIntelligenceDirectService {
  constructor(private readonly deps: ExternalIntelligenceDirectServiceDependencies) {}

  async tryRunWebResearch(input: ExternalIntelligenceDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isWebResearchPrompt(input.userPrompt) && !this.deps.helpers.isImplicitResearchPrompt(input.userPrompt)) {
      return null;
    }

    const query = this.deps.helpers.extractWebResearchQuery(input.userPrompt);
    if (!query) {
      return null;
    }

    return this.executeWebResearch({
      ...input,
      query,
      researchMode: this.deps.helpers.extractWebResearchMode(input.userPrompt),
    });
  }

  async executeWebResearch(input: ExternalIntelligenceDirectInput & {
    query: string;
    researchMode: WebResearchMode;
  }): Promise<AgentRunResult> {
    const { userPrompt, query, requestId, requestLogger, orchestration, researchMode, preferences } = input;
    const alias = resolveKnowledgeAlias(query);
    const preferredDomains = inferPreferredDomains(query, alias);

    requestLogger.info("Using direct web research route", {
      query,
      mode: researchMode,
      alias: alias?.id,
      preferredDomains,
    });

    const service = this.deps.createWebResearchService(requestLogger.child({ scope: "web-research" }));
    const results = await service.search({
      query,
      maxResults: this.deps.helpers.maxResearchResultsForMode(researchMode),
      includePageExcerpt: isAddressLookupPrompt(userPrompt) || researchMode !== "quick",
      preferredDomains,
      seedQueries: alias?.webQueries,
      mode: researchMode,
    });

    const officialFallbackUrls = this.deps.helpers.inferOfficialFallbackUrls(query, alias?.officialUrls);
    const hasPreferredWebResult = results.some((item) =>
      preferredDomains.some((domain) => item.sourceHost === domain || item.sourceHost.endsWith(`.${domain}`)),
    );
    const focusTerms = this.deps.helpers.buildResearchFocusTerms(query, alias);
    const requestedFactTypes = this.deps.helpers.extractRequestedResearchFactTypes(userPrompt);
    const synthesisProfile = this.deps.helpers.inferResearchSynthesisProfile(userPrompt, query);

    let officialFallbackResults: Array<{
      title: string;
      url: string;
      sourceHost: string;
      excerpt?: string;
    }> = [];
    if (
      (results.length === 0 || requestedFactTypes.length > 0 || (alias && !hasPreferredWebResult)) &&
      officialFallbackUrls.length
    ) {
      officialFallbackResults = await this.deps.helpers.fetchOfficialAliasSources(
        service,
        officialFallbackUrls,
        requestLogger.child({ scope: "official-alias-source" }),
        focusTerms,
        this.deps.helpers.excerptBudgetForResearchMode(researchMode),
      );
    }

    const mergedResults = [...results];
    for (const item of officialFallbackResults) {
      const existingIndex = mergedResults.findIndex((existing) => existing.url === item.url);
      if (existingIndex === -1) {
        mergedResults.push({
          ...item,
          snippet: "",
          publishedAt: undefined,
          score: 220 + this.deps.helpers.scoreFocusedExcerpt(item.excerpt, focusTerms),
        });
        continue;
      }

      const existing = mergedResults[existingIndex];
      mergedResults[existingIndex] = {
        ...existing,
        title: existing.title || item.title,
        sourceHost: existing.sourceHost || item.sourceHost,
        excerpt:
          (item.excerpt && item.excerpt.length > (existing.excerpt?.length ?? 0))
            ? item.excerpt
            : existing.excerpt,
        score: Math.max(existing.score ?? 0, 220 + this.deps.helpers.scoreFocusedExcerpt(item.excerpt, focusTerms)),
      };
    }

    const sortedMergedResults = [...mergedResults].sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
    const preferredWebResults = sortedMergedResults.filter((item) =>
      preferredDomains.some((domain) => item.sourceHost === domain || item.sourceHost.endsWith(`.${domain}`)),
    );
    const finalResults = preferredWebResults.length > 0
      ? preferredWebResults
      : alias && officialFallbackResults.length > 0
        ? officialFallbackResults.map((item) => ({
            ...item,
            snippet: "",
            publishedAt: undefined,
            score: 220 + this.deps.helpers.scoreFocusedExcerpt(item.excerpt, focusTerms),
          }))
        : sortedMergedResults;

    if (requestedFactTypes.length > 0) {
      const factExtractors: Record<ResearchFactType, (text: string) => string | undefined> = {
        address: extractAddressFromText,
        phone: extractPhoneFromText,
        hours: extractHoursFromText,
        capacity: extractCapacityFromText,
      };

      const sourcePool = finalResults.map((item) => ({
        label: item.title || item.sourceHost,
        url: item.url,
        sourceHost: item.sourceHost,
        score: item.score ?? 0,
        text: `${item.snippet}\n${item.excerpt ?? ""}`,
      }));

      const bestFacts: Partial<Record<ResearchFactType, { value: string; label: string; url?: string; score: number }>> = {};
      for (const source of sourcePool) {
        for (const factType of requestedFactTypes) {
          const value = factExtractors[factType](source.text);
          if (!value) {
            continue;
          }

          const candidateScore = source.score + this.deps.helpers.scoreFocusedExcerpt(source.text, focusTerms);
          const previous = bestFacts[factType];
          if (!previous || candidateScore > previous.score) {
            bestFacts[factType] = {
              value,
              label: source.label,
              url: source.url,
              score: candidateScore,
            };
          }
        }
      }

      if (Object.keys(bestFacts).length > 0) {
        const sources = Array.from(
          new Map(
            Object.values(bestFacts)
              .filter((item): item is { value: string; label: string; url?: string; score: number } => Boolean(item))
              .map((item) => [`${item.label}|${item.url ?? ""}`, { label: item.label, url: item.url }]),
          ).values(),
        );

        return {
          requestId,
          reply: this.deps.helpers.buildDeterministicFactLookupReply({
            query,
            aliasLabel: alias?.label,
            facts: Object.fromEntries(
              Object.entries(bestFacts).map(([key, value]) => [key, value?.value]),
            ) as Partial<Record<ResearchFactType, string>>,
            requestedTypes: requestedFactTypes,
            sources,
          }),
          messages: this.deps.buildBaseMessages(userPrompt, orchestration, preferences),
          toolExecutions: [
            {
              toolName: "web_search",
              resultPreview: JSON.stringify(
                {
                  query,
                  total: finalResults.length,
                  factTypes: requestedFactTypes,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    }

    const synthesizedReply = await this.synthesizeWebResearchReply({
      query,
      mode: researchMode,
      profile: synthesisProfile,
      aliasLabel: alias?.label,
      results: finalResults,
      service,
      logger: requestLogger.child({ scope: "web-research-synthesis" }),
    });

    return {
      requestId,
      reply: synthesizedReply ?? this.deps.helpers.buildWebResearchReply({
        query,
        aliasLabel: alias?.label,
        results: finalResults,
      }),
      messages: this.deps.buildBaseMessages(userPrompt, orchestration, preferences),
      toolExecutions: [
        {
          toolName: "web_search",
          resultPreview: JSON.stringify(
            {
              query,
              mode: researchMode,
              total: finalResults.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async executeMapsRoutePlan(input: ExternalIntelligenceDirectInput & {
    plan: CapabilityPlan;
  }): Promise<AgentRunResult | null> {
    if (input.plan.suggestedAction !== "run_maps_route" || !input.plan.routeRequest) {
      return null;
    }

    const route = await this.deps.googleMaps.computeRoute({
      origin: input.plan.routeRequest.origin,
      destination: input.plan.routeRequest.destination,
      includeTolls: input.plan.routeRequest.includeTolls,
    });

    if (!route) {
      return {
        requestId: input.requestId,
        reply: "Não consegui fechar essa rota com segurança. Me confirma origem e destino do jeito mais direto possível.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [
          {
            toolName: "maps.route",
            resultPreview: JSON.stringify({
              origin: input.plan.routeRequest.origin,
              destination: input.plan.routeRequest.destination,
              found: false,
            }),
          },
        ],
      };
    }

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildMapsRouteReply({
        objective: input.plan.objective,
        route,
        roundTrip: input.plan.routeRequest.roundTrip,
        fuelPricePerLiter: input.plan.routeRequest.fuelPricePerLiter,
        consumptionKmPerLiter: input.plan.routeRequest.consumptionKmPerLiter,
        alignedGoal: input.plan.alignedGoals?.[0],
      }),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "maps.route",
          resultPreview: JSON.stringify({
            origin: route.origin.formattedAddress,
            destination: route.destination.formattedAddress,
            distanceMeters: route.distanceMeters,
            durationSeconds: route.durationSeconds,
            hasTolls: route.hasTolls,
            tolls: route.tolls,
            roundTrip: input.plan.routeRequest.roundTrip,
          }).slice(0, 240),
        },
      ],
    };
  }

  async executeMapsPlacesSearchPlan(input: ExternalIntelligenceDirectInput & {
    plan: CapabilityPlan;
  }): Promise<AgentRunResult | null> {
    if (input.plan.suggestedAction !== "run_maps_places_search" || !input.plan.placesRequest) {
      return null;
    }

    const placesResult = await this.deps.googleMaps.searchPlaces(input.plan.placesRequest.query, {
      maxResults: input.plan.placesRequest.maxResults,
    });

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildPlaceDiscoveryReply({
        categoryLabel: input.plan.placesRequest.categoryLabel,
        locationQuery: input.plan.placesRequest.locationQuery,
        results: placesResult.results,
      }),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "maps.places_search",
          resultPreview: JSON.stringify({
            query: input.plan.placesRequest.query,
            total: placesResult.results.length,
            topResult: placesResult.results[0]?.formattedAddress ?? null,
          }).slice(0, 240),
        },
      ],
    };
  }

  private async synthesizeWebResearchReply(input: {
    query: string;
    mode: WebResearchMode;
    profile: ResearchSynthesisProfile;
    aliasLabel?: string;
    results: Array<{
      title: string;
      url: string;
      sourceHost: string;
      snippet: string;
      excerpt?: string;
      publishedAt?: string;
    }>;
    service: Pick<WebResearchService, "fetchPageExcerpt">;
    logger: Logger;
  }): Promise<string | null> {
    if (input.results.length === 0) {
      return null;
    }

    try {
      const enrichedSources = await Promise.all(
        input.results.slice(0, this.deps.helpers.maxResearchResultsForMode(input.mode)).map(async (result, index) => {
          let excerpt = result.excerpt?.trim() || "";
          if (!excerpt) {
            try {
              excerpt = await input.service.fetchPageExcerpt(
                result.url,
                this.deps.helpers.excerptBudgetForResearchMode(input.mode),
              );
            } catch {
              excerpt = result.snippet?.trim() || "";
            }
          }

          return {
            id: index + 1,
            title: result.title,
            url: result.url,
            sourceHost: result.sourceHost,
            publishedAt: result.publishedAt,
            content: (excerpt || result.snippet || "").slice(0, 2200),
          };
        }),
      );

      const sourceBlocks = enrichedSources
        .filter((item) => item.content.trim())
        .map((item) => {
          const facts = this.deps.helpers.extractResearchFacts(item.content);
          return [
            `[${item.id}] ${item.title}`,
            `Fonte: ${item.sourceHost}`,
            `URL: ${item.url}`,
            ...(item.publishedAt ? [`Publicado: ${item.publishedAt}`] : []),
            ...(facts.length > 0 ? ["Fatos extraídos:", ...facts.map((fact) => `- ${fact}`)] : []),
            "Conteúdo:",
            item.content,
          ].join("\n");
        })
        .join("\n\n");

      const consolidatedFacts = new Map<string, number[]>();
      for (const item of enrichedSources) {
        for (const fact of this.deps.helpers.extractResearchFacts(item.content)) {
          const existing = consolidatedFacts.get(fact) ?? [];
          existing.push(item.id);
          consolidatedFacts.set(fact, existing);
        }
      }

      const consolidatedFactLines = [...consolidatedFacts.entries()]
        .slice(0, 8)
        .map(([fact, sourceIds]) => `- ${fact} [${[...new Set(sourceIds)].join(", ")}]`);

      if (!sourceBlocks.trim()) {
        return null;
      }

      const modeInstructions =
        input.profile === "market"
          ? [
              "Entregue a resposta exatamente com estas seções em markdown: '## Mercado', '## Concorrentes', '## Sinais de demanda', '## Oportunidades', '## Riscos', '## Recomendação prática'.",
              "Em cada seção, use bullets curtos e concretos.",
              "Se uma seção não tiver evidência suficiente, diga isso explicitamente.",
              "Na seção '## Recomendação prática', termine com 3 ações priorizadas.",
            ]
          : input.mode === "quick"
            ? [
                "Entregue uma resposta curta e objetiva.",
                "Comece com a resposta direta em até 3 frases.",
                "Se necessário, use no máximo 3 bullets curtos.",
                "Use no máximo 4 fontes.",
                "Evite seções longas.",
              ]
            : input.mode === "deep"
              ? [
                  "Entregue uma resposta mais profunda e analítica.",
                  "Comece com a conclusão principal em 1 parágrafo.",
                  "Depois organize em seções curtas e úteis, como '## Resumo', '## Evidências', '## Riscos ou oportunidades', '## Pontos em aberto'.",
                  "Para pesquisas de mercado, concorrência ou tendências, destaque sinais concretos, oportunidades e limites da evidência.",
                  "Use até 8 fontes, priorizando as mais fortes.",
                ]
              : [
                  "Entregue uma resposta executiva.",
                  "Comece com a resposta direta em 1 parágrafo.",
                  "Depois use seções curtas somente se isso melhorar a clareza.",
                  "Use até 6 fontes.",
                ];

      const response = await this.deps.client.chat({
        messages: [
          {
            role: "system",
            content: [
              "Você é um sintetizador de pesquisa com fontes.",
              "Use somente as fontes fornecidas.",
              "Não invente fatos, números, horários, endereços ou contexto ausente.",
              "Se houver divergência ou incerteza, diga isso explicitamente.",
              "Se uma fonte trouxer uma seção 'Fatos extraídos', trate esses fatos como sinais prioritários daquela própria fonte.",
              "Se houver uma seção 'Fatos consolidados', priorize esses fatos na resposta inicial.",
              "Responda em pt-BR.",
              "Formato geral:",
              "1. Cite afirmações com referências inline no formato [1], [2].",
              "2. Termine com uma seção 'Fontes' listando [n] título - URL.",
              "3. Não mencione que você recebeu trechos ou contexto interno.",
              ...modeInstructions,
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Consulta: ${input.query}`,
              ...(input.aliasLabel ? [`Entidade reconhecida: ${input.aliasLabel}`] : []),
              ...(consolidatedFactLines.length > 0 ? ["", "Fatos consolidados:", ...consolidatedFactLines] : []),
              "",
              "Fontes disponíveis:",
              sourceBlocks,
            ].join("\n"),
          },
        ],
      });

      const content = this.deps.helpers.stripResearchReplyMarkdown(response.message.content ?? "");
      if (!content) {
        return null;
      }

      return content;
    } catch (error) {
      input.logger.warn("Research synthesis failed, using fallback reply", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

function isAddressLookupPrompt(prompt: string): boolean {
  const normalized = normalizeQuery(prompt);
  return normalized.includes("endereco")
    || normalized.includes("endereço")
    || normalized.includes("onde fica")
    || normalized.includes("localizacao")
    || normalized.includes("localização");
}

function normalizeQuery(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function extractAddressFromText(text: string): string | undefined {
  const explicitMatch = text.match(
    /\b(?:endereco|endereço)\s*: ?\s*([^\n|]+?(?:\d{1,5}[^\n|]*)?)(?=(?:\n|\||$))/i,
  );
  if (explicitMatch?.[1]) {
    return explicitMatch[1].replace(/\s+/g, " ").trim();
  }

  const genericMatch = text.match(
    /\b(?:av(?:enida)?\.?|rua|r\.?|travessa|tv\.?|alameda|pra[cç]a|estrada|est\.?)\s+[^\n|,]+,?\s*\d{1,5}(?:[^\n|]*)/i,
  );
  return genericMatch?.[0]?.replace(/\s+/g, " ").trim();
}

function extractPhoneFromText(text: string): string | undefined {
  const explicitMatch = text.match(
    /\b(?:telefone|fone|whatsapp|contato)\s*: ?\s*((?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9?\d{4}[-.\s]?\d{4}|\d{4}[-.\s]?\d{4}))/i,
  );
  if (explicitMatch?.[1]) {
    return explicitMatch[1].replace(/\s+/g, " ").trim();
  }

  const genericMatch = text.match(
    /\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9?\d{4}[-.\s]?\d{4}|\d{4}[-.\s]?\d{4})\b/,
  );
  return genericMatch?.[0]?.replace(/\s+/g, " ").trim();
}

function extractHoursFromText(text: string): string | undefined {
  const match =
    text.match(/\bhor[aá]rio:\s*((?:das|de)\s*\d{1,2}h(?:\s*\d{0,2})?\s*(?:às|as|a)\s*\d{1,2}h(?:\s*\d{0,2})?)/i)
    ?? text.match(/\b((?:das|de)\s*\d{1,2}h(?:\s*\d{0,2})?\s*(?:às|as|a)\s*\d{1,2}h(?:\s*\d{0,2})?)\b/i);
  return match?.[1]?.replace(/\s+/g, " ").trim();
}

function extractCapacityFromText(text: string): string | undefined {
  const explicitMatch =
    text.match(/\bcapacidade(?:\s+total)?(?:\s+citada)?\s*(?:de|para)?\s*(\d{1,4})\s*(?:vagas|pessoas)\b/i)
    ?? text.match(/\b(\d{1,4})\s*(?:vagas|pessoas)\b/i);
  if (!explicitMatch?.[1]) {
    return undefined;
  }

  const total = explicitMatch[1];
  const male =
    text.match(/\b(\d{1,4})\s*(?:na\s+)?ala\s+masculina\b/i)
    ?? text.match(/\b(\d{1,4})\s+na\s+masculina\b/i)
    ?? text.match(/\bmasculin[ao]\s*[:|-]?\s*(\d{1,4})\b/i);
  const female =
    text.match(/\b(\d{1,4})\s*(?:na\s+)?ala\s+feminina\b/i)
    ?? text.match(/\b(\d{1,4})\s+na\s+feminina\b/i)
    ?? text.match(/\bfeminin[ao]\s*[:|-]?\s*(\d{1,4})\b/i);

  const details = [];
  if (male?.[1]) {
    details.push(`${male[1]} masculina`);
  }
  if (female?.[1]) {
    details.push(`${female[1]} feminina`);
  }

  return details.length > 0 ? `${total} vagas (${details.join(", ")})` : `${total} vagas`;
}
