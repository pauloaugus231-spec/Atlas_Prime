import type {
  ApprovalReviewContract,
  InboxTriageContract,
  IntentAnalysisContract,
  MessageHistoryContract,
  OrganizationResponseContract,
  ResponseContractKind,
  ResponseQualityAssessment,
  ScheduleLookupContract,
  SupportQueueContract,
  TaskReviewContract,
} from "../types/response-contracts.js";

function compactBlankLines(lines: string[]): string[] {
  const compacted: string[] = [];
  for (const line of lines) {
    const previous = compacted[compacted.length - 1];
    if (line === "" && previous === "") {
      continue;
    }
    compacted.push(line.trimEnd());
  }
  return compacted;
}

function truncate(value: string, max = 96): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function labelActionMode(value: string): string {
  switch (value) {
    case "analyze":
      return "análise";
    case "plan":
      return "plano";
    case "execute":
      return "execução";
    case "communicate":
      return "comunicação";
    case "schedule":
      return "agenda";
    case "monitor":
      return "monitoramento";
    default:
      return value;
  }
}

export class ResponseOS {
  assess(kind: ResponseContractKind, text: string): ResponseQualityAssessment {
    const issues: string[] = [];
    const normalized = text.trim();
    if (!normalized) {
      issues.push("resposta_vazia");
    }
    if (normalized.includes("dominio principal detectado")) {
      issues.push("linguagem_interna_exposta");
    }
    if (kind !== "briefing" && normalized.length > 1800) {
      issues.push("resposta_longa_demais");
    }
    return {
      passed: issues.length === 0,
      issues,
    };
  }

  finalize(kind: ResponseContractKind, text: string): string {
    const normalized = compactBlankLines(text.replace(/\r\n/g, "\n").split("\n")).join("\n").trim();
    const assessment = this.assess(kind, normalized);
    if (assessment.issues.includes("linguagem_interna_exposta")) {
      return normalized.replace(/dominio principal detectado/gi, "sinais do pedido");
    }
    return normalized;
  }

  buildIntentAnalysisReply(input: IntentAnalysisContract): string {
    const lines = [
      "Leitura do pedido:",
      `- Objetivo inferido: ${truncate(input.objective, 120)}`,
      `- Domínio principal: ${input.primaryDomain}`,
      `- Domínios relacionados: ${input.mentionedDomains.join(", ") || input.primaryDomain}`,
      `- Modo recomendado: ${labelActionMode(input.actionMode)}`,
      `- Pedido composto: ${input.compound ? "sim" : "não"}`,
      `- Confiança: ${input.confidence.toFixed(2)}`,
    ];

    if (input.contextSignals.length > 0) {
      lines.push(
        `- Contexto útil disponível: ${input.contextSignals.slice(0, 4).join(" | ")}`,
      );
    }

    if (input.reasons.length > 0) {
      lines.push(`- Sinais usados: ${truncate(input.reasons.join(" | "), 180)}`);
    }

    if (input.recommendedNextStep) {
      lines.push(`- Próximo passo sugerido: ${truncate(input.recommendedNextStep, 140)}`);
    }

    return this.finalize("analysis", lines.join("\n"));
  }

  buildOrganizationReply(input: OrganizationResponseContract): string {
    const lines = [
      "Leitura operacional:",
      `- Objetivo: ${truncate(input.objective, 120)}`,
    ];

    if (input.currentSituation.length > 0) {
      lines.push("", "Situação agora:");
      for (const item of input.currentSituation.slice(0, 4)) {
        lines.push(`- ${truncate(item, 120)}`);
      }
    }

    if (input.priorities.length > 0) {
      lines.push("", "Prioridades:");
      for (const item of input.priorities.slice(0, 3)) {
        lines.push(`- ${truncate(item, 120)}`);
      }
    }

    if (input.actionPlan.length > 0) {
      lines.push("", "Plano curto:");
      for (const item of input.actionPlan.slice(0, 3)) {
        lines.push(`- ${truncate(item, 140)}`);
      }
    }

    if (input.recommendedNextStep) {
      lines.push("", `Próxima ação: ${truncate(input.recommendedNextStep, 140)}`);
    }

    return this.finalize("organization", lines.join("\n"));
  }

