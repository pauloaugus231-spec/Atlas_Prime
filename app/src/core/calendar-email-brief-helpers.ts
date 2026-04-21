import { normalizeEmailAnalysisText, type EmailOperationalGroup, type EmailOperationalSummary } from "../integrations/email/email-analysis.js";
import type { EmailMessageSummary } from "../integrations/email/email-reader.js";
import type { CalendarListSummary, DailyOperationalBrief, TaskSummary } from "../integrations/google/google-workspace.js";
import type { GoogleWorkspaceService } from "../integrations/google/google-workspace.js";
import { BriefRenderer } from "./brief-renderer.js";
import type { FounderOpsSnapshot } from "./founder-ops.js";
import { isGoogleEventCreatePrompt, isGoogleTaskCreatePrompt } from "./google-draft-utils.js";
import {
  extractExplicitGoogleAccountAlias,
  resolveGoogleAccountAliasesForPrompt,
} from "./google-account-resolution.js";
import type { ExecutiveMorningBrief } from "./personal-os.js";
import type { PersonalOperationalProfile } from "../types/personal-operational-memory.js";

function includesAny(source: string, tokens: string[]): boolean {
  return tokens.some((token) => source.includes(token));
}

function isEmailFocusedPrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return [
    "email",
    "e-mail",
    "inbox",
    "caixa de entrada",
    "remetente",
    "assunto",
    "uid ",
    "uid=",
  ].some((token) => normalized.includes(token));
}

function extractEmailUidFromPrompt(prompt: string): string | undefined {
  const match = prompt.match(/\buid(?:\s*=|\s+)?([a-z0-9_-]+)\b/i);
  if (!match) {
    return undefined;
  }
  return match[1]?.trim() || undefined;
}

export function extractReferenceMonth(prompt: string): string | undefined {
  const match = prompt.match(/\b(20\d{2}-\d{2})\b/);
  return match?.[1];
}

export function isCalendarLookupPrompt(prompt: string): boolean {
  if (isGoogleEventCreatePrompt(prompt) || isGoogleTaskCreatePrompt(prompt)) {
    return false;
  }
  const normalized = normalizeEmailAnalysisText(prompt);
  return (
    includesAny(normalized, [
      "tenho algo agendado",
      "tenho compromisso",
      "tenho evento",
      "ha algo agendado",
      "há algo agendado",
      "verifique meu calendario",
      "verifique meu calendário",
      "olhe meu calendario",
      "olhe meu calendário",
      "veja meu calendario",
      "veja meu calendário",
      "analise meu calendario",
      "analise meu calendário",
      "no calendario",
      "no calendário",
      "na agenda",
      "evento no dia",
      "compromisso no dia",
    ]) &&
    !normalized.includes("calendario editorial") &&
    !normalized.includes("calendário editorial")
  );
}

export function getWeekdayTargetDate(normalized: string, timezone: string): { isoDate: string; label: string } | undefined {
  const weekdayMap: Array<{ tokens: string[]; day: number; label: string }> = [
    { tokens: ["domingo"], day: 0, label: "domingo" },
    { tokens: ["segunda", "segunda feira"], day: 1, label: "segunda" },
    { tokens: ["terca", "terça", "terca feira", "terça feira"], day: 2, label: "terça" },
    { tokens: ["quarta", "quarta feira"], day: 3, label: "quarta" },
    { tokens: ["quinta", "quinta feira"], day: 4, label: "quinta" },
    { tokens: ["sexta", "sexta feira"], day: 5, label: "sexta" },
    { tokens: ["sabado", "sábado", "sabado feira", "sábado feira"], day: 6, label: "sábado" },
  ];

  const match = weekdayMap.find((item) => item.tokens.some((token) => normalized.includes(token)));
  if (!match) {
    return undefined;
  }

  const now = new Date();
  const localized = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
  localized.setHours(0, 0, 0, 0);
  const currentDay = localized.getDay();
  let diff = match.day - currentDay;
  if (diff <= 0) {
    diff += 7;
  }
  localized.setDate(localized.getDate() + diff);
  const isoDate = [
    String(localized.getFullYear()).padStart(4, "0"),
    String(localized.getMonth() + 1).padStart(2, "0"),
    String(localized.getDate()).padStart(2, "0"),
  ].join("-");
  return {
    isoDate,
    label: match.label,
  };
}

export function parseCalendarLookupDate(prompt: string, timezone: string): CalendarLookupRequest["targetDate"] | undefined {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [yearNow, monthNow, dayNow] = formatter.format(now).split("-").map((item) => Number.parseInt(item, 10));

  const explicit = prompt.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  let year = yearNow;
  let month = monthNow;
  let day = dayNow;

  if (explicit?.[1] && explicit?.[2]) {
    day = Number.parseInt(explicit[1], 10);
    month = Number.parseInt(explicit[2], 10);
    if (explicit[3]) {
      year = Number.parseInt(explicit[3].length === 2 ? `20${explicit[3]}` : explicit[3], 10);
    }
  } else {
    const normalized = normalizeEmailAnalysisText(prompt);
    if (normalized.includes("amanha")) {
      const shifted = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const [shiftYear, shiftMonth, shiftDay] = formatter.format(shifted).split("-").map((item) => Number.parseInt(item, 10));
      year = shiftYear;
      month = shiftMonth;
      day = shiftDay;
    } else if (!normalized.includes("hoje")) {
      const weekdayTarget = getWeekdayTargetDate(normalized, timezone);
      if (weekdayTarget) {
        return {
          isoDate: weekdayTarget.isoDate,
          startIso: `${weekdayTarget.isoDate}T00:00:00-03:00`,
          endIso: `${weekdayTarget.isoDate}T23:59:59-03:00`,
          label: weekdayTarget.label,
        };
      }
      return undefined;
    }
  }

  const isoDate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return {
    isoDate,
    startIso: `${isoDate}T00:00:00-03:00`,
    endIso: `${isoDate}T23:59:59-03:00`,
    label: explicit ? `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}` : normalizeEmailAnalysisText(prompt).includes("amanha") ? "amanhã" : "hoje",
  };
}

