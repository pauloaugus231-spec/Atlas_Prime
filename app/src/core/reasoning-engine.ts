import type { ActiveGoal } from "./goal-store.js";
import type { Logger } from "../types/logger.js";
import type { OperationalMemoryItem } from "../types/operational-memory.js";
import type { OperationalState } from "../types/operational-state.js";
import type { PersonalOperationalProfile } from "../types/personal-operational-memory.js";

export interface ReasoningTrace {
  realIntent: string;
  relevantContext: string[];
  proactiveInsights: ProactiveInsight[];
  suggestedResponseStyle: "executive" | "analytical" | "direct" | "supportive";
  energyHint: "high" | "medium" | "low";
  shouldOfferNextStep: boolean;
}

export interface ProactiveInsight {
  type:
    | "deadline_approaching"
    | "goal_misalignment"
    | "pattern_detected"
    | "opportunity_spotted"
    | "inconsistency_found"
    | "forgotten_commitment"
    | "overload_warning";
  message: string;
  urgency: "low" | "medium" | "high";
  domain: string;
}

export interface GoalStoreLike {
  list(): ActiveGoal[];
  summarize?(): string;
}

export interface PersonalMemoryLike {
  getProfile?(): PersonalOperationalProfile | undefined;
}

export interface OperationalMemoryLike {
  listItems?(filters?: { includeDone?: boolean; limit?: number }): OperationalMemoryItem[];
  getContextSummary?(): string | undefined;
}

type PromptCategory =
  | "agenda"
  | "tasks"
  | "pricing"
  | "travel"
  | "content"
  | "revenue"
  | "technical"
  | "personal"
  | "ops"
  | "general";

const CATEGORY_KEYWORDS: Record<PromptCategory, string[]> = {
  agenda: ["agenda", "calendario", "calendário", "evento", "reuniao", "reunião", "compromisso"],
  tasks: ["tarefa", "task", "checklist", "pendencia", "pendência", "fazer", "entregar"],
  pricing: ["preco", "preço", "precificacao", "precificação", "orcamento", "orçamento", "proposta", "valor"],
  travel: ["viagem", "rota", "pedagio", "pedágio", "passagem", "hotel", "hospedagem", "distancia", "distância"],
  content: ["post", "conteudo", "conteúdo", "video", "vídeo", "instagram", "social", "roteiro"],
  revenue: ["cliente", "venda", "receita", "contrato", "lead", "prospect", "contato", "reunião comercial", "reuniao comercial"],
  technical: ["codigo", "código", "deploy", "build", "api", "bug", "refator", "arquitetura"],
  personal: ["clima", "briefing", "meu dia", "rotina", "saude", "saúde", "familia", "família"],
  ops: ["operacao", "operação", "processo", "workflow", "organiza", "prioridade", "risco"],
  general: [],
};

const EFFORT_KEYWORDS = [
  "cria",
  "criar",
  "monta",
  "montar",
  "faz",
  "fazer",
  "implementar",
  "planeja",
  "planejar",
  "analisa",
  "analisar",
  "organiza",
  "organizar",
  "resolver",
  "comparar",
  "buscar",
  "pesquisar",
];

const RESOLUTION_KEYWORDS = ["feito", "resolvido", "concluido", "concluído", "finalizado", "pronto", "ok", "deu certo"];
const CUSTOMER_KEYWORDS = ["contato", "reuniao", "reunião", "cliente", "lead", "prospect", "venda", "contrato"];

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(normalized: string, keywords: string[]): boolean {
  return keywords.some((keyword) => normalized.includes(normalizeText(keyword)));
}

function inferCategory(text: string): PromptCategory {
  const normalized = normalizeText(text);
  for (const category of Object.keys(CATEGORY_KEYWORDS) as PromptCategory[]) {
    if (category === "general") {
      continue;
    }
    if (includesAny(normalized, CATEGORY_KEYWORDS[category])) {
      return category;
    }
  }
  return "general";
}