  buildSupportQueueReply(input: SupportQueueContract): string {
    const lines = [
      "Leitura operacional:",
      `- Objetivo: ${truncate(input.objective, 120)}`,
    ];

    if (input.currentSituation.length > 0) {
      lines.push("", "Situação agora:");
      for (const item of input.currentSituation.slice(0, 4)) {
        lines.push(`- ${truncate(item, 120)}`);
      }
    }

    if (input.channelSummary.length > 0) {
      lines.push("", "Fila por canal:");
      for (const item of input.channelSummary.slice(0, 4)) {
        lines.push(`- ${truncate(item, 120)}`);
      }
    }

    if (input.criticalCases.length > 0) {
      lines.push("", "Casos críticos:");
      for (const item of input.criticalCases.slice(0, 4)) {
        lines.push(`- [${item.channel}] ${truncate(item.label, 72)} | ${truncate(item.detail, 96)}`);
      }
    }

    if (input.pendingReplies.length > 0) {
      lines.push("", "Respostas pendentes:");
      for (const item of input.pendingReplies.slice(0, 4)) {
        lines.push(`- [${item.channel}] ${truncate(item.label, 72)} | ${truncate(item.detail, 96)}`);
      }
    }

    if (input.recurringThemes.length > 0) {
      lines.push("", "Temas recorrentes:");
      for (const item of input.recurringThemes.slice(0, 3)) {
        lines.push(`- ${truncate(item, 120)}`);
      }
    }

    if (input.recommendedNextStep) {
      lines.push("", `Próxima ação: ${truncate(input.recommendedNextStep, 140)}`);
    }

    return this.finalize("organization", lines.join("\n"));
  }

