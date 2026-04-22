import { randomUUID } from "node:crypto";
import type { Logger } from "../../types/logger.js";
import type { ResearchBrief, ResearchSource } from "../../types/research-brief.js";
import type { GraphIngestionService } from "../knowledge-graph/graph-ingestion.js";
import { SourcePolicy } from "./source-policy.js";
import { ResearchMemoryStore } from "./research-memory-store.js";
import type { WebResearchMode } from "../web-research.js";

interface WebResearchLike {
  search(input: {
    query: string;
    maxResults: number;
    includePageExcerpt?: boolean;
    preferredDomains?: string[];
    seedQueries?: string[];
    mode?: WebResearchMode;
  }): Promise<Array<{
    title: string;
    url: string;
    sourceHost: string;
    snippet: string;
    excerpt?: string;
  }>>;
}

export class ResearchDeskService {
  constructor(
    private readonly store: ResearchMemoryStore,
    private readonly policy: SourcePolicy,
    private readonly createWebResearchService: (logger: Logger) => WebResearchLike,
    private readonly logger: Logger,
    private readonly graphIngestion?: GraphIngestionService,
  ) {}

  async researchAndSave(input: { topic: string; question?: string }): Promise<ResearchBrief> {
    const topic = input.topic.trim();
    const question = input.question?.trim() || topic;
    const service = this.createWebResearchService(this.logger.child({ scope: "research-web" }));
    const results = await service.search({
      query: question,
      maxResults: 5,
      includePageExcerpt: true,
      mode: "executive",
    });
    const collectedAt = new Date().toISOString();
    const sources: ResearchSource[] = results.map((item) => ({
      title: item.title,
      url: item.url,
      ...this.policy.classify(item.url),
      retrievedAt: collectedAt,
      ...(item.excerpt ? { excerpt: item.excerpt } : {}),
    }));

    const facts = results.slice(0, 3).map((item) => `${item.title} | ${item.sourceHost}`);
    const inferences = results[0]?.snippet ? [results[0].snippet.slice(0, 180)] : [];
    const opportunities = results[0] ? [`Explorar ${results[0].title} como próximo aprofundamento.`] : [];
    const risks = results.filter((item) => this.policy.classify(item.url).reliability === "low").map((item) => `Validar a fonte ${item.sourceHost} antes de decidir.`).slice(0, 2);
    const recommendedActions = [
      `Comparar as 2 melhores fontes sobre ${topic}.`,
      ...(results[0] ? [`Salvar um resumo operacional de ${results[0].title}.`] : []),
    ];

    const brief: ResearchBrief = {
      id: randomUUID(),
      topic,
      question,
      collectedAt,
      sources,
      facts,
      inferences,
      opportunities,
      risks,
      recommendedActions,
    };
    const saved = this.store.upsert(brief);
    this.graphIngestion?.ingestResearch(saved);
    return saved;
  }

  listSaved(topic?: string): ResearchBrief[] {
    return topic ? this.store.findByTopic(topic) : this.store.list(20);
  }

  renderSaved(topic?: string): string {
    const items = this.listSaved(topic);
    if (items.length === 0) {
      return topic ? "Ainda não há pesquisa salva para esse tema." : "Ainda não há pesquisas salvas.";
    }
    const brief = items[0];
    return [
      `Pesquisa: ${brief.topic}`,
      `- Pergunta: ${brief.question}`,
      ...brief.facts.slice(0, 3).map((item) => `- Fato/base: ${item}`),
      ...brief.inferences.slice(0, 2).map((item) => `- Inferência: ${item}`),
      ...brief.opportunities.slice(0, 2).map((item) => `- Oportunidade: ${item}`),
      ...brief.risks.slice(0, 2).map((item) => `- Risco: ${item}`),
      ...brief.recommendedActions.slice(0, 2).map((item) => `- Próximo passo: ${item}`),
    ].join("\n");
  }
}
