import type {
  PendingGoogleEventDraft,
  PendingGoogleTaskDraft,
} from "./google-draft-utils.js";

export type MonitoredOperationalUrgency = "low" | "medium" | "high";
export type MonitoredTimeSignal = "none" | "today" | "tomorrow" | "deadline";

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
  operationalScore?: number;
  urgency?: MonitoredOperationalUrgency;
  timeSignal?: MonitoredTimeSignal;
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
  operationalScore: number;
  urgency: MonitoredOperationalUrgency;
  timeSignal: MonitoredTimeSignal;
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

function detectTimeSignal(normalized: string): MonitoredTimeSignal {
  if (/\b(?:hoje|agora|hoje ainda|ainda hoje|nesta tarde|nesta manha)\b/.test(normalized)) {
    return "today";
  }
  if (/\b(?:amanha|a manha)\b/.test(normalized)) {
    return "tomorrow";
  }
  if (/\bate\b|\bprazo\b|\bat\s+(?:sexta|amanha|hoje|segunda|terca|quarta|quinta|sabado|domingo)\b/.test(normalized)) {
    return "deadline";
  }
  return "none";
}

function detectUrgency(normalized: string): MonitoredOperationalUrgency {
  if (hasAny(normalized, [
    "urgente",
    "agora",
    "hoje ainda",
    "ainda hoje",
    "pra hoje",
    "prazo",
    "cobranca",
    "atrasado",
    "nao recebi",
    "com urgencia",
  ])) {
    return "high";
  }
  if (hasAny(normalized, [
    "amanha",
    "me avisa",
    "me confirma",
    "me retorna",
    "me responde",
    "quando puder",
    "assim que puder",
  ])) {
    return "medium";
  }
  return "low";
}

function describeTimeSignal(timeSignal?: MonitoredTimeSignal): string | undefined {
  if (timeSignal === "today") {
    return "pra hoje";
  }
  if (timeSignal === "tomorrow") {
    return "pra amanhã";
  }
  if (timeSignal === "deadline") {
    return "com prazo";
  }
  return undefined;
}

function computeOperationalScore(input: {
  operatorMentioned: boolean;
  directRequest: boolean;
  eventSignals: boolean;
  taskSignals: boolean;
  replySignals: boolean;
  scheduleChangeSignals: boolean;
  chargeSignals: boolean;
  urgency: MonitoredOperationalUrgency;
  timeSignal: MonitoredTimeSignal;
}): number {
  let score = 0;
  if (input.operatorMentioned) {
    score += 2;
  }
  if (input.directRequest) {
    score += 2;
  }
  if (input.eventSignals) {
    score += 3;
  }
  if (input.taskSignals) {
    score += 3;
  }
  if (input.replySignals) {
    score += 2;
  }
  if (input.scheduleChangeSignals) {
    score += 2;
  }
  if (input.chargeSignals) {
    score += 2;
  }
  if (input.urgency === "high") {
    score += 2;
  } else if (input.urgency === "medium") {
    score += 1;
  }
  if (input.timeSignal === "today" || input.timeSignal === "tomorrow") {
    score += 1;
  } else if (input.timeSignal === "deadline") {
    score += 2;
  }
  return score;
}

