import type {
  PendingGoogleEventDraft,
  PendingGoogleTaskDraft,
} from "./google-draft-utils.js";

export type MonitoredMessageClassification =
  | "ignore"
  | "informational"
  | "attention"
  | "action_needed"
  | "possible_event"
  | "possible_task"
  | "possible_reply";

export type MonitoredAlertSuggestedAction =
  | "event"
  | "task"
  | "reply"
  | "summary"
  | "register";

export interface MonitoredWhatsAppReplyDraft {
  kind: "whatsapp_reply";
  instanceName?: string;
  account?: string;
  remoteJid: string;
  number: string;
  pushName?: string;
  inboundText: string;
  replyText: string;
  relationship?: string;
  persona?: string;
}

export interface PendingMonitoredChannelAlertDraft {
  kind: "monitored_channel_alert";
  operatorId: string;
  sourceProvider: "whatsapp";
  sourceChannelId: string;
  sourceDisplayName: string;
  sourceInstanceName?: string;
  sourceAccount?: string;
  sourceRemoteJid: string;
  sourceNumber: string;
  sourcePushName?: string;
  sourceText: string;
  classification: MonitoredMessageClassification;
  summary: string;
  reasons: string[];
  suggestedAction: MonitoredAlertSuggestedAction;
  eventDraft?: PendingGoogleEventDraft;
  taskDraft?: PendingGoogleTaskDraft;
  replyDraft?: MonitoredWhatsAppReplyDraft;
  createdAt: string;
}

export interface MonitoredMessageClassificationResult {
  classification: MonitoredMessageClassification;
  shouldAlert: boolean;
  suggestedAction: MonitoredAlertSuggestedAction;
  summary: string;
  reasons: string[];
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value: string, max = 120): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function hasAny(normalized: string, terms: string[]): boolean {
  return terms.some((term) => normalized.includes(term));
}

function looksLikeTimeCue(normalized: string): boolean {
  return /\b\d{1,2}(?::\d{2})?\s*h\b/.test(normalized)
    || /\b\d{1,2}:\d{2}\b/.test(normalized)
    || /\bas\s+\d{1,2}(?::\d{2})?\b/.test(normalized)
    || /\bamanha\b/.test(normalized)
    || /\bhoje\b/.test(normalized)
    || /\bsegunda|terca|quarta|quinta|sexta|sabado|domingo\b/.test(normalized);
}

function looksLikeQuestion(normalized: string, original: string): boolean {
  return original.includes("?")
    || hasAny(normalized, [
      "pode ",
      "consegue ",
      "me confirma",
      "me retorna",
      "me responde",
      "me avisa",
      "vai conseguir",
      "voce consegue",
    ]);
}

export function classifyMonitoredWhatsAppMessage(input: {
  text: string;
  operatorName?: string;
}): MonitoredMessageClassificationResult {
  const text = input.text.trim();
  const normalized = normalizeText(text);
  const reasons: string[] = [];
  const operatorName = normalizeText(input.operatorName ?? "");

  if (!normalized || /^(ok|blz|beleza|bom dia|boa tarde|boa noite|obrigad[oa]|valeu|👍|🙏|❤️|kkk+)$/.test(normalized)) {
    return {
      classification: "ignore",
      shouldAlert: false,
      suggestedAction: "register",
      summary: truncate(text || "Mensagem curta sem ação."),
      reasons: ["mensagem curta sem sinal operacional"],
    };
  }

  const operatorMentioned = operatorName.length >= 3 && normalized.includes(operatorName);
  if (operatorMentioned) {
    reasons.push("menção direta ao operador");
  }

  const eventSignals = hasAny(normalized, [
    "reuniao",
    "encontro",
    "agenda",
    "comparecer",
    "horario",
    "horário",
    "caps",
    "creas",
    "cras",
  ]) && looksLikeTimeCue(normalized);

  const taskSignals = hasAny(normalized, [
    "entregar",
    "enviar",
    "fazer",
    "providenciar",
    "preparar",
    "retornar",
    "ligar",
    "prazo",
    "relatorio",
    "relatório",
    "documento",
    "confirmar",
  ]);

  const urgentSignals = hasAny(normalized, [
    "urgente",
    "hoje ainda",
    "agora",
    "pra hoje",
    "prazo",
    "cobranca",
    "cobrança",
    "atrasado",
  ]);

  const replySignals = looksLikeQuestion(normalized, text);

  if (eventSignals) {
    reasons.push("sinal de compromisso com data/horário");
    return {
      classification: "possible_event",
      shouldAlert: true,
      suggestedAction: "event",
      summary: truncate(text),
      reasons,
    };
  }

  if (taskSignals && urgentSignals) {
    reasons.push("pedido com prazo ou urgência");
    return {
      classification: "action_needed",
      shouldAlert: true,
      suggestedAction: replySignals ? "reply" : "task",
      summary: truncate(text),
      reasons,
    };
  }

  if (taskSignals) {
    reasons.push("sinal de tarefa ou entrega");
    return {
      classification: "possible_task",
      shouldAlert: true,
      suggestedAction: "task",
      summary: truncate(text),
      reasons,
    };
  }

  if (replySignals) {
    reasons.push("mensagem parece pedir retorno");
    return {
      classification: "possible_reply",
      shouldAlert: true,
      suggestedAction: "reply",
      summary: truncate(text),
      reasons,
    };
  }

  if (operatorMentioned || urgentSignals) {
    reasons.push(operatorMentioned ? "menção ao operador" : "sinal de atenção");
    return {
      classification: "attention",
      shouldAlert: true,
      suggestedAction: "summary",
      summary: truncate(text),
      reasons,
    };
  }

  return {
    classification: "informational",
    shouldAlert: false,
    suggestedAction: "register",
    summary: truncate(text),
    reasons: reasons.length > 0 ? reasons : ["sem ação clara detectada"],
  };
}