export function extractCalendarLookupTopic(prompt: string): string | undefined {
  const patterns = [
    /\bsobre\s+["“]?(.+?)["”]?(?=(?:[?.!,;:]|$))/i,
    /\bcom\s+["“]?(.+?)["”]?(?=(?:[?.!,;:]|$))/i,
    /(?:evento|compromisso|agenda)\s+(?:de|do|da)\s+["“]?(.+?)["”]?(?=(?:\s+no dia|\s+dia\s+\d|\?|$))/i,
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    const value = match?.[1]
      ?.trim()
      .replace(/^dia\s+\d{1,2}\/\d{1,2}\s+/i, "")
      .replace(/^sobre\s+/i, "")
      .replace(/[?.!,;:]+$/g, "")
      .trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

export function extractCalendarLookupRequest(prompt: string, timezone: string): CalendarLookupRequest | undefined {
  if (!isCalendarLookupPrompt(prompt)) {
    return undefined;
  }

  return {
    topic: extractCalendarLookupTopic(prompt),
    targetDate: parseCalendarLookupDate(prompt, timezone),
  };
}

export interface EmailLookupRequest {
  senderQuery?: string;
  category?: EmailOperationalGroup;
  unreadOnly: boolean;
  sinceHours: number;
  existenceOnly: boolean;
}

export interface ResolvedEmailReference {
  message?: EmailMessageSummary;
  label: string;
  totalMatches: number;
  request: EmailLookupRequest;
}

export interface CalendarLookupRequest {
  topic?: string;
  targetDate?: {
    isoDate: string;
    startIso: string;
    endIso: string;
    label: string;
  };
}

export interface CalendarPeriodWindow {
  startIso: string;
  endIso: string;
  label: string;
}

export function parseCalendarPeriodWindow(prompt: string, timezone: string): CalendarPeriodWindow | undefined {
  const normalized = normalizeEmailAnalysisText(prompt);
  const specificDate = parseCalendarLookupDate(prompt, timezone);
  if (specificDate) {
    return {
      startIso: specificDate.startIso,
      endIso: specificDate.endIso,
      label: specificDate.label,
    };
  }

  const now = new Date();
  const today = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);

  if (normalized.includes("amanha")) {
    const start = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1000);
    return {
      startIso: start.toISOString().replace("Z", "-03:00"),
      endIso: end.toISOString().replace("Z", "-03:00"),
      label: "amanhã",
    };
  }
  if (normalized.includes("hoje")) {
    const end = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000 - 1000);
    return {
      startIso: startOfToday.toISOString().replace("Z", "-03:00"),
      endIso: end.toISOString().replace("Z", "-03:00"),
      label: "hoje",
    };
  }
  if (normalized.includes("esta semana") || normalized.includes("essa semana")) {
    const start = new Date(startOfToday);
    const day = start.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diffToMonday);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    end.setMilliseconds(-1);
    return {
      startIso: start.toISOString().replace("Z", "-03:00"),
      endIso: end.toISOString().replace("Z", "-03:00"),
      label: "esta semana",
    };
  }
  if (normalized.includes("proxima semana") || normalized.includes("próxima semana") || normalized.includes("semana que vem")) {
    const start = new Date(startOfToday);
    const day = start.getDay();
    const diffToNextMonday = day === 0 ? 1 : 8 - day;
    start.setDate(start.getDate() + diffToNextMonday);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    end.setMilliseconds(-1);
    return {
      startIso: start.toISOString().replace("Z", "-03:00"),
      endIso: end.toISOString().replace("Z", "-03:00"),
      label: "próxima semana",
    };
  }
  if (normalized.includes("proximos 7 dias") || normalized.includes("próximos 7 dias")) {
    const end = new Date(startOfToday);
    end.setDate(end.getDate() + 7);
    end.setMilliseconds(-1);
    return {
      startIso: startOfToday.toISOString().replace("Z", "-03:00"),
      endIso: end.toISOString().replace("Z", "-03:00"),
      label: "próximos 7 dias",
    };
  }
  if (isCalendarPeriodListPrompt(prompt)) {
    const end = new Date(startOfToday);
    end.setDate(end.getDate() + 7);
    end.setMilliseconds(-1);
    return {
      startIso: startOfToday.toISOString().replace("Z", "-03:00"),
      endIso: end.toISOString().replace("Z", "-03:00"),
      label: "próximos 7 dias",
    };
  }
  return undefined;
}

export function isCalendarPeriodListPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  const hasWeekday = includesAny(normalized, [
    "segunda",
    "terça",
    "terca",
    "quarta",
    "quinta",
    "sexta",
    "sábado",
    "sabado",
    "domingo",
  ]);
  return (
    includesAny(normalized, [
      "liste meus compromissos",
      "liste meus eventos",
      "quais compromissos tenho",
      "quais eventos tenho",
      "qual minha agenda",
      "qual a minha agenda",
      "como esta minha agenda",
      "como está minha agenda",
      "como esta a minha agenda",
      "como está a minha agenda",
      "o que tenho na agenda",
      "o que tenho de agenda",
      "o que tenho essa semana",
      "o que tenho esta semana",
      "o que tenho na proxima semana",
      "o que tenho na próxima semana",
      "minha agenda para",
      "minha agenda da",
      "minha agenda do",
      "mostre minha agenda",
      "mostrar minha agenda",
      "veja minha agenda",
      "veja o calendario",
      "veja o calendário",
      "analise o calendario",
      "analise o calendário",
      "agenda da",
      "agenda do",
    ]) &&
    !normalized.includes("calendario editorial") &&
    !normalized.includes("calendário editorial")
  ) || (
    hasWeekday
    && includesAny(normalized, ["agenda", "calendario", "calendário", "compromisso", "evento"])
    && !normalized.includes("calendario editorial")
    && !normalized.includes("calendário editorial")
  );
}

export function isCalendarConflictReviewPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "conflitos da agenda",
    "conflict",
    "duplicidades da agenda",
    "duplicidade da agenda",
    "eventos duplicados",
    "agenda duplicada",
    "sobreposicao de agenda",
    "sobreposição de agenda",
    "limpeza da agenda",
  ]);
}

export function isCalendarMovePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return /\b(?:mova|mover|reagende|reagendar|mude|mudar|altere|alterar|atualize|atualizar|ajuste|ajustar|edite|editar|renomeie|renomear)\b/i.test(normalized)
    && /\b(?:evento|compromisso|reuniao|reunião)\b/i.test(normalized);
}

export function isCalendarPeriodDeletePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "cancele meus compromissos",
    "cancele meus eventos",
    "cancele minha agenda",
    "exclua meus compromissos",
    "exclua meus eventos",
    "apague meus compromissos",
    "apague meus eventos",
    "remova meus compromissos",
    "remova meus eventos",
    "tire meus compromissos",
    "tire meus eventos",
    "limpe minha agenda",
  ]);
}

export function extractCalendarMoveParts(prompt: string): { verb: string; source: string; targetInstruction: string } | undefined {
  const patterns = [
    /\b(mova|mover|reagende|reagendar|mude|mudar|altere|alterar|atualize|atualizar|ajuste|ajustar|edite|editar|renomeie|renomear)\s+(?:(?:o|a|um|uma|meu|minha)\s+)?(?:evento|compromisso|reuniao|reunião)\s+(.+?)\s+(?:para|com)\s+([\s\S]+)/i,
    /\b(mova|mover|reagende|reagendar|mude|mudar|altere|alterar|atualize|atualizar|ajuste|ajustar|edite|editar|renomeie|renomear)\s+(?:(?:o|a|um|uma|meu|minha)\s+)?(?:evento|compromisso|reuniao|reunião)\s+(.+?)$/i,
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (!match?.[1] || !match?.[2]) {
      continue;
    }

    return {
      verb: match[1].trim(),
      source: match[2].trim(),
      targetInstruction: match[3]?.trim() ?? "",
    };
  }

  return undefined;
}

