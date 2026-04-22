import type { AgentRunResult } from "./agent-core.js";
import type { ConversationMessage } from "../types/llm.js";
import type { Logger } from "../types/logger.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type { UserPreferences } from "../types/user-preferences.js";
import { FinanceParser } from "./finance/finance-parser.js";
import type { FinanceEntry } from "../types/finance-entry.js";
import type { RelationshipProfile } from "../types/relationship-profile.js";
import { normalizeEmailAnalysisText } from "../integrations/email/email-analysis.js";

interface TimeOsLike {
  renderOverview(): Promise<string>;
}

interface FinanceStoreLike {
  createEntry(input: {
    title: string;
    amount: number;
    kind?: FinanceEntry["kind"];
    status?: FinanceEntry["status"];
    category?: string;
    dueAt?: string;
    sourceKind?: FinanceEntry["sourceKind"];
    notes?: string;
  }): FinanceEntry;
}

interface FinanceReviewLike {
  renderOverview(now?: Date): string;
}

interface RelationshipsLike {
  renderFollowUpList(): string;
  renderProfile(query: string): string | undefined;
  saveManual(input: { displayName: string; kind?: RelationshipProfile["kind"]; notes?: string[]; nextFollowUpAt?: string }): RelationshipProfile;
}

export interface LifeManagementDirectServiceDependencies {
  logger: Logger;
  timeOs: TimeOsLike;
  financeStore: FinanceStoreLike;
  financeReview: FinanceReviewLike;
  relationships: RelationshipsLike;
  buildBaseMessages: (
    userPrompt: string,
    orchestration: OrchestrationContext,
    preferences?: UserPreferences,
  ) => ConversationMessage[];
}

export interface LifeManagementDirectInput {
  userPrompt: string;
  requestId: string;
  orchestration: OrchestrationContext;
  preferences?: UserPreferences;
}

function includesAny(value: string, tokens: string[]): boolean {
  return tokens.some((token) => value.includes(token));
}

function extractRelationshipName(prompt: string): string | undefined {
  const quoted = prompt.match(/["“](.+?)["”]/);
  if (quoted?.[1]?.trim()) {
    return quoted[1].trim();
  }
  const match = prompt.match(/(?:sobre|para|com|do|da)\s+([A-ZÀ-Ý][\p{L}\s]{1,40})/u);
  return match?.[1]?.trim();
}

export class LifeManagementDirectService {
  private readonly financeParser = new FinanceParser();

  constructor(private readonly deps: LifeManagementDirectServiceDependencies) {}

  async tryRun(input: LifeManagementDirectInput): Promise<AgentRunResult | null> {
    const normalized = normalizeEmailAnalysisText(input.userPrompt);

    if (includesAny(normalized, ["meu tempo hoje", "minha agenda hoje", "meu dia hoje", "agenda e tarefas", "tempo e agenda"])) {
      const reply = await this.deps.timeOs.renderOverview();
      return {
        requestId: input.requestId,
        reply,
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    if (includesAny(normalized, ["minhas financas", "minhas finanças", "como estao minhas contas", "como estão minhas contas", "meu caixa", "minhas contas"])) {
      return {
        requestId: input.requestId,
        reply: this.deps.financeReview.renderOverview(),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    if (includesAny(normalized, ["registre despesa", "registre gasto", "anote despesa", "anote gasto", "registre conta", "anote conta", "recebi", "ganhei", "entrada de"])) {
      const parsed = this.financeParser.parseEntry(input.userPrompt);
      if (!parsed) {
        return {
          requestId: input.requestId,
          reply: "Para registrar isso nas finanças, eu preciso ao menos do valor e do tipo básico do lançamento.",
          messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
          toolExecutions: [],
        };
      }
      const entry = this.deps.financeStore.createEntry(parsed);
      return {
        requestId: input.requestId,
        reply: `Lançamento financeiro salvo: ${entry.title} | R$ ${entry.amount.toFixed(2)} | ${entry.kind}.`,
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    if (includesAny(normalized, ["quem precisa de follow-up", "quem precisa de retorno", "relacionamentos pedindo atencao", "relacionamentos pedindo atenção"])) {
      return {
        requestId: input.requestId,
        reply: this.deps.relationships.renderFollowUpList(),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    if (includesAny(normalized, ["o que eu prometi para", "contato ", "cliente ", "perfil de relacionamento"])) {
      const name = extractRelationshipName(input.userPrompt);
      if (!name) {
        return null;
      }
      const reply = this.deps.relationships.renderProfile(name);
      if (!reply) {
        return {
          requestId: input.requestId,
          reply: "Ainda não encontrei esse relacionamento na base atual.",
          messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
          toolExecutions: [],
        };
      }
      return {
        requestId: input.requestId,
        reply,
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    if (includesAny(normalized, ["salve como cliente", "salve como contato", "cadastre como cliente", "cadastre contato"])) {
      const name = extractRelationshipName(input.userPrompt);
      if (!name) {
        return null;
      }
      const profile = this.deps.relationships.saveManual({
        displayName: name,
        kind: includesAny(normalized, ["cliente"]) ? "client" : "unknown",
      });
      return {
        requestId: input.requestId,
        reply: `Relacionamento salvo: ${profile.displayName} | ${profile.kind}.`,
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    return null;
  }
}
