export type MonitoredAlertTurnBehavior = "continue" | "interrupt" | "unclear";

function normalizeTelegramIntent(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(normalized: string, terms: string[]): boolean {
  return terms.some((term) => normalized.includes(term));
}

const CONTINUATION_PATTERNS = [
  /^(?:sim|ok|pode seguir|segue|segue nisso)$/,
  /^(?:agenda|cria tarefa|cria task|responda|resposta|resumo|registrar|registre|ignora|ignora isso)$/,
  /^(?:so registra|só registra|apenas registra)$/,
  /^(?:cria o evento|crie o evento)$/,
  /^(?:transforma isso em tarefa|transforme isso em tarefa)$/,
  /^(?:rascunho de resposta)$/,
];

function isMonitoredAlertContinuationReply(normalized: string): boolean {
  return CONTINUATION_PATTERNS.some((pattern) => pattern.test(normalized));
}

function looksLikeQuestionOrNewCommand(normalized: string, original: string): boolean {
  if (original.includes("?")) {
    return true;
  }

  if (/^(?:qual|quais|como|onde|quando)\b/.test(normalized)) {
    return true;
  }

  if (/^(?:me mostre|mostre|liste|listar|organize|planeje|planeja|gere|gera|quero|preciso|salve|salva|guarde|guarda|veja|busque|procure|me de|me dê)\b/.test(normalized)) {
    return true;
  }

  if (hasAny(normalized, [
    "clima",
    "previsao do tempo",
    "previsão do tempo",
    "briefing da manha",
    "briefing da manhã",
    "brief diario",
    "brief diário",
    "organize meu dia",
    "planeje meu dia",
    "minha agenda",
    "meu calendario",
    "meu calendário",
    "me mostra minhas tarefas",
    "liste minhas tarefas",
    "minhas tarefas",
    "memoria pessoal",
    "memória pessoal",
  ])) {
    return true;
  }

  const tokenCount = normalized.split(" ").filter(Boolean).length;
  return tokenCount >= 4;
}

export function resolveMonitoredAlertTurnBehavior(text: string): MonitoredAlertTurnBehavior {
  const normalized = normalizeTelegramIntent(text);
  if (!normalized) {
    return "unclear";
  }

  if (isMonitoredAlertContinuationReply(normalized)) {
    return "continue";
  }

  if (looksLikeQuestionOrNewCommand(normalized, text)) {
    return "interrupt";
  }

  return "unclear";
}