function buildEventSnippet(draft: PendingGoogleEventDraft, timeSignal?: MonitoredTimeSignal): string {
  const date = new Date(draft.start);
  if (Number.isNaN(date.getTime())) {
    return draft.summary;
  }

  const dateLabel = timeSignal === "today"
    ? "hoje"
    : timeSignal === "tomorrow"
      ? "amanhã"
      : new Intl.DateTimeFormat("pt-BR", {
        timeZone: draft.timezone,
        day: "2-digit",
        month: "2-digit",
      }).format(date);
  const timeLabel = new Intl.DateTimeFormat("pt-BR", {
    timeZone: draft.timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  const locationPart = draft.location?.trim()
    ? ` em ${draft.location.trim()}`
    : draft.summary?.trim()
      ? ` — ${draft.summary.trim()}`
      : "";
  return `${dateLabel} às ${timeLabel}${locationPart}`;
}

function buildTaskSnippet(draft: PendingGoogleTaskDraft, timeSignal?: MonitoredTimeSignal): string {
  const dueLabel = describeTimeSignal(timeSignal);
  return dueLabel ? `${draft.title} (${dueLabel})` : draft.title;
}

function buildOperationalSnippet(draft: PendingMonitoredChannelAlertDraft): string {
  if (draft.classification === "possible_event" && draft.eventDraft) {
    return buildEventSnippet(draft.eventDraft, draft.timeSignal);
  }
  if ((draft.classification === "possible_task" || draft.classification === "action_needed") && draft.taskDraft) {
    return buildTaskSnippet(draft.taskDraft, draft.timeSignal);
  }
  return draft.summary;
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
      operationalScore: 0,
      urgency: "low",
      timeSignal: "none",
    };
  }

  const operatorMentioned = operatorName.length >= 3 && normalized.includes(operatorName);
  const timeSignal = detectTimeSignal(normalized);
  const urgency = detectUrgency(normalized);
  const scheduleChangeSignals = hasAny(normalized, [
    "mudou para",
    "muda para",
    "alterou",
    "alterado",
    "reagendou",
    "remarcou",
    "cancelou",
    "cancelada",
    "passou para",
    "trocou o horario",
  ]);
  const chargeSignals = hasAny(normalized, [
    "cobranca",
    "atrasado",
    "pendente",
    "nao recebi",
  ]);

  if (operatorMentioned) {
    reasons.push("menção direta ao operador");
  }
  if (scheduleChangeSignals) {
    reasons.push("mudança de agenda");
  }
  if (chargeSignals) {
    reasons.push("sinal de cobrança");
  }
  const timeSignalReason = describeTimeSignal(timeSignal);
  if (timeSignalReason) {
    reasons.push(timeSignalReason);
  }
  if (urgency === "high") {
    reasons.push("urgência alta");
  } else if (urgency === "medium") {
    reasons.push("prioridade operacional");
  }

  const eventSignals = hasAny(normalized, [
    "reuniao",
    "encontro",
    "agenda",
    "comparecer",
    "horario",
    "caps",
    "creas",
    "cras",
    "visita",
  ]) && (looksLikeTimeCue(normalized) || scheduleChangeSignals);

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
    "documento",
    "confirmar",
    "revisar",
    "comprar",
    "resolver",
    "ajustar",
  ]);

  const replySignals = looksLikeQuestion(normalized, text);
  const directRequest = replySignals || hasAny(normalized, [
    "preciso que",
    "consegue",
    "pode",
    "favor",
    "por favor",
    "me confirma",
    "me avisa",
    "me responde",
    "me retorna",
  ]);

  const operationalScore = computeOperationalScore({
    operatorMentioned,
    directRequest,
    eventSignals,
    taskSignals,
    replySignals,
    scheduleChangeSignals,
    chargeSignals,
    urgency,
    timeSignal,
  });

  if (eventSignals) {
    reasons.push("sinal de compromisso com data/horário");
    return {
      classification: "possible_event",
      shouldAlert: true,
      suggestedAction: "event",
      summary: truncate(text),
      reasons,
      operationalScore,
      urgency,
      timeSignal,
    };
  }

  if (taskSignals && (urgency !== "low" || timeSignal === "deadline" || chargeSignals || directRequest || operatorMentioned)) {
    reasons.push(urgency === "high" || chargeSignals ? "pedido com prazo ou urgência" : "demanda operacional detectada");
    return {
      classification: urgency === "high" || chargeSignals ? "action_needed" : "possible_task",
      shouldAlert: true,
      suggestedAction: "task",
      summary: truncate(text),
      reasons,
      operationalScore,
      urgency,
      timeSignal,
    };
  }

  if (replySignals && (operatorMentioned || directRequest || urgency !== "low")) {
    reasons.push("mensagem parece pedir retorno");
    return {
      classification: "possible_reply",
      shouldAlert: true,
      suggestedAction: "reply",
      summary: truncate(text),
      reasons,
      operationalScore,
      urgency,
      timeSignal,
    };
  }

  if (operatorMentioned || urgency !== "low" || scheduleChangeSignals || chargeSignals) {
    reasons.push(operatorMentioned ? "mensagem importante para o operador" : "sinal de atenção");
    return {
      classification: "attention",
      shouldAlert: operationalScore >= 4,
      suggestedAction: "summary",
      summary: truncate(text),
      reasons,
      operationalScore,
      urgency,
      timeSignal,
    };
  }

  return {
    classification: "informational",
    shouldAlert: operationalScore >= 5,
    suggestedAction: "register",
    summary: truncate(text),
    reasons: reasons.length > 0 ? reasons : ["sem ação clara detectada"],
    operationalScore,
    urgency,
    timeSignal,
  };
}