export function buildMonitoredChannelAlertReply(draft: PendingMonitoredChannelAlertDraft): string {
  return [
    `Alerta do canal monitorado: ${draft.summary}`,
    `- Canal: ${draft.sourceDisplayName}`,
    `- Contato: ${draft.sourcePushName ?? draft.sourceNumber}`,
    `- Classificação: ${draft.classification}`,
    ...(draft.reasons.length > 0 ? [`- Sinais: ${draft.reasons.join(" | ")}`] : []),
    "",
    `Mensagem: ${draft.sourceText}`,
    "",
    "Responda com: `agenda`, `cria tarefa`, `responda`, `resumo`, `registrar`, `ignora` ou `sim`.",
  ].join("\n");
}

function normalizeReply(value: string): string {
  return normalizeText(value);
}

export function resolveMonitoredAlertReplyAction(
  draft: PendingMonitoredChannelAlertDraft,
  replyText: string,
): {
  kind: "ignore" | "summary" | "register" | "event" | "task" | "reply" | "clarify";
  message?: string;
} {
  const normalized = normalizeReply(replyText);

  if (!normalized) {
    return {
      kind: "clarify",
      message: "Responda com `agenda`, `cria tarefa`, `responda`, `resumo`, `registrar`, `ignora` ou `sim`.",
    };
  }

  if (["ignora", "ignorar", "ignora isso", "cancelar", "descartar"].includes(normalized)) {
    return { kind: "ignore" };
  }

  if (["resumo", "resuma", "me mostra resumo"].includes(normalized)) {
    return { kind: "summary" };
  }

  if (["registrar", "registre", "deixa registrado"].includes(normalized)) {
    return { kind: "register" };
  }

  if (
    normalized === "sim"
    || normalized === "ok"
    || normalized === "pode seguir"
    || normalized === "segue"
  ) {
    if (draft.suggestedAction === "event") {
      return draft.eventDraft ? { kind: "event" } : { kind: "clarify", message: "Detectei reunião, mas faltou base segura para montar o rascunho do evento." };
    }
    if (draft.suggestedAction === "task") {
      return draft.taskDraft ? { kind: "task" } : { kind: "clarify", message: "Detectei tarefa, mas faltou base segura para montar o rascunho." };
    }
    if (draft.suggestedAction === "reply") {
      return draft.replyDraft ? { kind: "reply" } : { kind: "clarify", message: "Posso preparar resposta, mas esta mensagem não trouxe base suficiente para um rascunho confiável." };
    }
    if (draft.suggestedAction === "summary") {
      return { kind: "summary" };
    }
    return { kind: "register" };
  }

  if (
    normalized.includes("agenda")
    || normalized.includes("evento")
    || normalized.includes("agendar")
  ) {
    return draft.eventDraft
      ? { kind: "event" }
      : { kind: "clarify", message: "Não consegui montar um rascunho de evento seguro a partir dessa mensagem." };
  }

  if (
    normalized.includes("tarefa")
    || normalized.includes("task")
  ) {
    return draft.taskDraft
      ? { kind: "task" }
      : { kind: "clarify", message: "Não consegui montar um rascunho de tarefa seguro a partir dessa mensagem." };
  }

  if (
    normalized.includes("respon")
    || normalized.includes("rascunho")
    || normalized.includes("reply")
  ) {
    return draft.replyDraft
      ? { kind: "reply" }
      : { kind: "clarify", message: "Ainda não tenho rascunho de resposta confiável para essa mensagem." };
  }

  return {
    kind: "clarify",
    message: "Responda com `agenda`, `cria tarefa`, `responda`, `resumo`, `registrar`, `ignora` ou `sim`.",
  };
}