function goalMatchesCategory(goal: ActiveGoal, category: PromptCategory): boolean {
  const normalizedGoal = normalizeText(`${goal.title} ${goal.description ?? ""} ${goal.metric ?? ""}`);
  if (goal.domain === "revenue" && ["revenue", "pricing"].includes(category)) {
    return true;
  }
  if (goal.domain === "content" && category === "content") {
    return true;
  }
  if (goal.domain === "product" && category === "technical") {
    return true;
  }
  if (goal.domain === "ops" && ["ops", "agenda", "tasks"].includes(category)) {
    return true;
  }
  if (goal.domain === "personal" && ["personal", "agenda"].includes(category)) {
    return true;
  }
  return CATEGORY_KEYWORDS[category]?.some((keyword) => normalizedGoal.includes(normalizeText(keyword))) ?? false;
}

function daysUntil(dateIso: string, now = new Date()): number | undefined {
  const parsed = new Date(dateIso);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).getTime();
  return Math.ceil((target - startOfToday) / 86_400_000);
}

function isOlderThanDays(dateIso: string, days: number, now = new Date()): boolean {
  const parsed = new Date(dateIso);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  return now.getTime() - parsed.getTime() > days * 86_400_000;
}

function summarizeGoal(goal: ActiveGoal): string {
  const progress = goal.progress != null ? `, ${Math.round(goal.progress * 100)}%` : "";
  const deadline = goal.deadline ? `, prazo ${goal.deadline}` : "";
  return `${goal.title} (${goal.domain}${deadline}${progress})`;
}

function insightPriority(insight: ProactiveInsight): number {
  const urgencyScore = insight.urgency === "high" ? 100 : insight.urgency === "medium" ? 50 : 0;
  const typeScore: Record<ProactiveInsight["type"], number> = {
    deadline_approaching: 10,
    overload_warning: 9,
    forgotten_commitment: 8,
    opportunity_spotted: 7,
    pattern_detected: 6,
    goal_misalignment: 5,
    inconsistency_found: 4,
  };
  return urgencyScore + typeScore[insight.type];
}

export class ReasoningEngine {
  constructor(
    private readonly goalStore: GoalStoreLike,
    private readonly personalMemory: PersonalMemoryLike,
    private readonly operationalMemory: OperationalMemoryLike,
    private readonly logger: Logger,
  ) {}

  analyze(input: {
    userPrompt: string;
    operationalState: OperationalState;
    profile: PersonalOperationalProfile;
    recentMessages: string[];
    currentHour: number;
  }): ReasoningTrace {
    const goals = this.safeListGoals();
    const promptCategory = inferCategory(input.userPrompt);
    const realIntent = this.describeRealIntent(input.userPrompt, promptCategory);
    const relevantContext = this.resolveRelevantContext(input, goals);
    const proactiveInsights: ProactiveInsight[] = [];

    proactiveInsights.push(...this.detectDeadlineInsights(goals));
    proactiveInsights.push(...this.detectGoalMisalignment(input.userPrompt, promptCategory, goals));
    proactiveInsights.push(...this.detectPatternInsights(input.recentMessages));
    proactiveInsights.push(...this.detectForgottenCommitments(input.userPrompt));
    proactiveInsights.push(...this.detectOverload(input.operationalState, input.currentHour));
    proactiveInsights.push(...this.detectRevenueOpportunity(input.userPrompt, goals));

    const sortedInsights = proactiveInsights.sort((left, right) => insightPriority(right) - insightPriority(left));
    const energyHint = this.resolveEnergyHint(input.operationalState, input.currentHour);
    const suggestedResponseStyle = this.resolveResponseStyle(input, promptCategory, sortedInsights, energyHint);

    this.logger.debug("Reasoning trace built", {
      realIntent,
      category: promptCategory,
      insightCount: sortedInsights.length,
      style: suggestedResponseStyle,
      energyHint,
    });

    return {
      realIntent,
      relevantContext,
      proactiveInsights: sortedInsights,
      suggestedResponseStyle,
      energyHint,
      shouldOfferNextStep: sortedInsights.some((insight) => this.shouldSurfaceInsight(insight))
        || suggestedResponseStyle === "analytical",
    };
  }

