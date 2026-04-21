import type { EvolutionRecentChatRecord } from "../integrations/whatsapp/evolution-api.js";
import { normalizeEmailAnalysisText } from "../integrations/email/email-analysis.js";
import {
  isGoogleEventCreatePrompt,
  isGoogleTaskCreatePrompt,
} from "./google-draft-utils.js";

function includesAny(source: string, tokens: string[]): boolean {
  return tokens.some((token) => source.includes(token));
}

function extractTelegramHistoryUserTurns(prompt: string): string[] {
  const historyMarker = "Histórico recente do chat:";
  const currentMarker = "Mensagem atual do usuário:";
  const historyIndex = prompt.indexOf(historyMarker);
  const currentIndex = prompt.indexOf(currentMarker);
  if (historyIndex === -1 || currentIndex === -1 || currentIndex <= historyIndex) {
    return [];
  }

  return prompt
    .slice(historyIndex + historyMarker.length, currentIndex)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("Usuário: "))
    .map((line) => line.replace(/^Usuário:\s*/i, "").trim())
    .filter(Boolean);
}

function isGenericWhatsAppFollowUp(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return normalized === "procure no whatsapp" || normalized === "busque no whatsapp" || normalized === "veja no whatsapp";
}

function isClearlyNonWhatsAppIntent(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);

  if (isGoogleEventCreatePrompt(prompt) || isGoogleTaskCreatePrompt(prompt)) {
    return true;
  }

  return includesAny(normalized, [
    "meu calendario",
    "meu calendário",
    "minha agenda",
    "coloque um evento",
    "coloca um evento",
    "crie um evento",
    "crie uma tarefa",
    "adicione uma tarefa",
    "liste meus compromissos",
    "liste minhas tarefas",
    "procure no whatsapp",
    "busque no whatsapp",
    "veja no whatsapp",
    "pesquise na internet",
    "procure na internet",
    "pesquise sobre",
    "clima em",
    "previsao do tempo",
    "previsão do tempo",
    "morning briefing",
    "procure o contato",
    "liste workflows",
    "mostre o workflow",
  ]);
}

export function normalizePhoneDigits(value: string | undefined): string | undefined {
  const digits = value?.replace(/\D+/g, "") ?? "";
  return digits || undefined;
}

export function normalizeAliasToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[\s._/-]+/g, "");
}

export function extractPhoneFromText(text: string): string | undefined {
  const explicitMatch = text.match(
    /\b(?:telefone|fone|whatsapp|contato)\s*:?\s*((?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9?\d{4}[-.\s]?\d{4}|\d{4}[-.\s]?\d{4}))/i,
  );
  if (explicitMatch?.[1]) {
    return explicitMatch[1].replace(/\s+/g, " ").trim();
  }

  const genericMatch = text.match(
    /\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9?\d{4}[-.\s]?\d{4}|\d{4}[-.\s]?\d{4})\b/,
  );
  return genericMatch?.[0]?.replace(/\s+/g, " ").trim();
}

export function isWhatsAppSendPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, ["whatsapp", "zap"]) && includesAny(normalized, [
    "mande mensagem",
    "manda mensagem",
    "enviar mensagem",
    "envie mensagem",
    "responda no whatsapp",
    "responde no whatsapp",
    "manda no whatsapp",
    "envie no whatsapp",
  ]);
}

export function isWhatsAppRecentSearchPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  const hasMessageLookupIntent = includesAny(normalized, [
    "mensagem recente",
    "mensagens recentes",
    "ultima mensagem",
    "última mensagem",
    "ultimas mensagens",
    "últimas mensagens",
    "liste mensagens",
    "listar mensagens",
    "mostre mensagens",
    "ver mensagens",
    "procure no whatsapp",
    "busque no whatsapp",
    "veja no whatsapp",
    "conversa recente",
  ]);
  const hasWhatsAppContext = includesAny(normalized, ["whatsapp", "zap", "abordagem"]);
  return hasMessageLookupIntent && hasWhatsAppContext;
}

export function isWhatsAppPendingApprovalsPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, ["whatsapp", "zap"]) && includesAny(normalized, [
    "aprovações pendentes",
    "aprovacoes pendentes",
    "pendencias",
    "pendências",
    "rascunhos pendentes",
  ]);
}

export function findRecentWhatsAppSendPrompt(fullPrompt: string): string | undefined {
  const historyTurns = extractTelegramHistoryUserTurns(fullPrompt).reverse();
  return historyTurns.find((turn) => isWhatsAppSendPrompt(turn));
}

export function isLikelyWhatsAppBodyFollowUp(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return false;
  }

  const normalized = normalizeEmailAnalysisText(trimmed);
  if (isClearlyNonWhatsAppIntent(trimmed)) {
    return false;
  }
  if (
    isWhatsAppSendPrompt(trimmed) ||
    isWhatsAppRecentSearchPrompt(trimmed) ||
    isGenericWhatsAppFollowUp(trimmed)
  ) {
    return false;
  }

  return ![
    "sim",
    "ok",
    "agendar",
    "confirmar",
    "enviar",
    "mande",
    "autorizo",
    "autorizo envio",
    "deixe o envio de lado",
    "cancele",
    "cancela",
    "ignorar",
  ].includes(normalized);
}

export function extractWhatsAppTargetReference(prompt: string): string | undefined {
  const patterns = [
    /(?:procure|busque|veja)\s+(?:no\s+)?(?:whatsapp|zap)\s+por\s+(.+?)(?=(?:[?.!,;]|$))/i,
    /(?:whatsapp|zap)\s+(?:de|do|da|para|pro|pra)\s+(.+?)(?=(?:\s+(?:mensagem|texto|dizendo|com a mensagem|com o texto)|\s*[:|]|[?.!,;]|$))/i,
    /(?:mande|manda|envie|enviar|responda|responde)\s+(?:mensagem\s+)?(?:para|pro|pra)\s+(.+?)(?=(?:\s+(?:no\s+)?(?:whatsapp|zap)|\s+(?:mensagem|texto|dizendo|com a mensagem|com o texto)|\s*[:|]|[?.!,;]|$))/i,
    /(?:mensagens?(?:\s+recentes?)?|conversas?(?:\s+recentes?)?)\s+(?:de|do|da|com)\s+(.+?)(?=(?:[?.!,;]|$))/i,
  ];
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    const value = match?.[1]?.trim();
    if (value) {
      return value.replace(/^["“'`]+|["”'`]+$/g, "").trim();
    }
  }
  return undefined;
}

export function extractWhatsAppMessageBody(prompt: string): string | undefined {
  const quoted = prompt.match(/["“]([^"”]+)["”]/);
  if (quoted?.[1]?.trim()) {
    return quoted[1].trim();
  }

  const pipeMatch = prompt.match(/\|\s*(.+)$/);
  if (pipeMatch?.[1]?.trim()) {
    return pipeMatch[1].trim();
  }

  const patterns = [
    /(?:mensagem|texto)\s*:\s*([\s\S]+)$/i,
    /(?:dizendo|com a mensagem|com o texto)\s+([\s\S]+)$/i,
    /:\s*([\s\S]+)$/i,
  ];
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    const value = match?.[1]?.trim();
    if (value) {
      return value.replace(/^["“'`]+|["”'`]+$/g, "").trim();
    }
  }
  return undefined;
}

export function extractWhatsAppSearchQuery(currentPrompt: string, fullPrompt: string): string | undefined {
  const current = extractWhatsAppTargetReference(currentPrompt);
  if (current) {
    return current;
  }

  if (!isGenericWhatsAppFollowUp(currentPrompt)) {
    return undefined;
  }

  const historyTurns = extractTelegramHistoryUserTurns(fullPrompt).reverse();
  for (const turn of historyTurns) {
    const candidate = extractWhatsAppTargetReference(turn);
    if (candidate) {
      return candidate;
    }
    const genericRecent = turn.match(/mensagem(?:\s+recente)?\s+de\s+(.+?)(?=(?:[?.!,;]|$))/i);
    if (genericRecent?.[1]?.trim()) {
      return genericRecent[1].trim();
    }
  }

  return undefined;
}

export function buildWhatsAppDraftMarker(draft: {
  instanceName?: string;
  account?: string;
  remoteJid: string;
  number: string;
  pushName?: string;
  inboundText?: string;
  replyText: string;
  relationship?: string;
  persona?: string;
}): string {
  return [
    "WHATSAPP_REPLY_DRAFT",
    JSON.stringify({
      kind: "whatsapp_reply",
      instanceName: draft.instanceName,
      account: draft.account,
      remoteJid: draft.remoteJid,
      number: draft.number,
      pushName: draft.pushName,
      inboundText: draft.inboundText ?? "",
      replyText: draft.replyText,
      relationship: draft.relationship,
      persona: draft.persona,
    }),
    "END_WHATSAPP_REPLY_DRAFT",
  ].join("\n");
}

export function buildWhatsAppDirectDraftReply(input: {
  nameOrNumber: string;
  number: string;
  text: string;
  account?: string;
  instanceName?: string;
  marker: string;
}): string {
  return [
    input.marker,
    `Rascunho WhatsApp pronto para ${input.nameOrNumber}.`,
    `Número: ${input.number}`,
    ...(input.account ? [`Conta operacional: ${input.account}`] : []),
    ...(input.instanceName ? [`Instância: ${input.instanceName}`] : []),
    `Mensagem: ${input.text}`,
    "Confirme com `enviar` ou use os botões `Enviar`, `Editar` ou `Ignorar`.",
  ].join("\n");
}

export function buildWhatsAppScopedRecentChatsReply(label: string, chats: EvolutionRecentChatRecord[]): string {
  const filteredChats = chats.filter((item) => !item.isSystem).slice(0, 8);
  if (filteredChats.length === 0) {
    return [
      `Não encontrei conversas recentes no WhatsApp da conta ${label}.`,
      "Se a instância acabou de conectar, tente de novo em alguns instantes.",
    ].join("\n");
  }

  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const summarize = (value: string | undefined): string => {
    const compact = (value ?? "sem texto").replace(/\s+/g, " ").trim();
    return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
  };
  const hasUrgencySignal = (value: string | undefined): boolean => {
    const normalized = normalizeEmailAnalysisText(value ?? "");
    return includesAny(normalized, [
      "urgente",
      "urgencia",
      "urgência",
      "agora",
      "hoje ainda",
      "assim que puder",
      "me liga",
      "me ligue",
      "responde",
      "preciso de ti",
      "preciso de voce",
      "preciso de você",
    ]);
  };

  return [
    `Conversas recentes do WhatsApp ${label}: ${filteredChats.length}.`,
    ...filteredChats.map((item) => {
      const when = item.updatedAt ? formatter.format(new Date(item.updatedAt)) : "sem horário";
      const priority = item.mentionedJids.length > 0 || hasUrgencySignal(item.lastMessageText);
      const groupLabel = item.chatName ?? item.remoteJid;
      const directLabel = item.senderName ?? item.remoteJidAlt ?? item.remoteJid;
      const direction = item.fromMe ? "enviada" : "recebida";
      const text = summarize(item.lastMessageText);
      if (item.isGroup) {
        const sender = item.senderName && item.senderName !== item.chatName
          ? item.senderName
          : "autor não identificado";
        return `- ${priority ? "[PRIORIDADE] " : ""}${when} | grupo: ${groupLabel} | autor: ${sender} | ${direction} | ${text}`;
      }
      return `- ${priority ? "[PRIORIDADE] " : ""}${when} | direto: ${directLabel} | ${direction} | ${text}`;
    }),
  ].join("\n");
}