export function normalizeCalendarUpdateInstruction(input: {
  verb: string;
  targetInstruction: string;
}): string {
  const normalizedVerb = normalizeEmailAnalysisText(input.verb);
  const normalizedTarget = normalizeEmailAnalysisText(input.targetInstruction);

  if (includesAny(normalizedVerb, ["renomeie", "renomear"])) {
    return `titulo: ${input.targetInstruction.trim()}`;
  }

  const looksStructured = includesAny(normalizedTarget, [
    "titulo",
    "título",
    "nome",
    "local",
    "meet",
    "lembrete",
    "convid",
    "particip",
    "duracao",
    "duração",
    "sem local",
    "sem meet",
    "amanha",
    "amanhã",
    "hoje",
    "segunda",
    "terca",
    "terça",
    "quarta",
    "quinta",
    "sexta",
    "sabado",
    "sábado",
    "domingo",
  ]) || /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(normalizedTarget)
    || /\b\d{1,2}h\b/.test(normalizedTarget)
    || /\bdas\s+\d{1,2}/.test(normalizedTarget)
    || /@/.test(input.targetInstruction);

  if (!looksStructured) {
    return `titulo: ${input.targetInstruction.trim()}`;
  }

  return input.targetInstruction.trim();
}

export function isCalendarDeletePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  const hasDeleteVerb = includesAny(normalized, [
    "cancele",
    "cancela",
    "cancelar",
    "exclua",
    "excluir",
    "delete",
    "apague",
    "apagar",
    "remova",
    "remover",
    "tire",
    "tirar",
  ]);
  const hasCalendarObject = includesAny(normalized, [
    "evento",
    "compromisso",
    "agenda",
    "calendario",
    "calendário",
    "reuniao",
    "reunião",
  ]);
  return (hasDeleteVerb && hasCalendarObject)
    || (includesAny(normalized, ["nao vou mais", "não vou mais"]) && hasCalendarObject);
}

export function extractCalendarDeleteTopic(prompt: string): string | undefined {
  const patterns = [
    /\b(?:cancele|cancela|cancelar|exclua|excluir|delete|apague|apagar|remova|remover|tire|tirar)\s+(?:da\s+(?:minha\s+)?agenda\s+)?(?:o|a|os|as|meu|minha)?\s*(?:evento|compromisso|reuniao|reunião)?\s+["“]?(.+?)["”]?(?=(?:\s+amanh[ãa]|\s+hoje|\s+dia\s+\d|\s+em\s+\d{1,2}\/\d{1,2}|\s+na\s+conta\b|\s+no\s+calend[aá]rio\b|\s+na\s+agenda\b|\s+se\s+for\s+recorrent|\s+e\s+se\s+for\s+recorrent|\?|$))/i,
    /\b(?:nao vou mais|não vou mais)\s+(?:nesse|nessa|no|na|ao|a[oà])?\s*(?:evento|compromisso|reuniao|reunião)?\s*["“]?(.+?)["”]?(?=(?:\s+amanh[ãa]|\s+hoje|\s+dia\s+\d|\s+em\s+\d{1,2}\/\d{1,2}|\?|$))/i,
  ];
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    const topic = cleanCalendarEventTopicReference(match?.[1]);
    if (topic) {
      return topic;
    }
  }
  return undefined;
}

export function cleanCalendarEventTopicReference(value: string | undefined): string | undefined {
  const cleaned = value
    ?.trim()
    .replace(/\s+\bde\s+(?:amanh[ãa]|hoje)\b/gi, "")
    .replace(/\s+em\s+\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/gi, "")
    .replace(/\s+\b(?:amanh[ãa]|hoje)\b/gi, "")
    .replace(/\s+na\s+conta\s+\b(?:primary|principal|abordagem)\b.*$/gi, "")
    .replace(/\s+na\s+\b(?:agenda|abordagem)\b.*$/gi, "")
    .replace(/\s+no\s+calend[aá]rio\b.*$/gi, "")
    .replace(/\s+se\s+for\s+recorrent[ea].*$/gi, "")
    .replace(/\s+e\s+se\s+for\s+recorrent[ea].*$/gi, "")
    .replace(/\s+e\s+apague.*$/gi, "")
    .replace(/\bde$/i, "")
    .replace(/[?.!,;:]+$/g, "")
    .trim();

  if (!cleaned) {
    return undefined;
  }

  const normalized = normalizeEmailAnalysisText(cleaned);
  if ([
    "evento",
    "compromisso",
    "reuniao",
    "reunião",
    "agenda",
    "calendario",
    "calendário",
  ].includes(normalized)) {
    return undefined;
  }

  return cleaned;
}

export function matchesCalendarEventTopic(summary: string, topic: string): boolean {
  const normalizedSummary = normalizeEmailAnalysisText(summary);
  const normalizedTopic = normalizeEmailAnalysisText(topic);
  if (!normalizedSummary || !normalizedTopic) {
    return false;
  }
  if (normalizedSummary.includes(normalizedTopic)) {
    return true;
  }
  const topicTokens = normalizedTopic.split(/\s+/).filter((token) => token.length >= 3);
  return topicTokens.every((token) => normalizedSummary.includes(token));
}

export function extractExplicitAccountAlias(prompt: string, aliases: string[]): string | undefined {
  return extractExplicitGoogleAccountAlias(prompt, aliases);
}

export function resolvePromptAccountAliases(
  prompt: string,
  aliases: string[],
  defaultScope: PersonalOperationalProfile["defaultAgendaScope"] = "both",
): string[] {
  return resolveGoogleAccountAliasesForPrompt(prompt, aliases, defaultScope);
}

export function shouldSearchAllCalendars(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (includesAny(normalized, [
    "todos os calendarios",
    "todos os calendários",
    "todas as agendas",
    "todos os eventos",
    "todas as agendas conectadas",
  ])) {
    return true;
  }

  return normalized.includes("todas")
    && includesAny(normalized, ["agenda", "calendario", "calendário", "eventos", "compromissos"]);
}

export function resolveCalendarTargets(
  workspace: GoogleWorkspaceService,
  prompt: string,
): string[] {
  const explicitCalendarAlias = extractExplicitCalendarAlias(
    prompt,
    Object.keys(workspace.getCalendarAliases()),
  );
  if (explicitCalendarAlias) {
    return [explicitCalendarAlias];
  }

  if (!shouldSearchAllCalendars(prompt)) {
    return [workspace.resolveCalendarId()];
  }

  const calendars = workspace.listConfiguredCalendars()
    .filter((calendar) => calendar.selected !== false)
    .map((calendar) => calendar.id)
    .filter(Boolean);

  return calendars.length > 0 ? [...new Set(calendars)] : [workspace.resolveCalendarId()];
}

export function extractExplicitCalendarAlias(prompt: string, aliases: string[]): string | undefined {
  const normalized = normalizeEmailAnalysisText(prompt);
  for (const alias of aliases) {
    const readable = alias.replace(/_/g, " ");
    if (
      normalized.includes(`calendario ${readable}`) ||
      normalized.includes(`calendário ${readable}`) ||
      normalized.includes(`agenda ${readable}`) ||
      normalized.includes(`calendar ${readable}`) ||
      normalized === readable
    ) {
      return alias;
    }
  }

  return undefined;
}