  shouldSurfaceInsight(insight: ProactiveInsight): boolean {
    return insight.urgency === "medium" || insight.urgency === "high";
  }

  private safeListGoals(): ActiveGoal[] {
    try {
      return this.goalStore.list();
    } catch (error) {
      this.logger.warn("Failed to list goals for reasoning", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private describeRealIntent(prompt: string, category: PromptCategory): string {
    const normalized = normalizeText(prompt);
    if (prompt.trim().endsWith("?")) {
      return `Responder pedido de ${category}.`;
    }
    if (includesAny(normalized, EFFORT_KEYWORDS)) {
      return `Executar ou estruturar pedido de ${category}.`;
    }
    return `Entender e responder pedido de ${category}.`;
  }

  private resolveRelevantContext(
    input: {
      operationalState: OperationalState;
      profile: PersonalOperationalProfile;
    },
    goals: ActiveGoal[],
  ): string[] {
    const context: string[] = [];
    if (goals.length > 0) {
      context.push(`Objetivos ativos: ${goals.slice(0, 3).map(summarizeGoal).join("; ")}`);
    }
    if (input.operationalState.primaryRisk) {
      context.push(`Risco operacional atual: ${input.operationalState.primaryRisk}`);
    }
    if (input.operationalState.briefing?.overloadLevel) {
      context.push(`Carga do dia: ${input.operationalState.briefing.overloadLevel}`);
    }
    if (input.profile.responseStyle || input.profile.detailLevel) {
      context.push(`Estilo preferido: ${input.profile.responseStyle || input.profile.detailLevel}`);
    }
    try {
      const memorySummary = this.operationalMemory.getContextSummary?.();
      if (memorySummary) {
        context.push(`Memória operacional disponível: ${memorySummary.slice(0, 280)}`);
      }
    } catch {
      // Context is additive; memory summary failure must not block reasoning.
    }
    try {
      const profile = this.personalMemory.getProfile?.();
      if (profile?.primaryRole && profile.primaryRole !== input.profile.primaryRole) {
        context.push(`Papel observado na memória pessoal: ${profile.primaryRole}`);
      }
    } catch {
      // Same fail-soft rule as operational memory.
    }
    return context.slice(0, 5);
  }

  private detectDeadlineInsights(goals: ActiveGoal[]): ProactiveInsight[] {
    return goals.flatMap((goal) => {
      if (!goal.deadline || (goal.progress ?? 0) >= 0.5) {
        return [];
      }
      const remainingDays = daysUntil(goal.deadline);
      if (remainingDays == null || remainingDays < 0 || remainingDays > 7) {
        return [];
      }
      return [{
        type: "deadline_approaching" as const,
        urgency: "high" as const,
        domain: goal.domain,
        message: `O prazo de "${goal.title}" chega em ${remainingDays} dia${remainingDays === 1 ? "" : "s"} e está em ${Math.round((goal.progress ?? 0) * 100)}%.`,
      }];
    });
  }

  private detectGoalMisalignment(
    prompt: string,
    category: PromptCategory,
    goals: ActiveGoal[],
  ): ProactiveInsight[] {
    if (goals.length === 0 || category === "general") {
      return [];
    }
    const normalized = normalizeText(prompt);
    if (!includesAny(normalized, EFFORT_KEYWORDS)) {
      return [];
    }
    if (goals.some((goal) => goalMatchesCategory(goal, category))) {
      return [];
    }
    return [{
      type: "goal_misalignment",
      urgency: "medium",
      domain: category,
      message: `Esse pedido parece fora dos objetivos ativos; vale manter curto ou conectar a execução a uma prioridade real.`,
    }];
  }

  private detectPatternInsights(recentMessages: string[]): ProactiveInsight[] {
    const unresolved = recentMessages.filter((message) => !includesAny(normalizeText(message), RESOLUTION_KEYWORDS));
    const counts = new Map<PromptCategory, number>();
    for (const message of unresolved) {
      const category = inferCategory(message);
      if (category === "general") {
        continue;
      }
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }

    const repeated = [...counts.entries()].find(([, count]) => count >= 3);
    if (!repeated) {
      return [];
    }
    const [category] = repeated;
    return [{
      type: "pattern_detected",
      urgency: "medium",
      domain: category,
      message: `Você voltou ao tema "${category}" várias vezes sem fechamento; talvez seja melhor transformar isso em uma decisão ou próxima ação.`,
    }];
  }

  private detectForgottenCommitments(prompt: string): ProactiveInsight[] {
    let items: OperationalMemoryItem[] = [];
    try {
      items = this.operationalMemory.listItems?.({ includeDone: false, limit: 20 }) ?? [];
    } catch (error) {
      this.logger.debug("Failed to list operational memory commitments", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }

    const normalizedPrompt = normalizeText(prompt);
    const stale = items.find((item) =>
      (item.stage === "build" || item.stage === "launch")
      && isOlderThanDays(item.updatedAt || item.createdAt, 5)
      && !normalizedPrompt.includes(normalizeText(item.title).slice(0, 30)),
    );

    if (!stale) {
      return [];
    }

    return [{
      type: "forgotten_commitment",
      urgency: "medium",
      domain: stale.category,
      message: `Existe um compromisso em "${stale.title}" parado há mais de 5 dias no estágio ${stale.stage}.`,
    }];
  }

  private detectOverload(operationalState: OperationalState, currentHour: number): ProactiveInsight[] {
    const overloadLevel = operationalState.briefing?.overloadLevel
      ?? (operationalState as unknown as { overloadLevel?: string }).overloadLevel;
    if (overloadLevel !== "pesado" || currentHour >= 10) {
      return [];
    }
    return [{
      type: "overload_warning",
      urgency: "medium",
      domain: "ops",
      message: `O dia já está pesado antes das 10h; vale reduzir escopo e atacar só o essencial primeiro.`,
    }];
  }

  private detectRevenueOpportunity(prompt: string, goals: ActiveGoal[]): ProactiveInsight[] {
    const normalized = normalizeText(prompt);
    if (!includesAny(normalized, CUSTOMER_KEYWORDS)) {
      return [];
    }
    const revenueGoal = goals.find((goal) => goal.domain === "revenue" && (goal.progress ?? 0) < 0.3);
    if (!revenueGoal) {
      return [];
    }
    return [{
      type: "opportunity_spotted",
      urgency: "medium",
      domain: "revenue",
      message: `Esse contato/reunião pode ajudar o objetivo de receita "${revenueGoal.title}", que ainda está abaixo de 30%.`,
    }];
  }

  private resolveEnergyHint(operationalState: OperationalState, currentHour: number): ReasoningTrace["energyHint"] {
    const overloadLevel = operationalState.briefing?.overloadLevel
      ?? (operationalState as unknown as { overloadLevel?: string }).overloadLevel;
    if ((currentHour >= 1 && currentHour <= 6) || overloadLevel === "pesado") {
      return "low";
    }
    if (currentHour >= 8 && currentHour <= 12 && overloadLevel !== "moderado") {
      return "high";
    }
    return "medium";
  }

  private resolveResponseStyle(
    input: {
      userPrompt: string;
      operationalState: OperationalState;
      profile: PersonalOperationalProfile;
    },
    category: PromptCategory,
    insights: ProactiveInsight[],
    energyHint: ReasoningTrace["energyHint"],
  ): ReasoningTrace["suggestedResponseStyle"] {
    const normalized = normalizeText(input.userPrompt);
    const overloadLevel = input.operationalState.briefing?.overloadLevel
      ?? (input.operationalState as unknown as { overloadLevel?: string }).overloadLevel;
    if (overloadLevel === "pesado" || insights.some((insight) => insight.type === "overload_warning")) {
      return "supportive";
    }
    if (energyHint === "low" || input.profile.detailLevel === "resumo") {
      return "direct";
    }
    if (["analise", "analisa", "estrategia", "estratégia", "comparar", "diagnostico", "diagnóstico"].some((word) => normalized.includes(normalizeText(word)))) {
      return "analytical";
    }
    if (["revenue", "pricing", "ops", "technical"].includes(category)) {
      return "executive";
    }
    return "direct";
  }
}
