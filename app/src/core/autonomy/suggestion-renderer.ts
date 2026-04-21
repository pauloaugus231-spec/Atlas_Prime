import type { AutonomyObservation, AutonomySuggestion } from "../../types/autonomy.js";

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
}
