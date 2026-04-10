import type { ConversationMessage, LlmClient } from "../types/llm.js";
import type { Logger } from "../types/logger.js";
import type { ClarificationInboxItemRecord } from "../types/clarification.js";
import { IntentRouter, type IntentResolution } from "./intent-router.js";
import { ClarificationInboxStore } from "./clarification-inbox.js";
import {
  buildClarificationRuleProposal,
  buildClarifiedExecutionPrompt,
} from "./clarification-rules.js";
import {
  buildEventDraftFromPrompt,
  buildTaskDraftFromPrompt,
  isGoogleEventCreatePrompt,
  isGoogleTaskCreatePrompt,
} from "./google-draft-utils.js";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function stripCodeFences(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

interface ClarificationProposal {
  objectiveSummary: string;
  rationale: string;
  questions: string[];
}

interface ClarificationLlmResponse {
  needsClarification?: boolean;
  objectiveSummary?: string;
  rationale?: string;
  questions?: string[];
}

export class ClarificationEngine {
  constructor(
    private readonly store: ClarificationInboxStore,
    private readonly client: LlmClient,
    private readonly logger: Logger,
    private readonly defaultTimezone: string,
    private readonly intentRouter: IntentRouter,
  ) {}

  getLatestPending(chatId: number): ClarificationInboxItemRecord | null {
    return this.store.getLatestPending(chatId);
  }

  cancel(id: number): ClarificationInboxItemRecord | null {
    return this.store.updateStatus(id, "cancelled");
  }

  confirm(id: number): ClarificationInboxItemRecord | null {
    return this.store.updateStatus(id, "confirmed");
  }

  async maybeRequest(input: {
    chatId: number;
    channel: string;
    prompt: string;
    intent: IntentResolution;
  }): Promise<ClarificationInboxItemRecord | null> {
    if (isGoogleEventCreatePrompt(input.prompt)) {
      const draftResult = buildEventDraftFromPrompt(input.prompt, this.defaultTimezone);
      if (draftResult.draft) {
        return null;
      }
    }

    if (isGoogleTaskCreatePrompt(input.prompt)) {
      const draftResult = buildTaskDraftFromPrompt(input.prompt, this.defaultTimezone);
      if (draftResult.draft) {
        return null;
      }
    }

    const heuristic = this.buildHeuristicProposal(input.prompt, input.intent);
    const llmProposal = heuristic
      ? null
      : await this.buildLlmProposal(input.prompt, input.intent).catch((error) => {
          this.logger.warn("Clarification LLM proposal failed; continuing without clarification", {
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        });

    const proposal = heuristic ?? llmProposal;
    if (!proposal || proposal.questions.length === 0) {
      return null;
    }

    return this.store.createPending({
      chatId: input.chatId,
      channel: input.channel,
      originalPrompt: input.prompt,
      objectiveSummary: proposal.objectiveSummary,
      rationale: proposal.rationale,
      questionsJson: JSON.stringify(proposal.questions.slice(0, 3)),
    });
  }

  async answer(
    item: ClarificationInboxItemRecord,
    answerText: string,
  ): Promise<ClarificationInboxItemRecord> {
    const confirmationText = await this.buildConfirmationText(item, answerText);
    const executionPrompt = this.buildExecutionPrompt(item, answerText);
    const updated = this.store.updateForConfirmation(
      item.id,
      answerText.trim(),
      confirmationText,
      executionPrompt,
    );
    if (!updated) {
      throw new Error(`Clarification state unavailable after confirmation transition: id=${item.id}`);
    }
    return updated;
  }

  buildQuestionMessage(item: ClarificationInboxItemRecord): string {
    const questions = this.parseQuestions(item.questionsJson);
    const lines = [
      "Antes de executar, preciso fechar estes pontos:",
      ...questions.map((question, index) => `${index + 1}. ${question}`),
      "",
      "Responda em uma mensagem só. Depois eu te mostro meu entendimento e peço sua confirmação.",
    ];
    return lines.join("\n");
  }

  buildConfirmationMessage(item: ClarificationInboxItemRecord): string {
    const confirmationText = item.confirmationText?.trim() || "Entendi o contexto adicional.";
    return [
      confirmationText,
      "",
      "Se estiver certo, responda `sim`.",
      "Se precisar corrigir algo, responda com o ajuste em uma frase.",
    ].join("\n");
  }

  private buildHeuristicProposal(prompt: string, intent: IntentResolution): ClarificationProposal | null {
    const normalized = normalize(prompt);
    if (isGoogleEventCreatePrompt(prompt)) {
      const draftResult = buildEventDraftFromPrompt(prompt, this.defaultTimezone);
      if (draftResult.draft) {
        return null;
      }
      if (draftResult.reason?.includes("data")) {
        return {
          objectiveSummary: "Fechar a data do evento antes de montar o rascunho.",
          rationale: "O pedido de agenda já tem estrutura suficiente, mas ainda falta a data.",
          questions: ["Qual é a data do evento?"],
        };
      }
      if (draftResult.reason?.includes("horário")) {
        return {
          objectiveSummary: "Fechar o horário do evento antes de montar o rascunho.",
          rationale: "O pedido de agenda já tem estrutura suficiente, mas ainda falta o horário.",
          questions: ["Qual é o horário do evento? Se quiser, pode dizer também a duração."],
        };
      }
      if (draftResult.reason?.includes("título")) {
        return {
          objectiveSummary: "Fechar o título do evento antes de montar o rascunho.",
          rationale: "O pedido de agenda já tem data e formato, mas ainda falta um título claro.",
          questions: ["Qual deve ser o título do evento?"],
        };
      }
    }

    if (isGoogleTaskCreatePrompt(prompt)) {
      const draftResult = buildTaskDraftFromPrompt(prompt, this.defaultTimezone);
      if (draftResult.draft) {
        return null;
      }
      return {
        objectiveSummary: "Fechar os dados mínimos da tarefa antes de montar o rascunho.",
        rationale: "O pedido de tarefa ainda não tem informação suficiente para criar um rascunho útil.",
        questions: ["Qual é o título da tarefa? Se já souber, diga também o prazo."],
      };
    }

    const ruleBased = buildClarificationRuleProposal(prompt, intent);
    if (ruleBased) {
      return ruleBased;
    }

    const hasAgenda = ["agenda", "calendario", "calendário", "compromisso", "compromissos"].some((token) => normalized.includes(token));
    const hasApprovals = ["aprovacao", "aprovação", "aprovacoes", "aprovações", "approval"].some((token) => normalized.includes(token));
    const hasTimeScope = ["hoje", "amanha", "amanhã", "semana", "mes", "mês", "dia"].some((token) => normalized.includes(token));
    const hasReviewVerb = ["revis", "organ", "prioriz", "alinhar", "arrumar"].some((token) => normalized.includes(token));

    if (hasAgenda && hasApprovals) {
      const questions = [
        hasTimeScope
          ? undefined
          : "Você quer organizar a agenda de hoje ou da semana?",
        "Nas aprovações, você quer só revisar as pendentes ou já quer que eu priorize as que precisam de ação hoje?",
      ].filter((value): value is string => Boolean(value));

      if (questions.length > 0) {
        return {
          objectiveSummary: "Revisar aprovações e reorganizar a rotina operacional.",
          rationale: "O pedido combina agenda e aprovações, mas ainda falta fechar escopo e nível de ação.",
          questions,
        };
      }
    }

    if (intent.compoundIntent && intent.orchestration.route.primaryDomain === "secretario_operacional" && hasReviewVerb && !hasTimeScope) {
      return {
        objectiveSummary: "Organizar a operação pessoal com base no pedido atual.",
        rationale: "O pedido é composto e ainda não define janela temporal suficiente para execução.",
        questions: ["Você quer que eu organize isso olhando o dia de hoje ou a semana inteira?"],
      };
    }

    if (prompt.trim().length < 18 && intent.orchestration.route.actionMode !== "analyze") {
      return {
        objectiveSummary: "Esclarecer o objetivo operacional do usuário.",
        rationale: "O pedido ainda está curto demais para executar com segurança.",
        questions: ["Qual é o resultado exato que você quer que eu entregue agora?"],
      };
    }

    return null;
  }

  private async buildLlmProposal(prompt: string, intent: IntentResolution): Promise<ClarificationProposal | null> {
    const shouldProbe = intent.compoundIntent
      || intent.orchestration.route.confidence < 0.72
      || ["plan", "schedule", "communicate", "execute"].includes(intent.orchestration.route.actionMode);
    if (!shouldProbe) {
      return null;
    }

    const messages: ConversationMessage[] = [
      {
        role: "system",
        content: [
          "Você avalia se falta contexto crítico antes do Atlas executar uma solicitação.",
          "Responda apenas JSON válido.",
          "JSON esperado: needsClarification (boolean), objectiveSummary (string), rationale (string), questions (array de 1 a 3 strings).",
          "Pergunte só o que realmente muda a execução.",
          "Se o pedido já estiver suficientemente claro, retorne needsClarification=false.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          `Pedido: ${prompt}`,
          `Domínio principal: ${intent.orchestration.route.primaryDomain}`,
          `Modo de ação: ${intent.orchestration.route.actionMode}`,
          `Pedido composto: ${intent.compoundIntent ? "sim" : "não"}`,
        ].join("\n"),
      },
    ];

    const response = await this.client.chat({ messages });
    const parsed = JSON.parse(stripCodeFences(response.message.content ?? "")) as ClarificationLlmResponse;
    if (!parsed.needsClarification || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
      return null;
    }

    const questions = parsed.questions
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
      .slice(0, 3);
    if (!questions.length) {
      return null;
    }

    return {
      objectiveSummary: parsed.objectiveSummary?.trim() || "Fechar contexto operacional antes de executar.",
      rationale: parsed.rationale?.trim() || "Ainda faltam definições para executar com segurança.",
      questions,
    };
  }

  private async buildConfirmationText(
    item: ClarificationInboxItemRecord,
    answerText: string,
  ): Promise<string> {
    try {
      const response = await this.client.chat({
        messages: [
          {
            role: "system",
            content: [
              "Você transforma um pedido original e um contexto confirmado pelo usuário em um espelho operacional curto.",
              "Responda somente JSON válido com o campo summary.",
              "O summary deve começar com 'Entendi assim:' e ter no máximo 2 frases.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Pedido original: ${item.originalPrompt}`,
              `Objetivo resumido: ${item.objectiveSummary}`,
              `Contexto confirmado pelo usuário: ${answerText}`,
            ].join("\n"),
          },
        ],
      });
      const parsed = JSON.parse(stripCodeFences(response.message.content ?? "")) as { summary?: string };
      if (parsed.summary?.trim()) {
        return parsed.summary.trim();
      }
    } catch (error) {
      this.logger.warn("Clarification confirmation text fell back to template", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return `Entendi assim: ${item.objectiveSummary} Contexto confirmado: ${answerText.trim()}.`;
  }

  private buildExecutionPrompt(item: ClarificationInboxItemRecord, answerText: string): string {
    if (isGoogleEventCreatePrompt(item.originalPrompt) || isGoogleTaskCreatePrompt(item.originalPrompt)) {
      return [
        item.originalPrompt.trim(),
        answerText.trim(),
      ].filter(Boolean).join(" ");
    }

    const intent = this.intentRouter.resolve(item.originalPrompt);
    const clarifiedPrompt = buildClarifiedExecutionPrompt(item.originalPrompt, answerText, intent);
    if (clarifiedPrompt) {
      return clarifiedPrompt;
    }

    return [
      `Pedido original do usuário: ${item.originalPrompt}`,
      `Objetivo resumido: ${item.objectiveSummary}`,
      `Contexto confirmado pelo usuário: ${answerText.trim()}`,
      "Agora execute o pedido considerando esse contexto confirmado. Se ainda faltar algo crítico, diga explicitamente o que falta.",
    ].join("\n");
  }

  private parseQuestions(value: string): string[] {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean);
    } catch {
      return [];
    }
  }
}