  buildApprovalReviewReply(input: ApprovalReviewContract): string {
    if (input.items.length === 0) {
      return this.finalize("analysis", `Não há aprovações pendentes em ${input.scopeLabel}.`);
    }

    const lines = [
      "Leitura operacional:",
      `- Objetivo: revisar aprovações pendentes em ${input.scopeLabel}`,
      "",
      "Situação agora:",
      `- ${input.items.length} aprovação(ões) pendente(s)`,
    ];

    const byAction = new Map<string, number>();
    for (const item of input.items) {
      byAction.set(item.actionKind, (byAction.get(item.actionKind) ?? 0) + 1);
    }
    if (byAction.size > 0) {
      lines.push(`- Tipos: ${[...byAction.entries()].map(([kind, count]) => `${kind}=${count}`).join(" | ")}`);
    }

    lines.push("", "Prioridades:");
    for (const item of input.items.slice(0, 4)) {
      lines.push(`- ${truncate(item.subject, 120)}${typeof item.id === "number" ? ` | #${item.id}` : ""}${item.createdAt ? ` | ${item.createdAt}` : ""}`);
    }

    lines.push("", "Plano curto:");
    lines.push("- revisar primeiro o item mais antigo ou o que destrava uma ação hoje");
    lines.push("- aprovar, ajustar ou descartar sem abrir novas pendências");

    if (input.recommendedNextStep) {
      lines.push("", `Próxima ação: ${truncate(input.recommendedNextStep, 140)}`);
    }

    return this.finalize("organization", lines.join("\n"));
  }

  buildInboxTriageReply(input: InboxTriageContract): string {
    if (input.items.length === 0) {
      return this.finalize(
        "analysis",
        input.unreadOnly
          ? `Triagem concluída. Não encontrei emails não lidos em ${input.scopeLabel}.`
          : `Triagem concluída. Não encontrei emails relevantes em ${input.scopeLabel}.`,
      );
    }

    const counts = {
      alta: input.items.filter((item) => item.priority === "alta").length,
      media: input.items.filter((item) => item.priority === "media").length,
      baixa: input.items.filter((item) => item.priority === "baixa").length,
    };

    const lines = [
      "Leitura operacional:",
      `- Objetivo: triar o inbox de ${input.scopeLabel}`,
      "",
      "Situação agora:",
      `- ${input.items.length} email(s) priorizado(s) dentro do limite ${input.limit}`,
      `- Alta: ${counts.alta} | Média: ${counts.media} | Baixa: ${counts.baixa}`,
      "",
      "Prioridades:",
    ];

    for (const item of input.items.slice(0, 4)) {
      lines.push(`- ${truncate(item.subject, 120)} | ${item.priority.toUpperCase()} | ${item.category} | ${item.relationship}`);
    }

    lines.push("", "Plano curto:");
    for (const item of input.items.slice(0, 3)) {
      lines.push(`- UID ${item.uid}: ${truncate(item.action, 140)}`);
    }

    if (input.recommendedNextStep) {
      lines.push("", `Próxima ação: ${truncate(input.recommendedNextStep, 140)}`);
    }

    return this.finalize("analysis", lines.join("\n"));
  }

  buildScheduleLookupReply(input: ScheduleLookupContract): string {
    if (input.events.length === 0) {
      const lines = [
        "Leitura operacional:",
        `- Objetivo: verificar agenda em ${input.targetLabel}${input.topicLabel ? ` sobre ${input.topicLabel}` : ""}`,
        "",
        "Situação agora:",
        "- nenhum evento encontrado nas contas consultadas",
      ];
      if (typeof input.emailFallbackCount === "number" && input.emailFallbackCount > 0) {
        lines.push(`- ${input.emailFallbackCount} email(s) relacionado(s) foram encontrados como fallback`);
      }
      if (input.recommendedNextStep) {
        lines.push("", `Próxima ação: ${truncate(input.recommendedNextStep, 140)}`);
      }
      return this.finalize("analysis", lines.join("\n"));
    }

    const lines = [
      "Leitura operacional:",
      `- Objetivo: verificar agenda em ${input.targetLabel}${input.topicLabel ? ` sobre ${input.topicLabel}` : ""}`,
      "",
      "Situação agora:",
      `- ${input.events.length} evento(s) encontrado(s)`,
      "",
      "Prioridades:",
    ];
    for (const item of input.events.slice(0, 4)) {
      lines.push(`- ${truncate(item.summary, 120)}${item.start ? ` | ${item.start}` : ""}${item.location ? ` | ${truncate(item.location, 80)}` : ""} | ${item.account}`);
    }
    if (input.recommendedNextStep) {
      lines.push("", `Próxima ação: ${truncate(input.recommendedNextStep, 140)}`);
    }
    return this.finalize("analysis", lines.join("\n"));
  }

  buildTaskReviewReply(input: TaskReviewContract): string {
    if (input.items.length === 0) {
      return this.finalize("analysis", `Não encontrei tarefas abertas em ${input.scopeLabel}.`);
    }

    const lines = [
      "Leitura operacional:",
      `- Objetivo: revisar tarefas em ${input.scopeLabel}`,
      "",
      "Situação agora:",
      `- ${input.items.length} tarefa(s) aberta(s)`,
      "",
      "Prioridades:",
    ];
    for (const item of input.items.slice(0, 6)) {
      lines.push(`- ${truncate(item.title, 120)} | ${item.taskListTitle} | ${item.account} | ${item.status} | ${item.dueLabel}`);
    }
    if (input.recommendedNextStep) {
      lines.push("", `Próxima ação: ${truncate(input.recommendedNextStep, 140)}`);
    }
    return this.finalize("analysis", lines.join("\n"));
  }

  buildMessageHistoryReply(input: MessageHistoryContract): string {
    if (input.items.length === 0) {
      return this.finalize("analysis", `Não encontrei histórico recente em ${input.scopeLabel}.`);
    }

    const lines = [
      "Leitura operacional:",
      `- Objetivo: revisar histórico recente em ${input.scopeLabel}`,
      "",
      "Situação agora:",
      `- ${input.items.length} mensagem(ns) recente(s) encontrada(s)`,
      "",
      "Contexto útil:",
    ];
    for (const item of input.items.slice(0, 6)) {
      lines.push(`- ${item.direction} | ${item.when} | ${truncate(item.who, 48)} | ${truncate(item.text, 120)}`);
    }
    if (input.recommendedNextStep) {
      lines.push("", `Próxima ação: ${truncate(input.recommendedNextStep, 140)}`);
    }
    return this.finalize("analysis", lines.join("\n"));
  }
}
