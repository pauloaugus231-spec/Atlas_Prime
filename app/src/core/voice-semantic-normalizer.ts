import {
  buildEventDraftFromPrompt,
  buildTaskDraftFromPrompt,
  type PendingGoogleEventDraft,
  type PendingGoogleTaskDraft,
} from "./google-draft-utils.js";
import { looksLikeShortContextualConversationReply } from "./conversation-interpreter.js";

export type VoiceSemanticIntentHint =
  | "contextual_reply"
  | "calendar_create"
  | "task_create"
  | "memory_save"
  | "agenda_read"
  | "planning"
  | "passthrough";

export interface VoiceSemanticNormalizationResult {
  text: string;
  changed: boolean;
  intentHint: VoiceSemanticIntentHint;
  eventDraftPreview?: PendingGoogleEventDraft;
  taskDraftPreview?: PendingGoogleTaskDraft;
}

function normalizeComparable(value: string): string {
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

function looksLikeEventTiming(normalized: string): boolean {
  return /\bamanha\b/.test(normalized)
    || /\bhoje\b/.test(normalized)
    || /\bdia\s+\d{1,2}\b/.test(normalized)
    || /\b\d{1,2}\/\d{1,2}\b/.test(normalized)
    || /\bas\s+\d{1,2}(?::\d{2})?\b/.test(normalized)
    || /\b\d{1,2}h(?:\d{2})?\b/.test(normalized)
    || /\bsegunda|terca|quarta|quinta|sexta|sabado|domingo\b/.test(normalized);
}

function canonicalizeMemoryPrompt(original: string, normalized: string): string | undefined {
  const match = original.match(/^(?:salva|salve|guarda|guarde|registra|registre)\s+que\s+([\s\S]+)$/i);
  if (!match?.[1]?.trim()) {
    return undefined;
  }
  if (!hasAny(normalized, [
    "plantao",
    "rotina",
    "resposta",
    "respostas curtas",
    "casaco",
    "carregador",
    "na rua",
    "deslocamento",
    "prioridade",
    "briefing",
  ])) {
    return undefined;
  }
  return `salve na minha memória pessoal que ${match[1].trim()}`;
}

function canonicalizeTaskPrompt(original: string): string | undefined {
  const match = original.match(/^(?:anota|anote|marca|marque|cria|crie|coloca|coloque|adiciona|adicione|salva|salve|registre|registra)\s+(?:uma\s+)?(?:tarefa|task|lembrete)(?:\s+para)?\s+([\s\S]+)$/i);
  if (!match?.[1]?.trim()) {
    return undefined;
  }
  return `crie uma tarefa ${match[1].trim()}`;
}

function canonicalizeEventPrompt(original: string, normalized: string): string | undefined {
  const match = original.match(/^(?:(?:coloca|coloque|marca|marque|agenda|agende|cria|crie)\s+(?:na\s+minha\s+agenda|na\s+agenda|no\s+meu\s+calendario|no\s+calendario)?\s*)([\s\S]+)$/i);
  if (!match?.[1]?.trim()) {
    const declarativeMatch = original.match(
      /^(.*?)(?:\b(?:eu\s+)?(?:tenho|terei|teremos|vou\s+ter|vamos\s+ter|irei\s+ter)\s+(?:uma|um)\s+)([\s\S]+)$/i,
    );
    if (declarativeMatch?.[2]?.trim()) {
      const contextPrefix = declarativeMatch[1]?.trim();
      const body = declarativeMatch[2].trim();
      const bodyNormalized = normalizeComparable(body);
      if (
        looksLikeEventTiming(normalized)
        && hasAny(bodyNormalized, ["reuniao", "compromisso", "evento", "consulta", "visita", "encontro"])
      ) {
        return `crie um evento ${body}${contextPrefix ? ` ${contextPrefix}` : ""}`.replace(/\s+/g, " ").trim();
      }
    }

    const looksLikeDeclarativeEvent =
      looksLikeEventTiming(normalized)
      && hasAny(normalized, ["reuniao", "compromisso", "evento", "consulta", "visita", "encontro"])
      && !hasAny(normalized, ["qual ", "que horas", "quando ", "onde ", "por que", "porque", "como "]);
    if (looksLikeDeclarativeEvent) {
      return `crie um evento ${original.trim()}`.replace(/\s+/g, " ").trim();
    }
    return undefined;
  }

  const body = match[1]
    .trim()
    .replace(/^(?:(?:um|uma|o|a)\s+)?(?:evento|compromisso|lembrete)\s+/i, "")
    .trim();
  const bodyNormalized = normalizeComparable(body);
  const hasEventCue = hasAny(bodyNormalized, [
    "evento",
    "compromisso",
    "reuniao",
    "caps",
    "creas",
    "cras",
    "visita",
    "meet",
  ]) || looksLikeEventTiming(bodyNormalized);
  if (!hasEventCue) {
    return undefined;
  }
  return `crie um evento ${body}`;
}

export function normalizeVoiceTranscriptForTelegram(
  text: string,
  timeZone: string,
): VoiceSemanticNormalizationResult {
  const trimmed = text.trim();
  const normalized = normalizeComparable(trimmed);

  if (!trimmed) {
    return {
      text: trimmed,
      changed: false,
      intentHint: "passthrough",
    };
  }

  if (looksLikeShortContextualConversationReply(trimmed)) {
    return {
      text: trimmed,
      changed: false,
      intentHint: "contextual_reply",
    };
  }

  const memoryPrompt = canonicalizeMemoryPrompt(trimmed, normalized);
  const taskPrompt = canonicalizeTaskPrompt(trimmed);
  const eventPrompt = canonicalizeEventPrompt(trimmed, normalized);
  const nextText = memoryPrompt ?? taskPrompt ?? eventPrompt ?? trimmed;
  const intentHint: VoiceSemanticIntentHint = memoryPrompt
    ? "memory_save"
    : taskPrompt
      ? "task_create"
      : eventPrompt
        ? "calendar_create"
        : hasAny(normalized, ["agenda", "compromissos", "me mostra a agenda", "qual minha agenda"])
          ? "agenda_read"
          : hasAny(normalized, ["organiza meu dia", "organizar meu dia", "briefing", "planeja meu dia"])
            ? "planning"
            : "passthrough";

  const eventDraftPreview = buildEventDraftFromPrompt(nextText, timeZone).draft;
  const taskDraftPreview = buildTaskDraftFromPrompt(nextText, timeZone).draft;

  return {
    text: nextText,
    changed: nextText !== trimmed,
    intentHint,
    ...(eventDraftPreview ? { eventDraftPreview } : {}),
    ...(taskDraftPreview ? { taskDraftPreview } : {}),
  };
}