export function extractEmailLookbackHours(prompt: string): number {
  const normalized = normalizeEmailAnalysisText(prompt);

  if (normalized.includes("hoje")) {
    return 24;
  }

  if (normalized.includes("ontem")) {
    return 48;
  }

  if (normalized.includes("esta semana") || normalized.includes("nessa semana")) {
    return 168;
  }

  if (normalized.includes("este mes") || normalized.includes("esse mes")) {
    return 720;
  }

  return 720;
}

export function extractEmailLookupCategory(prompt: string): EmailOperationalGroup | undefined {
  const normalized = normalizeEmailAnalysisText(prompt);

  if (normalized.includes("promocional") || normalized.includes("promocao") || normalized.includes("promo")) {
    return "promocional";
  }

  if (normalized.includes("financeiro") || normalized.includes("financeira")) {
    return "financeiro";
  }

  if (normalized.includes("seguranca")) {
    return "seguranca";
  }

  if (
    normalized.includes("email social") ||
    normalized.includes("categoria social") ||
    normalized.includes("social hoje")
  ) {
    return "social";
  }

  if (
    normalized.includes("email profissional") ||
    normalized.includes("categoria profissional") ||
    normalized.includes("email de trabalho") ||
    normalized.includes("trabalho")
  ) {
    return "profissional";
  }

  return undefined;
}