export function buildMonitoredChannelAlertReply(draft: PendingMonitoredChannelAlertDraft): string {
  const contactLabel = draft.sourcePushName ?? draft.sourceNumber;
  const snippet = buildOperationalSnippet(draft);
  const headline = draft.classification === "possible_event"
    ? `Possível reunião no institucional: ${snippet}. Quer que eu crie evento, tarefa ou só registre?`
    : draft.classification === "possible_task"
      ? `Possível tarefa detectada no institucional: ${snippet}. Quer que eu crie task ou só registre?`
      : draft.classification === "possible_reply"
        ? "Parece que te pediram retorno no institucional. Quer resumo ou rascunho de resposta?"
        : draft.classification === "action_needed"
          ? `Demanda importante no institucional: ${snippet}. Quer que eu crie task, resposta ou só registre?`
          : `Mensagem relevante no institucional: ${draft.summary}. Quer resumo, resposta ou só registrar?`;

  return [
    headline,
    `${contactLabel}: ${truncate(draft.sourceText, 160)}`,
    "Responda com `agenda`, `cria tarefa`, `responda`, `resumo`, `registrar`, `ignora` ou `sim`.",
  ].join("\n\n");
}

export function buildMonitoredChannelAlertSummaryReply(draft: PendingMonitoredChannelAlertDraft): string {
  const contactLabel = draft.sourcePushName ?? draft.sourceNumber;
  const urgencyLabel = draft.urgency === "high"
    ? "alta"
    : draft.urgency === "medium"
      ? "média"
      : "baixa";
  return [
    `Resumo do institucional: ${draft.summary}`,
    `${contactLabel} | classificação: ${draft.classification} | urgência: ${urgencyLabel}`,
    ...(draft.reasons.length > 0 ? [`Sinais: ${draft.reasons.join(" | ")}`] : []),
    "Se quiser agir, responda com `agenda`, `cria tarefa`, `responda`, `registrar` ou `ignora`.",
  ].join("\n\n");
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

  if (["ignora", "ignorar", "ignora isso", "cancelar", "descartar", "cancela isso"].includes(normalized)) {
    return { kind: "ignore" };
  }

  if (["resumo", "resuma", "me mostra resumo", "só resumo", "so resumo"].includes(normalized)) {
    return { kind: "summary" };
  }

  if (["registrar", "registre", "deixa registrado", "so registra", "só registra", "apenas registra"].includes(normalized)) {
    return { kind: "register" };
  }

  if (
    normalized === "sim"
    || normalized === "ok"
    || normalized === "pode seguir"
    || normalized === "segue"
    || normalized === "segue nisso"
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
    || normalized.includes("cria o evento")
    || normalized.includes("crie o evento")
  ) {
    return draft.eventDraft
      ? { kind: "event" }
      : { kind: "clarify", message: "Não consegui montar um rascunho de evento seguro a partir dessa mensagem." };
  }

  if (
    normalized.includes("tarefa")
    || normalized.includes("task")
    || normalized.includes("transforma isso em tarefa")
    || normalized.includes("cria task")
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
