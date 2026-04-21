import type { AutonomyObservation, AutonomySuggestion } from "../../types/autonomy.js";
import type { CommitmentCandidate } from "../../types/commitments.js";
import type { MemoryCandidate } from "../../types/memory-candidates.js";

export interface RenderableSuggestion {
  suggestion: AutonomySuggestion;
  observation?: AutonomyObservation;
}

function truncate(value: string | undefined, max = 112): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function priorityLabel(priority: number): string {
  if (priority >= 0.8) {
    return "Alta";
  }
  if (priority >= 0.55) {
    return "Média";
  }
  return "Baixa";
}

function formatSuggestionLine(item: RenderableSuggestion, index: number): string[] {
  const lines = [
    `${index + 1}. [${priorityLabel(item.suggestion.priority)}] ${truncate(item.suggestion.title, 78)}`,
    `   ${truncate(item.suggestion.body, 104)}`,
  ];

  if (item.suggestion.requiresApproval) {
    lines.push("   Exige aprovação antes de executar.");
  }

  return lines;
}

function formatEvidenceLines(evidence: string[]): string[] {
  return evidence
    .map((item) => truncate(item, 108))
    .filter(Boolean)
    .slice(0, 3)
    .map((item) => `- ${item}`);
}

function formatSnoozeLabel(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function formatDateTime(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function formatDateOnly(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
  }).format(parsed);
}

function formatCommitmentStatus(status: CommitmentCandidate["status"]): string {
  switch (status) {
    case "confirmed":
      return "confirmado";
    case "snoozed":
      return "adiado";
    case "done":
      return "feito";
    case "converted_to_task":
      return "virou tarefa";
    case "dismissed":
      return "descartado";
    case "candidate":
    default:
      return "pendente";
  }
}

function formatMemoryCandidateKind(kind: MemoryCandidate["kind"]): string {
  switch (kind) {
    case "preference":
      return "preferência";
    case "routine":
      return "rotina";
    case "rule":
      return "regra";
    case "goal":
      return "objetivo";
    case "commitment":
      return "compromisso";
    case "contact":
      return "contato";
    case "project":
      return "projeto";
    case "style":
      return "estilo";
    case "constraint":
      return "restrição";
    default:
      return "contexto";
  }
}

export class SuggestionRenderer {
  renderQueue(items: RenderableSuggestion[]): string {
    if (items.length === 0) {
      return "Não encontrei nada relevante para revisão agora.";
    }

    return [
      `Separei ${items.length} ponto(s) para revisão agora:`,
      ...items.flatMap((item, index) => formatSuggestionLine(item, index)),
      "",
      "Se quiser, responde de forma natural. Exemplos:",
      "- por que a 1?",
      "- aprova a 2",
      "- ignora a 3",
      "- adia a 1 para amanhã às 9h",
    ].join("\n");
  }

  renderExplanation(item: RenderableSuggestion, ordinal?: number): string {
    const prefix = typeof ordinal === "number"
      ? `Separei a ${ordinal + 1} por este motivo:`
      : "Separei isso por este motivo:";

    const evidence = formatEvidenceLines(item.observation?.evidence ?? []);

    return [
      prefix,
      `- ${truncate(item.suggestion.explanation, 110)}`,
      ...(evidence.length > 0
        ? [
            "",
            "Evidência considerada:",
            ...evidence,
          ]
        : []),
    ].join("\n");
  }

  renderApproved(item: RenderableSuggestion, ordinal?: number): string {
    const label = typeof ordinal === "number" ? `a ${ordinal + 1}` : "essa sugestão";
    return `Marquei ${label} como aprovada: ${truncate(item.suggestion.title, 88)}. Vou tratar isso como direção confirmada daqui para frente.`;
  }

  renderDismissed(item: RenderableSuggestion, ordinal?: number): string {
    const label = typeof ordinal === "number" ? `a ${ordinal + 1}` : "essa sugestão";
    return `Ignorei ${label}: ${truncate(item.suggestion.title, 88)}. Ela sai da fila ativa.`;
  }

  renderSnoozed(item: RenderableSuggestion, snoozedUntil: string, ordinal?: number): string {
    const label = typeof ordinal === "number" ? `a ${ordinal + 1}` : "essa sugestão";
    return `Adiei ${label} até ${formatSnoozeLabel(snoozedUntil)}: ${truncate(item.suggestion.title, 88)}.`;
  }

  renderStalledItems(items: RenderableSuggestion[]): string {
    if (items.length === 0) {
      return "Hoje eu não vejo nada claramente parado ou sem avanço que mereça tua atenção agora.";
    }

    return [
      `Encontrei ${items.length} ponto(s) com pouco avanço ou risco claro:`,
      ...items.flatMap((item, index) => formatSuggestionLine(item, index)),
      "",
      "Se quiser, eu sigo daqui em linguagem normal. Exemplos:",
      "- por que a 1?",
      "- aprova a 1",
      "- adia a 2 para amanhã às 9h",
    ].join("\n");
  }

  renderCommitments(items: CommitmentCandidate[]): string {
    if (items.length === 0) {
      return "Hoje eu não tenho compromisso detectado teu pendente por aqui.";
    }

    return [
      `Encontrei ${items.length} compromisso(s) teu(s) ainda em aberto ou acompanhamento:`,
      ...items.slice(0, 6).map((item, index) => {
        const dueLabel = formatDateTime(item.dueAt) ?? formatDateOnly(item.dueAt);
        const snoozeLabel = formatDateTime(item.snoozedUntil);
        const details = [
          formatCommitmentStatus(item.status),
          dueLabel ? `prazo ${dueLabel}` : undefined,
          snoozeLabel && item.status === "snoozed" ? `retoma em ${snoozeLabel}` : undefined,
        ].filter(Boolean).join(" | ");
        return `${index + 1}. ${truncate(item.normalizedAction, 92)}${details ? ` — ${details}` : ""}`;
      }),
      "",
      "Se quiser, eu também posso cruzar isso com a fila de revisão e te dizer o que vale resolver primeiro.",
    ].join("\n");
  }

  renderMemoryCandidates(items: MemoryCandidate[]): string {
    if (items.length === 0) {
      return "No momento eu não tenho nenhum aprendizado novo em revisão sobre ti.";
    }

    return [
      `Tenho ${items.length} ponto(s) ainda em observação antes de consolidar como aprendizado:`,
      ...items.slice(0, 5).map((item, index) => {
        const lastSeen = formatDateTime(item.lastSeenAt) ?? formatDateOnly(item.lastSeenAt);
        return `${index + 1}. ${truncate(item.statement, 96)} — ${formatMemoryCandidateKind(item.kind)}${lastSeen ? ` | visto por último em ${lastSeen}` : ""}`;
      }),
      "",
      "Se algum deles estiver certo, eu posso passar a usar isso com mais confiança. Se não estiver, eu descarto.",
    ].join("\n");
  }
}