export function cleanSenderQuery(value: string): string {
  return value
    .trim()
    .replace(/^[\"'`]+|[\"'`]+$/g, "")
    .replace(/\s+(?:de hoje|hoje|de ontem|ontem|dessa semana|esta semana|não lido|nao lido).*$/i, "")
    .replace(/\s+e\s+(?:me|redija|gere|crie|fa[cç]a|resuma|envie|mostre|traga|entregue).*$/i, "")
    .replace(/[?.!,;:]+$/g, "")
    .replace(/^(o|a)\s+/i, "")
    .trim();
}

export function extractSenderQuery(prompt: string): string | undefined {
  const normalized = normalizeEmailAnalysisText(prompt);
  const patterns = [
    /(?:email|e-mail)(?:\s+mais\s+recente|\s+mais\s+novo|\s+ultimo|\s+último)?\s+(?:do|da|de)\s+(.+)/i,
    /(?:ultimo|último|mais recente)\s+email\s+(?:do|da|de)\s+(.+)/i,
    /(?:tem|tenho|ha|há|existe)\s+email\s+(?:do|da|de)\s+(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    const cleaned = cleanSenderQuery(match?.[1] ?? "");
    const normalizedCandidate = normalizeEmailAnalysisText(cleaned);
    if (
      cleaned &&
      !["social", "profissional", "promocional", "promocao", "financeiro", "seguranca"].includes(
        normalizedCandidate,
      )
    ) {
      return cleaned;
    }
  }

  for (const token of ["linkedin", "renner", "supabase", "google", "github", "vercel", "cloudflare"]) {
    if (normalized.includes(token)) {
      return token;
    }
  }

  return undefined;
}

export function extractEmailLookupRequest(prompt: string): EmailLookupRequest | undefined {
  if (extractEmailUidFromPrompt(prompt) !== undefined || !isEmailFocusedPrompt(prompt)) {
    return undefined;
  }

  const normalized = normalizeEmailAnalysisText(prompt);
  const senderQuery = extractSenderQuery(prompt);
  const category = extractEmailLookupCategory(prompt);
  const existenceOnly =
    normalized.includes("tem email") ||
    normalized.includes("tenho email") ||
    normalized.includes("ha email") ||
    normalized.includes("existe email");
  const latestIntent =
    existenceOnly ||
    [
      "ultimo email",
      "último email",
      "mais recente",
      "me traga",
      "me entregue",
      "mostre",
      "leia",
      "resuma",
    ].some((token) => normalized.includes(token));

  if (!latestIntent && !senderQuery && !category) {
    return undefined;
  }

  return {
    senderQuery,
    category,
    unreadOnly: normalized.includes("nao lido") || normalized.includes("não lido"),
    sinceHours: extractEmailLookbackHours(prompt),
    existenceOnly,
  };
}

export function extractDisplayName(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const bracketIndex = trimmed.indexOf("<");
  const base = bracketIndex >= 0 ? trimmed.slice(0, bracketIndex).trim() : trimmed;
  if (!base || base.includes("@")) {
    return undefined;
  }
  return base;
}

export function inferReplyContext(
  userPrompt: string,
  emailSubject: string,
  emailText: string,
): "pessoal" | "profissional_dev" | "profissional_social" | "autonomo" | "geral" {
  const normalized = `${userPrompt}\n${emailSubject}\n${emailText}`.toLowerCase();

  if (normalized.includes("pessoal")) {
    return "pessoal";
  }

  if (
    ["social", "serviço social", "servico social", "educador", "projeto social", "comunidade"].some((token) =>
      normalized.includes(token),
    )
  ) {
    return "profissional_social";
  }

  if (
    ["autonomo", "autônomo", "cliente", "orçamento", "orcamento", "proposta comercial", "freela"].some((token) =>
      normalized.includes(token),
    )
  ) {
    return "autonomo";
  }

  if (
    ["dev", "saas", "micro-saas", "automação", "automacao", "mvp", "api", "software", "produto digital"].some((token) =>
      normalized.includes(token),
    )
  ) {
    return "profissional_dev";
  }

  return "geral";
}

export function hasAffirmativeIntent(userPrompt: string): boolean {
  const normalized = userPrompt
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

  return [
    "sim, quero",
    "sim quero",
    "quero sim",
    "resposta afirmativa",
    "afirmativa",
    "aceitar",
    "aceite",
    "positivo",
    "tenho interesse",
    "aceito",
    "quero conversar",
  ].some((token) => normalized.includes(token));
}

export function hasRejectionIntent(userPrompt: string): boolean {
  const normalized = userPrompt
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

  return [
    "rejeite",
    "rejeitando",
    "recuse",
    "recusando",
    "decline",
    "declinar",
    "nao tenho interesse",
    "não tenho interesse",
    "nao quero",
    "não quero",
  ].some((token) => normalized.includes(token));
}

export function extractToneHint(
  userPrompt: string,
): "formal" | "informal" | "polida" | "rude" | "neutra" {
  const normalized = userPrompt
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

  if (normalized.includes("rude") || normalized.includes("grosseira") || normalized.includes("grosso")) {
    return "rude";
  }
  if (normalized.includes("informal")) {
    return "informal";
  }
  if (normalized.includes("formal")) {
    return "formal";
  }
  if (normalized.includes("polida") || normalized.includes("educada")) {
    return "polida";
  }
  return "neutra";
}

export function buildAffirmativeReplyTemplate(input: {
  recipientName?: string;
  context: "pessoal" | "profissional_dev" | "profissional_social" | "autonomo" | "geral";
  tone: "formal" | "informal" | "polida" | "rude" | "neutra";
}): string {
  const greeting = input.tone === "informal"
    ? input.recipientName
      ? `Oi, ${input.recipientName},`
      : "Oi,"
    : input.recipientName
      ? `Olá, ${input.recipientName},`
      : "Olá,";
  const closing = input.tone === "informal" ? "Abraço." : "Fico à disposição.";

  if (input.tone === "rude") {
    return [
      greeting,
      "",
      "Sim, tenho interesse, mas preciso objetividade.",
      "",
      "Se quiser seguir, envie sua disponibilidade e os pontos centrais sem rodeios. A conversa só faz sentido se vier com clareza e direção prática.",
      "",
      closing,
    ].join("\n");
  }

  if (input.context === "profissional_dev") {
    return [
      greeting,
      "",
      "Sim, tenho interesse em conversar sobre essa oportunidade.",
      "",
      "O tema faz sentido e vejo espaço para avançarmos com uma proposta objetiva, definindo escopo inicial, prioridades e um caminho enxuto para validação do micro-SaaS.",
      "",
      "Se estiver de acordo, me envie sua disponibilidade e os principais objetivos que você quer acelerar. Assim eu consigo chegar na conversa com uma direção clara e próximos passos práticos.",
      "",
      closing,
    ].join("\n");
  }

  if (input.context === "profissional_social") {
    return [
      greeting,
      "",
      "Sim, tenho interesse em conversar sobre essa proposta.",
      "",
      "Acredito que vale avançarmos com uma conversa objetiva para entender melhor a demanda, alinhar expectativas e definir os próximos passos de forma responsável.",
      "",
      "Se estiver de acordo, me envie sua disponibilidade e os pontos que considera prioritários. Assim eu consigo me preparar melhor para a conversa.",
      "",
      closing,
    ].join("\n");
  }

  if (input.context === "autonomo") {
    return [
      greeting,
      "",
      "Sim, tenho interesse em seguir com essa conversa.",
      "",
      "Consigo avançar com uma proposta objetiva, alinhando escopo inicial, forma de entrega e próximos passos para validação.",
      "",
      "Se estiver de acordo, me envie sua disponibilidade e o principal resultado que você espera alcançar. Assim eu consigo estruturar a conversa com mais precisão.",
      "",
      closing,
    ].join("\n");
  }

  if (input.context === "pessoal") {
    return [
      greeting,
      "",
      "Sim, quero conversar sobre isso.",
      "",
      "Acho que vale avançarmos com calma e alinhar melhor os detalhes para entender o melhor caminho.",
      "",
      "Se puder, me envie sua disponibilidade para continuarmos a conversa.",
      "",
      closing,
    ].join("\n");
  }

  return [
    greeting,
    "",
    "Sim, tenho interesse em conversar sobre isso.",
    "",
    "Se estiver de acordo, me envie sua disponibilidade e os principais pontos que você considera importantes para seguirmos com os próximos passos.",
    "",
    closing,
  ].join("\n");
}

export function buildRejectionReplyTemplate(input: {
  recipientName?: string;
  tone: "formal" | "informal" | "polida" | "rude" | "neutra";
}): string {
  const greeting = input.tone === "informal"
    ? input.recipientName
      ? `Oi, ${input.recipientName},`
      : "Oi,"
    : input.recipientName
      ? `Olá, ${input.recipientName},`
      : "Olá,";

  if (input.tone === "rude") {
    return [
      greeting,
      "",
      "Não tenho interesse em seguir com isso.",
      "",
      "Peço que não insista nesse tema.",
    ].join("\n");
  }

  if (input.tone === "informal") {
    return [
      greeting,
      "",
      "Obrigado pelo contato, mas não vou seguir com isso agora.",
      "",
      "De todo modo, agradeço a mensagem.",
    ].join("\n");
  }

  return [
    greeting,
    "",
    "Agradeço o contato e a proposta, mas neste momento não tenho interesse em avançar.",
    "",
    "Obrigado pela compreensão.",
  ].join("\n");
}

export interface InboxTriageItem {
  uid: string;
  date: string | null;
  subject: string;
  from: string[];
  category: string;
  relationship: string;
  persona: string;
  policy: string;
  priority: "alta" | "media" | "baixa";
  status: string;
  action: string;
}

export function extractEmailIdentifier(from: string[]): string | undefined {
  const combined = from.join(" ");
  const match = combined.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.toLowerCase();
}

export function buildEmailSummaryReply(input: {
  uid: string;
  subject: string;
  from: string[];
  summary: EmailOperationalSummary;
  routing?: {
    relationship: string;
    persona: string;
    policy: string;
  };
}): string {
  return [
    `Resumo do email UID ${input.uid}`,
    `- Tipo: ${input.summary.category}`,
    ...(input.routing
      ? [
          `- Relação: ${input.routing.relationship}`,
          `- Persona: ${input.routing.persona}`,
          `- Política: ${input.routing.policy}`,
        ]
      : []),
    `- Prioridade: ${input.summary.priority}`,
    `- Status: ${input.summary.status}`,
    `- Remetente: ${input.from.join(", ") || "(desconhecido)"}`,
    `- Assunto: ${input.subject || "(sem assunto)"}`,
    `- Resumo: ${input.summary.summary}`,
    `- Próxima ação: ${input.summary.action}`,
  ].join("\n");
}

export function formatEmailTimestamp(date: string | null): string {
  return date ?? "(data desconhecida)";
}

export function matchesSenderQuery(message: EmailMessageSummary, senderQuery: string): boolean {
  const haystack = normalizeEmailAnalysisText(
    `${message.subject}\n${message.from.join(" ")}\n${message.preview}`,
  );
  const query = normalizeEmailAnalysisText(senderQuery);
  const tokens = query.split(/\s+/).filter((token) => token.length >= 2);
  return tokens.length > 0 ? tokens.every((token) => haystack.includes(token)) : haystack.includes(query);
}

export function buildEmailLookupLabel(request: EmailLookupRequest): string {
  if (request.senderQuery && request.category) {
    return `"${request.senderQuery}" na categoria ${request.category}`;
  }

  if (request.senderQuery) {
    return `"${request.senderQuery}"`;
  }

  if (request.category) {
    return `categoria ${request.category}`;
  }

  return "filtro informado";
}

export function buildEmailLookupMissReply(request: EmailLookupRequest): string {
  return [
    `Não encontrei emails recentes para ${buildEmailLookupLabel(request)}.`,
    `Janela analisada: ${request.sinceHours} horas.`,
    request.unreadOnly ? "Filtro aplicado: somente não lidos." : "Filtro aplicado: lidos e não lidos.",
  ].join("\n");
}

export function buildEmailLookupReply(input: {
  resolved: ResolvedEmailReference & { message: EmailMessageSummary };
  summary: EmailOperationalSummary;
}): string {
  const intro = input.resolved.request.existenceOnly
    ? `Sim. Encontrei ${input.resolved.totalMatches} email(s) recente(s) para ${input.resolved.label}.`
    : `Encontrei ${input.resolved.totalMatches} email(s) recente(s) para ${input.resolved.label}.`;

  return [
    intro,
    "",
    "Mais recente:",
    `- Remetente: ${input.resolved.message.from.join(", ") || "(desconhecido)"}`,
    `- Assunto: ${input.resolved.message.subject || "(sem assunto)"}`,
    `- Recebido em: ${formatEmailTimestamp(input.resolved.message.date)}`,
    `- Tipo: ${input.summary.category}`,
    `- Prioridade: ${input.summary.priority}`,
    `- Status: ${input.summary.status}`,
    `- Próxima ação: ${input.summary.action}`,
    `- Prévia: ${input.resolved.message.preview || "(sem prévia textual)"}`,
  ].join("\n");
}

export function buildCalendarLookupReply(input: {
  request: CalendarLookupRequest;
  eventMatches: Array<{
    account: string;
    summary: string;
    start: string | null;
    location?: string;
    htmlLink?: string;
  }>;
  emailMatches: Array<{
    account: string;
    uid: string;
    subject: string;
    from: string[];
    date: string | null;
  }>;
  timezone: string;
  suggestNextStep: boolean;
}): string {
  const targetLabel = input.request.targetDate?.label ?? "janela informada";
  const topicLabel = input.request.topic ? ` sobre ${input.request.topic}` : "";

  if (input.eventMatches.length > 0) {
    const first = input.eventMatches[0];
    const lines = [
      `Encontrei ${input.eventMatches.length} evento(s)${topicLabel} em ${targetLabel}.`,
      `Mais relevante: ${formatBriefDateTime(first.start, input.timezone)} | ${first.summary}${summarizeCalendarLocation(first.location) ? ` | ${summarizeCalendarLocation(first.location)}` : ""} | conta: ${first.account}`,
    ];
    if (input.suggestNextStep && input.eventMatches.length > 1) {
      lines.push("Próxima ação recomendada: revisar os demais eventos do mesmo dia para confirmar conflito ou contexto.");
    }
    return lines.join("\n");
  }

  const lines = [
    `Não encontrei evento${topicLabel} em ${targetLabel} nas contas Google conectadas.`,
  ];

  if (input.emailMatches.length > 0) {
    const latestEmail = input.emailMatches[0];
    lines.push(
      `Encontrei ${input.emailMatches.length} email(s) relacionado(s)${topicLabel}. Mais recente: ${latestEmail.subject || "(sem assunto)"} | ${latestEmail.from.join(", ") || "(remetente desconhecido)"} | conta: ${latestEmail.account}.`,
    );
    if (input.suggestNextStep) {
      lines.push("Próxima ação recomendada: abrir o email mais recente para confirmar data, horário ou convite.");
    }
    return lines.join("\n");
  }

  if (input.suggestNextStep) {
    lines.push("Próxima ação recomendada: verificar outras contas/calendários ou buscar convites por palavra-chave no email.");
  }
  return lines.join("\n");
}

export function formatBriefDateTime(value: string | null, timezone: string): string {
  if (!value) {
    return "(sem horario)";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatCalendarDayHeader(value: string | null, timezone: string): string {
  if (!value) {
    return "(sem dia)";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const weekday = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    weekday: "long",
  }).format(date);
  const dayMonth = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
  }).format(date);

  return `${weekday[0]?.toUpperCase() ?? ""}${weekday.slice(1)}, ${dayMonth}`;
}

export function formatCalendarTimeRange(
  start: string | null | undefined,
  end: string | null | undefined,
  timezone: string,
): string {
  if (!start) {
    return "sem horário";
  }

  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) {
    return start;
  }

  const startLabel = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(startDate);

  if (!end) {
    return startLabel;
  }

  const endDate = new Date(end);
  if (Number.isNaN(endDate.getTime())) {
    return startLabel;
  }

  const endLabel = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(endDate);

  return `${startLabel}–${endLabel}`;
}

export function formatTaskDue(task: TaskSummary, timezone: string): string {
  return formatBriefDateTime(task.due ?? task.updated, timezone);
}

export function truncateBriefText(value: string | null | undefined, maxLength = 72): string {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "(sem detalhe)";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

export function summarizeEmailSender(from: string[]): string {
  const primary = from.find((item) => item.trim())?.trim();
  if (!primary) {
    return "(remetente desconhecido)";
  }

  const match = primary.match(/^(.*?)\s*<[^>]+>$/);
  const label = match?.[1]?.replace(/^"+|"+$/g, "").trim() || primary;
  return truncateBriefText(label, 28);
}

export function isOperationalNoise(value: string | null | undefined): boolean {
  const normalized = normalizeEmailAnalysisText(value ?? "");
  if (!normalized) {
    return false;
  }

  return includesAny(normalized, [
    "teste controlado",
    "shopee",
    "lojas oficiais",
    "newsletter",
    "digest",
    "read online",
    "renegocia aqui",
    "oferta do dia",
    "cupom",
    "liquidacao",
    "sale",
  ]);
}

export interface MorningBriefEmailItem {
  account: string;
  uid: string;
  subject: string;
  from: string[];
  priority: string;
  action: string;
  relationship: string;
  group: EmailOperationalGroup;
}

export interface MorningTaskBuckets {
  today: Array<TaskSummary & { account: string }>;
  overdue: Array<TaskSummary & { account: string }>;
  stale: Array<TaskSummary & { account: string }>;
  actionableCount: number;
}

export function getBriefDayKey(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";
  return `${year}-${month}-${day}`;
}

export function diffDayKeys(left: string, right: string): number {
  const leftDate = new Date(`${left}T00:00:00Z`);
  const rightDate = new Date(`${right}T00:00:00Z`);
  return Math.round((leftDate.getTime() - rightDate.getTime()) / (24 * 60 * 60 * 1000));
}

export function classifyMorningTaskBucket(
  task: TaskSummary & { account: string },
  timezone: string,
): "today" | "overdue" | "stale" {
  const nowKey = getBriefDayKey(new Date(), timezone);
  const dueDate = task.due ? new Date(task.due) : null;

  if (dueDate) {
    const dueKey = getBriefDayKey(dueDate, timezone);
    if (dueKey === nowKey) {
      return "today";
    }
    if (dueKey < nowKey) {
      return diffDayKeys(nowKey, dueKey) > 7 ? "stale" : "overdue";
    }
    return "today";
  }

  const updatedDate = task.updated ? new Date(task.updated) : null;
  if (!updatedDate) {
    return "today";
  }

  const updatedKey = getBriefDayKey(updatedDate, timezone);
  return diffDayKeys(nowKey, updatedKey) > 14 ? "stale" : "today";
}

export function buildMorningTaskBuckets(
  tasks: Array<TaskSummary & { account: string }>,
  timezone: string,
): MorningTaskBuckets {
  const sorted = [...tasks].sort((left, right) =>
    (left.due ?? left.updated ?? "").localeCompare(right.due ?? right.updated ?? ""),
  );
  const buckets: MorningTaskBuckets = {
    today: [],
    overdue: [],
    stale: [],
    actionableCount: 0,
  };

  for (const task of sorted) {
    const bucket = classifyMorningTaskBucket(task, timezone);
    buckets[bucket].push(task);
  }

  buckets.actionableCount = buckets.today.length + buckets.overdue.length;
  return buckets;
}

export function describeFounderSectionStatus(section: FounderOpsSnapshot["sections"][number]): string {
  const statusLabel = section.status === "connected" ? "conectado" : "aguardando integração";
  return `${section.title}: ${statusLabel} — ${section.summary}`;
}

export function summarizeTrackedMetrics(metrics: string[]): string {
  if (metrics.length === 0) {
    return "";
  }

  const visible = metrics.slice(0, 6).join(", ");
  const hidden = metrics.length - 6;
  return hidden > 0 ? `${visible} e mais ${hidden}` : visible;
}

export function labelBriefOwner(owner: "paulo" | "equipe" | "delegavel"): string {
  switch (owner) {
    case "paulo":
      return "Paulo";
    case "equipe":
      return "Equipe";
    case "delegavel":
      return "Delegável";
  }
}

export function formatBriefTemperature(value?: number): string {
  return typeof value === "number" ? `${Math.round(value)}°C` : "?";
}

export function formatBriefTemperatureRange(min?: number, max?: number): string {
  if (typeof min === "number" && typeof max === "number") {
    return `${Math.round(min)}° a ${Math.round(max)}°C`;
  }
  if (typeof max === "number") {
    return `máx ${Math.round(max)}°C`;
  }
  if (typeof min === "number") {
    return `mín ${Math.round(min)}°C`;
  }
  return "?";
}

export function emailRelationshipWeight(relationship: string): number {
  switch (relationship) {
    case "family":
    case "partner":
    case "client":
    case "lead":
    case "social_case":
      return 18;
    case "colleague":
    case "vendor":
      return 10;
    case "friend":
      return 8;
    case "unknown":
      return 2;
    case "spam":
      return -50;
    default:
      return 0;
  }
}

export function chooseMorningNextAction(input: {
  timezone: string;
  events: Array<{ summary: string; start: string | null }>;
  taskBuckets: MorningTaskBuckets;
  emails: MorningBriefEmailItem[];
  approvals: Array<{ subject: string; actionKind: string; channel: string }>;
  workflows: Array<{ id: number; title: string; status: string; nextAction: string | null }>;
  focus: Array<{ title: string; nextAction: string }>;
}): string | undefined {
  const candidates: Array<{ score: number; text: string }> = [];
  const nextEvent = input.events[0];
  if (nextEvent?.start) {
    const minutesUntil = Math.round((new Date(nextEvent.start).getTime() - Date.now()) / (60 * 1000));
    const eventScore = minutesUntil <= 45
      ? 100
      : minutesUntil <= 120
        ? 94
        : minutesUntil <= 240
          ? 84
          : 70;
    candidates.push({
      score: eventScore,
      text: `Preparar o compromisso das ${formatBriefDateTime(nextEvent.start, input.timezone)}: ${truncateBriefText(nextEvent.summary, 52)}.`,
    });
  }

  const topEmail = input.emails[0];
  if (topEmail) {
    const baseScore = topEmail.priority === "alta" ? 88 : 66;
    const groupBoost = topEmail.group === "seguranca" ? 12 : topEmail.group === "financeiro" ? 8 : 0;
    candidates.push({
      score: baseScore + groupBoost + emailRelationshipWeight(topEmail.relationship),
      text: `Responder ou validar o email prioritário: ${truncateBriefText(topEmail.subject || "(sem assunto)", 56)}.`,
    });
  }

  const overdueTask = input.taskBuckets.overdue[0];
  if (overdueTask) {
    candidates.push({
      score: 86,
      text: `Destravar a tarefa atrasada: ${truncateBriefText(overdueTask.title, 56)}.`,
    });
  }

  const todayTask = input.taskBuckets.today[0];
  if (todayTask) {
    candidates.push({
      score: 72,
      text: `Atacar a tarefa de hoje: ${truncateBriefText(todayTask.title, 56)}.`,
    });
  }

  if (input.approvals.length > 0) {
    candidates.push({
      score: 55 + Math.min(12, input.approvals.length * 2),
      text: `Revisar a aprovação mais urgente no Telegram: ${truncateBriefText(input.approvals[0].subject, 56)}.`,
    });
  }

  if (input.workflows[0]?.nextAction) {
    candidates.push({
      score: 36,
      text: truncateBriefText(input.workflows[0].nextAction, 96),
    });
  }

  if (input.focus[0]?.nextAction) {
    candidates.push({
      score: 28,
      text: truncateBriefText(input.focus[0].nextAction, 96),
    });
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.text;
}

export function buildOperationalBriefReply(input: {
  brief: DailyOperationalBrief;
  focus: Array<{ title: string; whyNow: string; nextAction: string }>;
}): string {
  const nextEvent = input.brief.events[0];
  const nextTask = input.brief.tasks[0];
  const lines = [
    `Hoje teu dia tem ${input.brief.events.length} ${input.brief.events.length === 1 ? "compromisso" : "compromissos"}, ${input.brief.tasks.length} ${input.brief.tasks.length === 1 ? "tarefa" : "tarefas"} e ${input.focus.length} ${input.focus.length === 1 ? "frente em foco" : "frentes em foco"}.`,
  ];

  if (nextEvent) {
    lines.push(`O próximo compromisso é ${formatBriefDateTime(nextEvent.start, input.brief.timezone)} — ${nextEvent.summary}${nextEvent.location ? ` — ${nextEvent.location}` : ""}.`);
  }
  if (nextTask) {
    lines.push(`A tarefa que mais pede atenção agora é ${nextTask.title} — ${formatTaskDue(nextTask, input.brief.timezone)}.`);
  }
  if (input.focus[0]) {
    lines.push(`Teu foco agora é ${input.focus[0].title} — ${input.focus[0].nextAction}.`);
  }

  if (!nextEvent && !nextTask && input.focus.length === 0) {
    lines.push("Hoje está mais leve até aqui.");
  }

  if (input.brief.events.length > 0) {
    lines.push("", "Agenda mais próxima:");
    for (const event of input.brief.events.slice(0, 4)) {
      lines.push(
        `- ${formatBriefDateTime(event.start, input.brief.timezone)} — ${event.summary}${event.location ? ` — ${event.location}` : ""}`,
      );
    }
  }

  if (input.brief.tasks.length > 0) {
    lines.push("", "Tarefas que valem olhar:");
    for (const task of input.brief.tasks.slice(0, 4)) {
      lines.push(`- ${task.title} — ${task.taskListTitle} — ${formatTaskDue(task, input.brief.timezone)}`);
    }
  }

  if (input.focus.length > 1) {
    lines.push("", "Outras frentes:");
    for (const item of input.focus.slice(0, 3)) {
      lines.push(`- ${item.title} — ${item.nextAction}`);
    }
  }

  return lines.join("\n");
}

export function classifyBriefPeriod(iso: string | null | undefined, timezone: string): "manha" | "tarde" | "noite" | "sem_horario" {
  if (!iso) {
    return "sem_horario";
  }
  const local = new Date(new Date(iso).toLocaleString("en-US", { timeZone: timezone }));
  const hour = local.getHours();
  if (hour < 12) {
    return "manha";
  }
  if (hour < 18) {
    return "tarde";
  }
  return "noite";
}

export function buildMorningBriefReply(
  input: ExecutiveMorningBrief,
  options?: {
    compact?: boolean;
    profile?: PersonalOperationalProfile;
    operationalMode?: "field" | null;
  },
): string {
  const renderer = new BriefRenderer();
  if (options?.compact === true || options?.operationalMode === "field") {
    return renderer.renderCompact(input);
  }
  return renderer.render(input);
}

export function buildMacQueueStatusReply(input: {
  status: {
    enabled: boolean;
    configured: boolean;
    ready: boolean;
    targetHost: string;
    commandsTable: string;
    workersTable: string;
    message: string;
  };
}): string {
  return [
    "Status da fila remota do Mac:",
    `- Enabled: ${input.status.enabled ? "sim" : "não"}`,
    `- Configurada: ${input.status.configured ? "sim" : "não"}`,
    `- Pronta: ${input.status.ready ? "sim" : "não"}`,
    `- Target host: ${input.status.targetHost}`,
    `- Tabela de comandos: ${input.status.commandsTable}`,
    `- Tabela de workers: ${input.status.workersTable}`,
    `- Mensagem: ${input.status.message}`,
  ].join("\n");
}

export function buildMacQueueListReply(items: Array<{ id: string; summary: string; status: string; createdAt: string }>): string {
  if (items.length === 0) {
    return "Não encontrei comandos pendentes na fila do Mac.";
  }

  return [
    `Comandos pendentes na fila do Mac: ${items.length}.`,
    ...items.map((item) => `- ${item.summary} | status: ${item.status} | id: ${item.id}`),
  ].join("\n");
}

export function buildMacQueueEnqueueReply(input: { id: string; summary: string; targetHost?: string }): string {
  return [
    "Comando enfileirado para o Mac.",
    `- Resumo: ${input.summary}`,
    `- ID: ${input.id}`,
    `- Target host: ${input.targetHost ?? "atlas_mac"}`,
  ].join("\n");
}

export function buildGoogleTasksReply(input: {
  timezone: string;
  tasks: Array<TaskSummary & { account: string }>;
}): string {
  if (input.tasks.length === 0) {
    return "Nao encontrei tarefas abertas no Google Tasks para os filtros atuais.";
  }

  return [
    `Tarefas do Google encontradas: ${input.tasks.length}.`,
    ...input.tasks.slice(0, 12).map((task) =>
      `- ${task.title || "(sem titulo)"} (${task.taskListTitle}) | conta: ${task.account} | status: ${task.status} | prazo: ${formatTaskDue(task, input.timezone)}`,
    ),
  ].join("\n");
}

export function buildGoogleContactsReply(input: {
  query: string;
  contacts: Array<{
    account: string;
    displayName: string;
    emailAddresses: string[];
    phoneNumbers: string[];
    organizations: string[];
  }>;
}): string {
  if (input.contacts.length === 0) {
    return `Nao encontrei contatos no Google para a busca: ${input.query}.`;
  }

  return [
    `Contatos encontrados para "${input.query}": ${input.contacts.length}.`,
    ...input.contacts.slice(0, 10).map((contact) =>
      `- ${contact.displayName} | conta: ${contact.account}${contact.phoneNumbers.length ? ` | telefones: ${contact.phoneNumbers.join(", ")}` : ""}${contact.emailAddresses.length ? ` | emails: ${contact.emailAddresses.join(", ")}` : ""}${contact.organizations.length ? ` | orgs: ${contact.organizations.join(", ")}` : ""}`,
    ),
  ].join("\n");
}

export function buildGoogleCalendarsReply(input: {
  calendars: Array<{ account: string; calendars: CalendarListSummary[] }>;
}): string {
  const total = input.calendars.reduce((acc, item) => acc + item.calendars.length, 0);
  if (total === 0) {
    return "Não encontrei calendários disponíveis nas contas Google conectadas.";
  }

  const lines = [`Calendários disponíveis: ${total}.`];
  for (const group of input.calendars) {
    lines.push(`Conta ${group.account}: ${group.calendars.length}.`);
    for (const calendar of group.calendars.slice(0, 12)) {
      const tags = [
        calendar.primary ? "principal" : undefined,
        calendar.selected ? "visível" : undefined,
        calendar.accessRole ? `acesso: ${calendar.accessRole}` : undefined,
      ].filter(Boolean);
      lines.push(`- ${calendar.summary} | id: ${calendar.id}${tags.length ? ` | ${tags.join(" | ")}` : ""}`);
    }
  }
  return lines.join("\n");
}

export function labelAgendaScope(scope: PersonalOperationalProfile["defaultAgendaScope"]): string {
  switch (scope) {
    case "primary":
      return "principal";
    case "work":
      return "trabalho";
    case "both":
    default:
      return "ambos";
  }
}

export function buildEmptyCalendarPeriodReply(label: string): string {
  const normalized = normalizeEmailAnalysisText(label);
  if (normalized === "amanha" || normalized === "amanhã") {
    return "Nenhum compromisso para amanhã.";
  }
  if (normalized === "hoje") {
    return "Nenhum compromisso para hoje.";
  }
  return `Nenhum compromisso em ${label}.`;
}

export function buildCalendarPeriodReply(input: {
  label: string;
  timezone: string;
  compact?: boolean;
  events: Array<{
    account: string;
    event: Awaited<ReturnType<GoogleWorkspaceService["listEventsInWindow"]>>[number];
  }>;
}): string {
  if (input.events.length === 0) {
    return buildEmptyCalendarPeriodReply(input.label);
  }

  const sortedEvents = [...input.events].sort((left, right) => {
    const leftStart = left.event.start ? Date.parse(left.event.start) : Number.MAX_SAFE_INTEGER;
    const rightStart = right.event.start ? Date.parse(right.event.start) : Number.MAX_SAFE_INTEGER;
    if (leftStart !== rightStart) {
      return leftStart - rightStart;
    }
    return left.event.summary.localeCompare(right.event.summary);
  });

  const lines = [
    `${input.label[0]?.toUpperCase() ?? ""}${input.label.slice(1)}: ${sortedEvents.length} compromisso${sortedEvents.length > 1 ? "s" : ""}.`,
  ];
  let currentDayHeader: string | null = null;

  for (const item of sortedEvents) {
    const dayHeader = formatCalendarDayHeader(item.event.start, input.timezone);
    if (dayHeader !== currentDayHeader) {
      lines.push("", `${dayHeader}:`);
      currentDayHeader = dayHeader;
    }

    const location = summarizeCalendarLocation(item.event.location);
    const tags = input.compact
      ? []
      : [`conta: ${item.account}`];

    lines.push(
      `- ${formatCalendarTimeRange(item.event.start, item.event.end, input.timezone)} — ${item.event.summary}${location ? ` — ${location}` : ""}${tags.length > 0 ? ` | ${tags.join(" | ")}` : ""}`,
    );
  }

  return lines.join("\n");
}

export function summarizeCalendarLocation(value: string | undefined): string | undefined {
  const normalized = value
    ?.replace(/\s*\n+\s*/g, " | ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return undefined;
  }
  const compact = normalized.split(" | ")[0]?.trim() || normalized;
  return compact.length > 72 ? `${compact.slice(0, 69)}...` : compact;
}
