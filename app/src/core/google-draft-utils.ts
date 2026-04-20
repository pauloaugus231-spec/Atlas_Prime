export interface PendingGoogleTaskDraft {
  kind: "google_task";
  title: string;
  notes?: string;
  due?: string;
  taskListId?: string;
  taskId?: string;
  account?: string;
}

export interface PendingGoogleEventDraftBase {
  summary: string;
  description?: string;
  location?: string;
  attendees?: string[];
  start: string;
  end: string;
  timezone: string;
  calendarId?: string;
  account?: string;
  reminderMinutes?: number;
  createMeet?: boolean;
}

export interface PendingGoogleEventDraft extends PendingGoogleEventDraftBase {
  kind: "google_event";
}

export interface PendingGoogleEventDeleteDraft {
  kind: "google_event_delete";
  eventId: string;
  summary: string;
  description?: string;
  location?: string;
  start?: string;
  end?: string;
  timezone: string;
  calendarId?: string;
  account?: string;
  reminderMinutes?: number;
}

export interface PendingGoogleEventUpdateDraft extends PendingGoogleEventDraftBase {
  kind: "google_event_update";
  eventId: string;
  originalSummary?: string;
  originalStart?: string;
  originalEnd?: string;
  originalLocation?: string;
}

export type PendingGoogleEventLikeDraft = PendingGoogleEventDraft | PendingGoogleEventUpdateDraft;

export interface PendingGoogleEventDeleteBatchDraft {
  kind: "google_event_delete_batch";
  timezone: string;
  events: Array<{
    eventId: string;
    summary: string;
    start?: string;
    end?: string;
    calendarId?: string;
    account?: string;
  }>;
}

export interface PendingGoogleEventImportBatchItem extends PendingGoogleEventDraftBase {
  personallyRelevant?: boolean;
  matchedTerms?: string[];
  sourceLabel?: string;
  confidence?: number;
  originalSummary?: string;
  importCategory?: "event_importable" | "informational" | "demand" | "holiday" | "ambiguous";
  relevanceLevel?: "high" | "medium" | "low";
  shift?: "manhã" | "tarde" | "integral";
  assumedTime?: boolean;
  structuralEvent?: boolean;
  reviewWarning?: string;
}

export interface PendingGoogleEventImportBatchIgnoredItem {
  summary: string;
  category: "informational" | "demand" | "holiday" | "ambiguous";
  reason: string;
  date?: string;
  shift?: string;
  sourceLabel?: string;
  relevanceLevel?: "high" | "medium" | "low";
}

export interface PendingGoogleEventImportBatchDraft {
  kind: "google_event_import_batch";
  timezone: string;
  account?: string;
  calendarId?: string;
  sourceLabel?: string;
  totalExtracted?: number;
  relevantCount?: number;
  skippedCount?: number;
  assumptions?: string[];
  importMode?: "self_only" | "self_plus_structural" | "full_block";
  allImportableEvents?: PendingGoogleEventImportBatchItem[];
  ignoredItems?: PendingGoogleEventImportBatchIgnoredItem[];
  demands?: PendingGoogleEventImportBatchIgnoredItem[];
  ambiguousItems?: PendingGoogleEventImportBatchIgnoredItem[];
  blockCounts?: {
    total: number;
    event_importable: number;
    informational: number;
    demand: number;
    holiday: number;
    ambiguous: number;
  };
  modeCounts?: {
    self_only: number;
    self_plus_structural: number;
    full_block: number;
  };
  events: PendingGoogleEventImportBatchItem[];
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function includesAny(source: string, tokens: string[]): boolean {
  return tokens.some((token) => source.includes(token));
}

function getNowParts(timeZone: string): { year: number; month: number; day: number; weekday: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = formatter.formatToParts(new Date());
  const raw = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdayMap: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };

  return {
    year: Number.parseInt(raw.year ?? "0", 10),
    month: Number.parseInt(raw.month ?? "0", 10),
    day: Number.parseInt(raw.day ?? "0", 10),
    weekday: weekdayMap[(raw.weekday ?? "").slice(0, 3).toLowerCase()] ?? 0,
  };
}

function shiftDate(parts: { year: number; month: number; day: number }, deltaDays: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + deltaDays, 12, 0, 0));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function getOffsetString(timeZone: string, year: number, month: number, day: number, hour: number, minute: number): string {
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
    minute: "2-digit",
  });
  const value = formatter.formatToParts(probe).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = value.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/i);
  if (!match) {
    return "+00:00";
  }
  const sign = match[1];
  const hours = match[2].padStart(2, "0");
  const minutes = (match[3] ?? "00").padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

function buildLocalIso(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): string {
  const offset = getOffsetString(timeZone, year, month, day, hour, minute);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${offset}`;
}

function parseDateReference(normalizedPrompt: string, timeZone: string): { year: number; month: number; day: number } | null {
  const now = getNowParts(timeZone);

  if (normalizedPrompt.includes("amanha") || /\ba\s+manha\b/.test(normalizedPrompt)) {
    return shiftDate(now, 1);
  }
  if (normalizedPrompt.includes("hoje")) {
    return { year: now.year, month: now.month, day: now.day };
  }

  const explicitDateMatch = normalizedPrompt.match(/\b(?:dia\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (explicitDateMatch) {
    const day = Number.parseInt(explicitDateMatch[1], 10);
    const month = Number.parseInt(explicitDateMatch[2], 10);
    const yearCandidate = explicitDateMatch[3]
      ? Number.parseInt(explicitDateMatch[3].length === 2 ? `20${explicitDateMatch[3]}` : explicitDateMatch[3], 10)
      : now.year;
    return { year: yearCandidate, month, day };
  }

  const monthMap = new Map([
    ["janeiro", 1],
    ["fevereiro", 2],
    ["marco", 3],
    ["abril", 4],
    ["maio", 5],
    ["junho", 6],
    ["julho", 7],
    ["agosto", 8],
    ["setembro", 9],
    ["outubro", 10],
    ["novembro", 11],
    ["dezembro", 12],
  ]);
  const namedDateMatch = normalizedPrompt.match(
    /\b(?:dia\s+)?(\d{1,2})\s+(?:de\s+)?(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+(?:de\s+)?(\d{2,4}))?\b/,
  );
  if (namedDateMatch) {
    const day = Number.parseInt(namedDateMatch[1], 10);
    const month = monthMap.get(namedDateMatch[2]) ?? now.month;
    const yearCandidate = namedDateMatch[3]
      ? Number.parseInt(namedDateMatch[3].length === 2 ? `20${namedDateMatch[3]}` : namedDateMatch[3], 10)
      : now.year;
    return { year: yearCandidate, month, day };
  }

  const dayOnlyMatch = normalizedPrompt.match(/\bdia\s+(\d{1,2})\b/);
  if (dayOnlyMatch) {
    const day = Number.parseInt(dayOnlyMatch[1], 10);
    const currentMonthDate = new Date(Date.UTC(now.year, now.month - 1, day, 12, 0, 0));
    const nextOccurrence = day >= now.day
      ? currentMonthDate
      : new Date(Date.UTC(now.year, now.month, day, 12, 0, 0));
    return {
      year: nextOccurrence.getUTCFullYear(),
      month: nextOccurrence.getUTCMonth() + 1,
      day: nextOccurrence.getUTCDate(),
    };
  }

  const weekdayMap: Array<{ tokens: string[]; weekday: number }> = [
    { tokens: ["domingo"], weekday: 0 },
    { tokens: ["segunda", "segunda-feira"], weekday: 1 },
    { tokens: ["terca", "terca-feira"], weekday: 2 },
    { tokens: ["quarta", "quarta-feira"], weekday: 3 },
    { tokens: ["quinta", "quinta-feira"], weekday: 4 },
    { tokens: ["sexta", "sexta-feira"], weekday: 5 },
    { tokens: ["sabado"], weekday: 6 },
  ];

  const hit = weekdayMap.find((item) => item.tokens.some((token) => normalizedPrompt.includes(token)));
  if (!hit) {
    return null;
  }

  const delta = ((hit.weekday - now.weekday + 7) % 7) || 7;
  return shiftDate(now, delta);
}

function parseTimeRange(normalizedPrompt: string): { startHour: number; startMinute: number; endHour: number; endMinute: number } | null {
  const rangePatterns = [
    /\bdas?\s+(\d{1,2})(?::(\d{2}))?\s*(?:h)?\s+(?:as|a|ate)\s+(\d{1,2})(?::(\d{2}))?\s*(?:h)?/,
    /\b(\d{1,2})(?::(\d{2}))?\s*(?:h)?\s+(?:as|a|ate)\s+(\d{1,2})(?::(\d{2}))?\s*(?:h)?/,
  ];

  for (const pattern of rangePatterns) {
    const match = normalizedPrompt.match(pattern);
    if (!match) {
      continue;
    }
    const prefix = normalizedPrompt.slice(Math.max(0, (match.index ?? 0) - 8), match.index ?? 0);
    if (/\bdia\s+$/.test(prefix)) {
      continue;
    }

    return {
      startHour: Number.parseInt(match[1], 10),
      startMinute: Number.parseInt(match[2] ?? "0", 10),
      endHour: Number.parseInt(match[3], 10),
      endMinute: Number.parseInt(match[4] ?? "0", 10),
    };
  }

  return null;
}

function parseSingleTime(normalizedPrompt: string): { hour: number; minute: number } | null {
  const hourWord = "(uma|um|duas|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)";
  const patterns = [
    /\bas\s+(\d{1,2})(?::(\d{2}))?\s*(?:h|horas?)?\b/,
    /\ba\s+(\d{1,2})(?::(\d{2}))?\s*(?:h|horas?)?\b/,
    /\b(\d{1,2})h(\d{2})?\b/,
    new RegExp(`\\bas\\s+${hourWord}(?:\\s+horas?)?\\b`),
    new RegExp(`\\ba\\s+${hourWord}(?:\\s+horas?)?\\b`),
    new RegExp(`\\b${hourWord}(?:\\s+horas?)?\\s+(?:da|de|pela)\\s+(?:manha|tarde|noite)\\b`),
  ];

  for (const pattern of patterns) {
    const match = normalizedPrompt.match(pattern);
    if (!match) {
      continue;
    }

    const rawHour = parseHourToken(match[1]);
    if (typeof rawHour !== "number") {
      continue;
    }
    return {
      hour: adjustHourForDayPeriod(rawHour, normalizedPrompt),
      minute: Number.parseInt(match[2] ?? "0", 10),
    };
  }

  return null;
}

function parseHourToken(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  const hourWords = new Map([
    ["uma", 1],
    ["um", 1],
    ["duas", 2],
    ["dois", 2],
    ["tres", 3],
    ["quatro", 4],
    ["cinco", 5],
    ["seis", 6],
    ["sete", 7],
    ["oito", 8],
    ["nove", 9],
    ["dez", 10],
    ["onze", 11],
    ["doze", 12],
  ]);
  return hourWords.get(value) ?? null;
}

function adjustHourForDayPeriod(hour: number, normalizedPrompt: string): number {
  if (/\b(?:da|de|pela)\s+manha\b/.test(normalizedPrompt)) {
    return hour === 12 ? 0 : hour;
  }
  if (/\b(?:da|de|pela)\s+(?:tarde|noite)\b/.test(normalizedPrompt) && hour >= 1 && hour < 12) {
    return hour + 12;
  }
  return hour;
}

function parseReminderMinutes(normalizedPrompt: string): number | undefined {
  const match = normalizedPrompt.match(/\blembrete(?:\s+de)?\s+(\d{1,3})\s*min/);
  if (!match) {
    return undefined;
  }
  const minutes = Number.parseInt(match[1], 10);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 40320) {
    return undefined;
  }
  return minutes;
}

function extractEmailAddresses(value: string): string[] {
  const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return [...new Set(matches.map((item) => item.trim().toLowerCase()))];
}

function extractRemovedEmailAddresses(value: string): string[] {
  const matches = [...value.matchAll(/\b(?:remova|retire|exclua|sem)\s+([^\n]+)/gi)];
  const emails = new Set<string>();
  for (const match of matches) {
    const chunk = match[1] ?? "";
    for (const email of extractEmailAddresses(chunk)) {
      emails.add(email);
    }
  }
  return [...emails];
}

function extractLocation(value: string): string | undefined {
  const explicitMatch = value.match(/\blocal\s*[:=]\s*([^,.;\n]+)/i);
  if (explicitMatch?.[1]?.trim()) {
    return explicitMatch[1].trim();
  }

  const sanitized = value
    .replace(/\b(?:na\s+minha\s+agenda(?:\s+\w+)?|na\s+agenda(?:\s+\w+)?|no\s+meu\s+calendario(?:\s+\w+)?|no\s+calendario(?:\s+\w+)?)\b/gi, " ")
    .replace(/\b(?:agenda|calend[aá]rio)(?:\s+(?:da|de))?\s+(?:abordagem|principal|pessoal|trabalho)\b/gi, " ")
    .replace(/\b(?:na|no|em|para)\s+(?:abordagem|principal|primary|pessoal)\b/gi, " ")
    .replace(/\b(?:proxima|próxima|proximo|próximo)\s+(?:segunda(?:-feira)?|terca(?:-feira)?|terça(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado|sábado|domingo)\b/gi, " ")
    .replace(/\b(?:amanha|amanhã|a\s+manhã|hoje)\b/gi, " ")
    .replace(/\bdas?\s+\d{1,2}(?::\d{2})?\s*(?:h)?\s+(?:as|a|ate)\s+\d{1,2}(?::\d{2})?\s*(?:h)?\b/gi, " ")
    .replace(/\b(?:as|às|a)\s+\d{1,2}(?::\d{2})?\s*(?:h|horas?)?\b/gi, " ")
    .replace(/\b(?:as|às|a)\s+(?:uma|um|duas|dois|tres|três|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)(?:\s+horas?)?\b/gi, " ")
    .replace(/\b\d{1,2}h(?:\d{2})?\b/gi, " ")
    .replace(/\b(?:da|de|pela)\s+(?:manh[aã]|tarde|noite)\b/gi, " ")
    .replace(/\b(?:principal|primary|abordagem)\b/gi, " ")
    .replace(/\bàs\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const cleanupLocationCandidate = (candidate: string): string => candidate
    .replace(
      /\s+(?:as|às|a)\s+(?:\d{1,2}(?::\d{2})?\s*(?:h|horas?)?|uma|um|duas|dois|tres|três|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)(?:\s+horas?)?(?:\s+(?:da|de|pela)\s+(?:manh[aã]|tarde|noite))?.*$/iu,
      " ",
    )
    .replace(/\s+(?:as|às|a)\s+(?:da|de|pela)\s+(?:manh[aã]|tarde|noite).*$/iu, " ")
    .replace(/\b\d{1,2}h(?:\d{2})?\b/gi, " ")
    .replace(/\b(?:da|de|pela)\s+(?:manh[aã]|tarde|noite)\b/gi, " ")
    .replace(/[.,;:\s-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const publicServiceVenueMatch = sanitized.match(
    /(?:^|[\s,])(?:na|no|em)\s+((?:caps|creas|cras|ubs|upa)\b[^,.;\n]*)/i,
  );
  if (publicServiceVenueMatch?.[1]?.trim()) {
    const candidate = cleanupLocationCandidate(publicServiceVenueMatch[1].trim());
    const candidateNormalized = normalize(candidate).replace(/\s+/g, " ").trim();
    const qualifier = candidateNormalized
      .replace(/^(?:caps|creas|cras|ubs|upa)\b/, "")
      .trim()
      .split(" ")
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item) => !["de", "da", "do", "dos", "das"].includes(item));
    if (qualifier.length > 0) {
      return prettifyLocationLabel(candidate);
    }
  }

  const venueMatch = sanitized.match(
    /(?:,\s*|\s+)(?:na|no|em)\s+((?:quadra|arena|campo|ginasio|ginásio|clube|audit[oó]rio|sala)\b[^,.;\n]*)$/i,
  );
  if (venueMatch?.[1]?.trim()) {
    return cleanupLocationCandidate(venueMatch[1].trim());
  }

  return undefined;
}

function cleanupDraftTitle(value: string): string {
  const cleaned = normalize(value)
    .replace(/\b(?:crie|cria|criar|adicione|adiciona|adicionar|registre|registra|salve|salva|anote|anota|marque|marca|coloque|coloca)\b/g, " ")
    .replace(/\b(?:uma|um|a)\s+(?:tarefa|task|lembrete)\b/g, " ")
    .replace(/\b(?:tarefa|task|lembrete)\b/g, " ")
    .replace(/\b(?:no\s+google(?:\s+tasks)?)\b/g, " ")
    .replace(/^\s*(?:para|pra)\s+/g, " ")
    .replace(/\b(?:para|pra)\s+(?=(?:amanha|hoje|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado|domingo|dia\s+\d{1,2}|\d{1,2}\/\d{1,2}))/g, " ")
    .replace(/\b(?:ate|até|prazo)\s+(?=(?:amanha|hoje|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado|domingo|dia\s+\d{1,2}|\d{1,2}\/\d{1,2}))/g, " ")
    .replace(/\b(?:para|com prazo|prazo|no dia|dia|amanha|hoje|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado|domingo)\b/g, " ")
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ")
    .replace(/\b(?:dia\s+)?\d{1,2}\s+(?:de\s+)?(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+(?:de\s+)?\d{2,4})?\b/g, " ")
    .replace(/\bdas?\s+\d{1,2}(?::\d{2})?\s*(?:h)?\s+(?:as|a|ate)\s+\d{1,2}(?::\d{2})?\s*(?:h)?\b/g, " ")
    .replace(/\bas?\s+\d{1,2}(?::\d{2})?\s*(?:h|horas?)?\b/g, " ")
    .replace(/\bas?\s+(?:uma|um|duas|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)(?:\s+horas?)?\b/g, " ")
    .replace(/\b(?:uma|um|duas|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)(?:\s+horas?)?\s+(?:da|de|pela)\s+(?:manha|tarde|noite)\b/g, " ")
    .replace(/\b\d{1,2}h(?:\d{2})?\b/g, " ")
    .replace(/\b(?:da|de|pela)\s+(?:manha|tarde|noite)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const withoutTrailingPunctuation = cleaned.replace(/[.,;:!?-]+$/g, "").trim();

  if (!withoutTrailingPunctuation) {
    return value.trim();
  }

  return formatEventTitle(withoutTrailingPunctuation);
}

const EVENT_TITLE_ACRONYMS = new Map([
  ["caps", "CAPS"],
  ["creas", "CREAS"],
  ["cras", "CRAS"],
  ["paefi", "PAEFI"],
  ["seas", "SEAS"],
  ["ubs", "UBS"],
  ["upa", "UPA"],
  ["sus", "SUS"],
]);

function restoreCommonTitleWord(value: string): string {
  const lower = value.toLowerCase();
  if (lower === "reuniao") {
    return "reunião";
  }
  if (lower === "relatorio") {
    return "relatório";
  }
  if (lower === "acao") {
    return "ação";
  }
  if (lower === "memoria") {
    return "memória";
  }
  return lower;
}

function formatEventTitle(value: string): string {
  let previousLower = "";
  return value
    .trim()
    .split(/\s+/)
    .map((token, index) => {
      const lower = token.toLowerCase();
      if (EVENT_TITLE_ACRONYMS.has(lower)) {
        previousLower = lower;
        return EVENT_TITLE_ACRONYMS.get(lower)!;
      }
      const restored = restoreCommonTitleWord(lower);
      if (index === 0) {
        previousLower = lower;
        return restored.charAt(0).toUpperCase() + restored.slice(1);
      }
      if (EVENT_TITLE_ACRONYMS.has(previousLower)) {
        previousLower = lower;
        return restored.charAt(0).toUpperCase() + restored.slice(1);
      }
      previousLower = lower;
      return restored;
    })
    .join(" ");
}

function cleanupEventTitle(value: string): string {
  const cleaned = normalize(value)
    .replace(/\b(?:agende|agenda|agendar|marque|marca|marcar|crie|cria|criar|coloque|coloca|adicione|adiciona)\b/g, " ")
    .replace(/\bcom(?:\s+google)?\s+meet\b/g, " ")
    .replace(/\bsem(?:\s+google)?\s+meet\b/g, " ")
    .replace(/\b(?:chamado|chamada|com\s+o\s+titulo|com\s+título|com\s+titulo|titulo|título|nomeado|nomeada)\b/g, " ")
    .replace(/\b(?:tenho|terei|teremos)\s+(?:uma|um)\b/g, " ")
    .replace(/\b(?:vou|vamos|irei)\s+ter\s+(?:uma|um)\b/g, " ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ")
    .replace(/\blocal\s*[:=]\s*[^,.;\n]+/gi, " ")
    .replace(
      /,\s*(?:coloque|coloca|adicione|adiciona|agende|agenda|agendar|marque|marca|marcar|registre|salve)\b[\s\S]*$/g,
      " ",
    )
    .replace(
      /\b(?:coloque|coloca|adicione|adiciona|agende|agenda|agendar|marque|marca|marcar|registre|salve)\b(?:\s+isso)?\s+(?:na\s+minha\s+agenda|na\s+agenda|no\s+meu\s+calendario|no\s+calendario|ao\s+calendario)\b/g,
      " ",
    )
    .replace(
      /\b(?:na\s+minha\s+agenda|na\s+agenda|no\s+meu\s+calendario|no\s+calendario|ao\s+calendario)\s+(?:um|uma|o|a)?\s*(?:evento|compromisso|reuniao|lembrete)?\b/g,
      " ",
    )
    .replace(/\b(?:na minha agenda(?: \w+)?|na agenda(?: \w+)?|no meu calendario(?: \w+)?|no calendario(?: \w+)?)\b/g, " ")
    .replace(/\b(?:agenda|calendario)(?:\s+(?:da|de))?\s+(?:abordagem|principal|pessoal|trabalho)\b/g, " ")
    .replace(/\b(?:na|no|em|para)\s+(?:abordagem|principal|primary|pessoal)\b/g, " ")
    .replace(/^\s*(?:(?:um|uma|o|a)\s*(?:evento|compromisso|lembrete)|(?:evento|lembrete))\s+/g, " ")
    .replace(/\b(?:convide|convidar|convidados?|participantes?)\b/g, " ")
    .replace(/\b(?:tenho|preciso|quero|gostaria)\s+(?:uma|um)\b/g, " ")
    .replace(/\b(?:na\s+minha\s+agenda|na\s+agenda|no\s+meu\s+calendario|no\s+calendario|ao\s+calendario)\b/g, " ")
    .replace(/\b(?:dia\s+)?\d{1,2}\s+(?:de\s+)?(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+(?:de\s+)?\d{2,4})?\b/g, " ")
    .replace(/\bdia\s+\d{1,2}\b/g, " ")
    .replace(/\b(?:com prazo|prazo|no dia|dia|amanha|a\s+manha|hoje|proxima|proximo|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado|domingo)\b/g, " ")
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ")
    .replace(/\bdas?\s+\d{1,2}(?::\d{2})?\s*(?:h)?\s+(?:as|a|ate)\s+\d{1,2}(?::\d{2})?\s*(?:h)?\b/g, " ")
    .replace(/\bas?\s+\d{1,2}(?::\d{2})?\s*(?:h|horas?)?\b/g, " ")
    .replace(/\bas?\s+(?:uma|um|duas|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)(?:\s+horas?)?\b/g, " ")
    .replace(/\b(?:uma|um|duas|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)(?:\s+horas?)?\s+(?:da|de|pela)\s+(?:manha|tarde|noite)\b/g, " ")
    .replace(/\b\d{1,2}h(?:\d{2})?\b/g, " ")
    .replace(/\b(?:da|de|pela)\s+(?:manha|tarde|noite)\b/g, " ")
    .replace(/\bduracao\b/g, " ")
    .replace(/\bparticipantes?\b/g, " ")
    .replace(/\bconvidados?\b/g, " ")
    .replace(/\breservar\b/g, " ")
    .replace(/\bsala\b/g, " ")
    .replace(/\bprecisa\b/g, " ")
    .replace(/\bnao\b/g, " ")
    .replace(/\bprincipal\b/g, " ")
    .replace(/\babordagem\b/g, " ")
    .replace(/\bas\b/g, " ")
    .replace(/[,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const withoutTrailingPunctuation = cleaned
    .replace(/^[,.;:\s-]+/g, "")
    .replace(/\s+,/g, " ")
    .replace(/\b(?:na|no|em)\b$/g, "")
    .replace(/\be\b$/g, "")
    .replace(/^de\s+/g, "")
    .replace(/[.,;:!?-]+$/g, "")
    .trim();
  if (!withoutTrailingPunctuation) {
    return "";
  }

  return formatEventTitle(withoutTrailingPunctuation);
}

function prettifyLocationLabel(value: string): string {
  const acronymMap = new Map([
    ["caps", "CAPS"],
    ["creas", "CREAS"],
    ["cras", "CRAS"],
    ["ubs", "UBS"],
    ["upa", "UPA"],
    ["sus", "SUS"],
  ]);

  return value
    .trim()
    .split(/\s+/)
    .map((token) => {
      const lower = token.toLowerCase();
      if (acronymMap.has(lower)) {
        return acronymMap.get(lower)!;
      }
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    })
    .join(" ");
}

function isWeakEventSummary(summary: string): boolean {
  const normalized = normalize(summary);
  if ([
    "",
    "teste",
    "de teste",
    "reuniao",
    "compromisso",
    "evento",
    "reuniao teste",
    "compromisso teste",
    "evento teste",
    "teste no caps",
    "teste na caps",
  ].includes(normalized)) {
    return true;
  }

  return normalized.startsWith("teste no ")
    || normalized.startsWith("teste na ")
    || normalized.startsWith("de teste no ")
    || normalized.startsWith("de teste na ");
}

function defaultEventSummary(normalizedPrompt: string): string {
  if (normalizedPrompt.includes("reuniao")) {
    return "Reunião";
  }
  if (normalizedPrompt.includes("compromisso")) {
    return "Compromisso";
  }
  return "Evento";
}

export function isGoogleTaskCreatePrompt(prompt: string): boolean {
  const normalized = normalize(prompt);
  return includesAny(normalized, [
    "crie uma tarefa",
    "cria uma tarefa",
    "crie tarefa",
    "cria tarefa",
    "criar uma tarefa",
    "adicione uma tarefa",
    "adicionar tarefa",
    "anota uma tarefa",
    "anote uma tarefa",
    "marca uma tarefa",
    "marque uma tarefa",
    "crie um lembrete",
    "cria um lembrete",
    "anota um lembrete",
    "anote um lembrete",
    "adicionar lembrete",
  ]);
}

export function isGoogleEventCreatePrompt(prompt: string): boolean {
  const normalized = normalize(prompt);
  const hasCalendar = /\b(?:agenda|calendario)\b/.test(normalized);
  const hasAction = /\b(?:coloque|coloca|adicione|adiciona|agende|agenda|agendar|marque|marca|marcar|crie|cria|criar)\b/.test(normalized);
  const hasEventNoun = /\b(?:evento|compromisso|reuniao)\b/.test(normalized);
  const startsWithSchedulingVerb = /^(?:por favor\s+)?(?:coloque|coloca|adicione|adiciona|agende|agenda|agendar|marque|marca|marcar|crie|cria|criar)\b/.test(normalized);
  const hasTime = Boolean(parseTimeRange(normalized) || parseSingleTime(normalized));
  const looksLikeDeclarativeCommitment =
    hasTime
    && /\b(?:evento|compromisso|reuniao|consulta|visita|encontro)\b/.test(normalized)
    && (
      /\b(?:tenho|terei|teremos)\s+(?:uma|um)\b/.test(normalized)
      || /\b(?:vou|vamos|irei)\s+ter\s+(?:uma|um)\b/.test(normalized)
    );
  return includesAny(normalized, [
    "crie um evento",
    "cria um evento",
    "criar um evento",
    "crie um compromisso",
    "cria um compromisso",
    "criar um compromisso",
    "agende uma reuniao",
    "agenda uma reuniao",
    "agendar uma reuniao",
    "marque uma reuniao",
    "marca uma reuniao",
    "marcar uma reuniao",
    "agende um evento",
    "agenda um evento",
    "coloque na minha agenda",
    "coloca na minha agenda",
    "coloque na agenda",
    "coloca na agenda",
    "coloque no meu calendario",
    "coloca no meu calendario",
    "adicione na minha agenda",
    "adiciona na minha agenda",
    "adicione no meu calendario",
    "adiciona no meu calendario",
    "coloque um evento no meu calendario",
    "coloca um evento no meu calendario",
    "coloque um evento na minha agenda",
    "coloca um evento na minha agenda",
  ]) || (
    hasCalendar && hasAction && hasEventNoun
  ) || (
    startsWithSchedulingVerb && hasTime
  ) || (
    /tenho\s+(?:uma|um)\s+(?:reuniao|evento|compromisso)\b/.test(normalized) &&
    /\b(?:agenda|calendario)\b/.test(normalized)
  ) || looksLikeDeclarativeCommitment;
}

export function buildTaskDraftFromPrompt(prompt: string, timeZone: string): { draft?: PendingGoogleTaskDraft; reason?: string } {
  const normalizedPrompt = normalize(prompt);
  const patterns = [
    /(?:crie|cria|criar|adicione|adiciona|adicionar|registre|registra|salve|salva|anote|anota|marque|marca|coloque|coloca)\s+(?:uma\s+)?(?:tarefa|task|lembrete)(?:\s+no\s+google(?:\s+tasks)?)?(?:\s+para|\s*:)?\s+([\s\S]+)/i,
    /(?:preciso|precisamos|favor|por favor)\s+(entregar|enviar|fazer|providenciar|preparar|retornar|ligar|confirmar|revisar|comprar|resolver|ajustar)\s+([\s\S]+)/i,
    /^(?:paulo[,:\-\s]+)?(entregar|enviar|fazer|providenciar|preparar|retornar|ligar|confirmar|revisar|comprar|resolver|ajustar)\s+([\s\S]+)/i,
  ];
  const match = patterns.map((pattern) => prompt.match(pattern)).find(Boolean);
  const rawTitle = match
    ? (match.length >= 3 ? `${match[1]} ${match[2]}` : match[1])?.trim() || ""
    : (isGoogleTaskCreatePrompt(prompt) ? prompt.trim() : "");
  const title = cleanupDraftTitle(rawTitle);
  if (!title) {
    return {
      reason: "Consigo preparar a tarefa, mas preciso pelo menos do título. Exemplo: `Crie uma tarefa para revisar proposta amanhã às 10h.`",
    };
  }

  const date = parseDateReference(normalizedPrompt, timeZone);
  const time = parseSingleTime(normalizedPrompt);
  const due = date
    ? buildLocalIso(timeZone, date.year, date.month, date.day, time?.hour ?? 12, time?.minute ?? 0)
    : undefined;

  return {
    draft: {
      kind: "google_task",
      title,
      due,
    },
  };
}

export function buildEventDraftFromPrompt(prompt: string, timeZone: string): { draft?: PendingGoogleEventDraft; reason?: string } {
  const normalizedPrompt = normalize(prompt);
  const patterns = [
    /(?:crie|cria|criar|agende|agenda|agendar|marque|marca|marcar|coloque|coloca|adicione|adiciona)\s+(?:(?:um|uma|o|a)\s+(?!(?:manhã|manha)(?:\s|$)))?(?:evento|compromisso|reuni[aã]o|lembrete)(?:\s+chamad[oa])?(?:\s+no\s+google calendar|\s+na\s+agenda|\s+na\s+minha\s+agenda|\s+no\s+calendario|\s+no\s+meu\s+calendario)?(?:(?:\s+para|\s*:)\s*)?([\s\S]+)/i,
    /(?:crie|cria|criar|agende|agenda|agendar|marque|marca|marcar|coloque|coloca|adicione|adiciona)\s+(?:na\s+minha\s+agenda|na\s+agenda|no\s+meu\s+calendario|no\s+calendario|ao\s+calendario)\s*,?\s+(?:(?:um|uma|o|a)\s+(?!(?:manhã|manha)(?:\s|$)))?(?:evento|compromisso|reuni[aã]o|lembrete)?(?:\s+chamad[oa])?(?:(?:\s+para|\s*:)\s*)?([\s\S]+)/i,
    /(?:na\s+minha\s+agenda|na\s+agenda|no\s+meu\s+calendario|no\s+calendario|ao\s+calendario)\s*,?\s*(?:coloque|coloca|adicione|adiciona|agende|agenda|agendar|marque|marca|marcar|crie|cria|criar)\s+(?:(?:um|uma|o|a)\s+(?!(?:manhã|manha)(?:\s|$)))?(?:evento|compromisso|reuni[aã]o|lembrete)?(?:\s+chamad[oa])?(?:(?:\s+para|\s*:)\s*)?([\s\S]+)/i,
    /^(?:por favor\s+)?(?:agende|agenda|agendar|marque|marca|marcar)\s+([\s\S]+)/i,
  ];
  const match = patterns.map((pattern) => prompt.match(pattern)).find(Boolean);
  const rawSummary = match?.[1]?.trim() || prompt.trim();
  const location = extractLocation(prompt);
  let summary = cleanupEventTitle(rawSummary) || defaultEventSummary(normalizedPrompt);
  if (isWeakEventSummary(summary)) {
    if (location) {
      const locationLabel = prettifyLocationLabel(location);
      summary = `${defaultEventSummary(normalizedPrompt)} no ${locationLabel}`;
    } else {
      const weakLocationMatch = normalize(summary).match(/^(?:teste|de teste)\s+(no|na)\s+(.+)$/);
      if (weakLocationMatch?.[2]?.trim()) {
        const preposition = weakLocationMatch[1] === "na" ? "na" : "no";
        summary = `${defaultEventSummary(normalizedPrompt)} ${preposition} ${prettifyLocationLabel(weakLocationMatch[2])}`;
      } else if (normalize(summary) === "teste" && normalizedPrompt.includes("reuniao")) {
        summary = "Reunião de teste";
      } else {
        summary = defaultEventSummary(normalizedPrompt);
      }
    }
  }
  if (!summary) {
    return {
      reason: "Consigo preparar o evento, mas preciso do título. Exemplo: `Crie um evento reunião com cliente amanhã das 14h às 15h.`",
    };
  }

  const date = parseDateReference(normalizedPrompt, timeZone);
  if (!date) {
    return {
      reason: "Consigo preparar o evento, mas preciso da data. Exemplo: `Crie um evento reunião com cliente amanhã das 14h às 15h.`",
    };
  }

  const timeRange = parseTimeRange(normalizedPrompt);
  const singleTime = timeRange ? null : parseSingleTime(normalizedPrompt);
  if (!timeRange && !singleTime) {
    return {
      reason: "Consigo preparar o evento, mas preciso do horário. Exemplo: `Crie um evento reunião com cliente amanhã das 14h às 15h.`",
    };
  }

  const startHour = timeRange?.startHour ?? singleTime!.hour;
  const startMinute = timeRange?.startMinute ?? singleTime!.minute;
  const endHour = timeRange?.endHour ?? Math.min(startHour + 1, 23);
  const endMinute = timeRange?.endMinute ?? startMinute;

  return {
    draft: {
      kind: "google_event",
      summary,
      start: buildLocalIso(timeZone, date.year, date.month, date.day, startHour, startMinute),
      end: buildLocalIso(timeZone, date.year, date.month, date.day, endHour, endMinute),
      timezone: timeZone,
      location,
      attendees: extractEmailAddresses(prompt),
      reminderMinutes: parseReminderMinutes(normalizedPrompt) ?? 30,
      createMeet: /\bcom(?:\s+google)?\s+meet\b/.test(normalizedPrompt),
    },
  };
}

function parseIsoLocalParts(value: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  offset: string;
} | null {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):\d{2}([+-]\d{2}:\d{2}|Z)$/,
  );
  if (!match) {
    return null;
  }
  return {
    year: Number.parseInt(match[1], 10),
    month: Number.parseInt(match[2], 10),
    day: Number.parseInt(match[3], 10),
    hour: Number.parseInt(match[4], 10),
    minute: Number.parseInt(match[5], 10),
    offset: match[6],
  };
}

function buildIsoFromParts(parts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  offset: string;
}): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:00${parts.offset}`;
}

function updateIsoDatePart(value: string, year: number, month: number, day: number): string {
  const parts = parseIsoLocalParts(value);
  if (!parts) {
    return value;
  }
  return buildIsoFromParts({
    ...parts,
    year,
    month,
    day,
  });
}

function updateIsoTimePart(value: string, hour: number, minute: number): string {
  const parts = parseIsoLocalParts(value);
  if (!parts) {
    return value;
  }
  return buildIsoFromParts({
    ...parts,
    hour,
    minute,
  });
}

function parseSummaryAdjustment(value: string): string | undefined {
  const match = value.match(/\b(?:titulo|título|nome)\s*[:=]\s*(.+)$/i)
    ?? value.match(/\b(?:troque|altere|mude)\s+o?\s*(?:titulo|título|nome)\s+(?:para\s+)?(.+)$/i);
  const summary = match?.[1]?.trim();
  return summary || undefined;
}

export function adjustEventDraftFromInstruction(
  draft: PendingGoogleEventLikeDraft,
  instruction: string,
): PendingGoogleEventLikeDraft | null {
  const normalized = normalize(instruction);
  let updated: PendingGoogleEventLikeDraft = { ...draft };
  let changed = false;

  const summary = parseSummaryAdjustment(instruction);
  if (summary) {
    updated.summary = summary;
    changed = true;
  }

  const date = parseDateReference(normalized, draft.timezone);
  if (date) {
    updated.start = updateIsoDatePart(updated.start, date.year, date.month, date.day);
    updated.end = updateIsoDatePart(updated.end, date.year, date.month, date.day);
    changed = true;
  }

  const range = parseTimeRange(normalized);
  const single = range ? null : parseSingleTime(normalized);
  if (range) {
    updated.start = updateIsoTimePart(updated.start, range.startHour, range.startMinute);
    updated.end = updateIsoTimePart(updated.end, range.endHour, range.endMinute);
    changed = true;
  } else if (single) {
    const currentEnd = new Date(updated.end);
    const currentStart = new Date(updated.start);
    const durationMinutes = Math.max(
      15,
      Number.isNaN(currentEnd.getTime()) || Number.isNaN(currentStart.getTime())
        ? 60
        : Math.round((currentEnd.getTime() - currentStart.getTime()) / 60000),
    );
    updated.start = updateIsoTimePart(updated.start, single.hour, single.minute);
    const startParts = parseIsoLocalParts(updated.start);
    if (startParts) {
      const localEndProbe = new Date(
        Date.UTC(
          startParts.year,
          startParts.month - 1,
          startParts.day,
          startParts.hour,
          startParts.minute + durationMinutes,
          0,
        ),
      );
      const offset = startParts.offset;
      const year = localEndProbe.getUTCFullYear();
      const month = localEndProbe.getUTCMonth() + 1;
      const day = localEndProbe.getUTCDate();
      const hour = localEndProbe.getUTCHours();
      const minute = localEndProbe.getUTCMinutes();
      updated.end = buildIsoFromParts({ year, month, day, hour, minute, offset });
    }
    changed = true;
  }

  const location = extractLocation(instruction);
  if (location) {
    updated.location = location;
    changed = true;
  } else if (/\b(?:sem|remova|retire)\s+local\b/.test(normalized)) {
    updated.location = undefined;
    changed = true;
  }

  const attendees = extractEmailAddresses(instruction);
  const removedAttendees = extractRemovedEmailAddresses(instruction);
  if (/\b(?:troque|substitua)\b/.test(normalized) && attendees.length >= 2) {
    const [oldEmail, newEmail] = attendees;
    updated.attendees = [
      ...(updated.attendees ?? []).filter((email) => email !== oldEmail && email !== newEmail),
      newEmail,
    ];
    changed = true;
  }
  if (removedAttendees.length > 0 && (updated.attendees?.length ?? 0) > 0) {
    updated.attendees = (updated.attendees ?? []).filter((email) => !removedAttendees.includes(email));
    changed = true;
  }

  if (attendees.length > 0 && !/\b(?:troque|substitua)\b/.test(normalized)) {
    updated.attendees = [...new Set([...(updated.attendees ?? []), ...attendees])];
    changed = true;
  } else if (/\b(?:sem|remova|retire)\s+(?:convidados|participantes)\b/.test(normalized)) {
    updated.attendees = [];
    changed = true;
  }

  const reminder = parseReminderMinutes(normalized);
  if (typeof reminder === "number") {
    updated.reminderMinutes = reminder;
    changed = true;
  }

  if (/\bcom(?:\s+google)?\s+meet\b/.test(normalized)) {
    updated.createMeet = true;
    changed = true;
  } else if (/\bsem(?:\s+google)?\s+meet\b/.test(normalized)) {
    updated.createMeet = false;
    changed = true;
  }

  return changed ? updated : null;
}

export function formatDraftDateTime(value: string | undefined, timeZone: string): string {
  if (!value) {
    return "(sem data)";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function buildGoogleTaskDraftReply(draft: PendingGoogleTaskDraft, timeZone: string): string {
  return [
    "Rascunho de tarefa Google pronto.",
    `- Título: ${draft.title}`,
    `- Prazo: ${formatDraftDateTime(draft.due, timeZone)}`,
    "Confirme com `sim, quero` ou `agendar`. Para descartar, use `cancelar rascunho`.",
    "",
    "GOOGLE_TASK_DRAFT",
    JSON.stringify(draft),
    "END_GOOGLE_TASK_DRAFT",
  ].join("\n");
}

export function buildGoogleEventDraftReply(draft: PendingGoogleEventLikeDraft): string {
  return [
    "Rascunho de evento Google pronto.",
    `- Título: ${draft.summary}`,
    `- Início: ${formatDraftDateTime(draft.start, draft.timezone)}`,
    `- Fim: ${formatDraftDateTime(draft.end, draft.timezone)}`,
    ...(draft.account ? [`- Conta: ${draft.account}`] : []),
    ...(draft.calendarId ? [`- Calendário: ${draft.calendarId}`] : []),
    ...(draft.location ? [`- Local: ${draft.location}`] : []),
    ...(draft.attendees?.length ? [`- Convidados: ${draft.attendees.join(", ")}`] : []),
    `- Lembrete: ${draft.reminderMinutes ?? 30} minutos antes`,
    `- Meet: ${draft.createMeet ? "incluído" : "não incluído"}`,
    "Confirme com `sim, quero` ou `agendar`. Para descartar, use `cancelar rascunho`.",
    "",
    "GOOGLE_EVENT_DRAFT",
    JSON.stringify(draft),
    "END_GOOGLE_EVENT_DRAFT",
  ].join("\n");
}

export function buildGoogleEventDeleteDraftReply(draft: PendingGoogleEventDeleteDraft): string {
  return [
    "Rascunho de exclusão de evento Google pronto.",
    "Evento identificado:",
    `- Atual: ${draft.summary}`,
    ...(draft.account ? [`- Conta: ${draft.account}`] : []),
    ...(draft.calendarId ? [`- Calendário: ${draft.calendarId}`] : []),
    ...(draft.start ? [`- Início: ${formatDraftDateTime(draft.start, draft.timezone)}`] : []),
    ...(draft.end ? [`- Fim: ${formatDraftDateTime(draft.end, draft.timezone)}`] : []),
    ...(draft.location ? [`- Local: ${draft.location}`] : []),
    "Confirme com `sim, quero` ou `agendar`. Para descartar, use `cancelar rascunho`.",
    "",
    "GOOGLE_EVENT_DELETE_DRAFT",
    JSON.stringify(draft),
    "END_GOOGLE_EVENT_DELETE_DRAFT",
  ].join("\n");
}

export function buildGoogleEventUpdateDraftReply(draft: PendingGoogleEventUpdateDraft): string {
  return [
    "Rascunho de atualização de evento Google pronto.",
    ...(draft.originalSummary
      ? [
          "Evento identificado:",
          `- Atual: ${draft.originalSummary}`,
          ...(draft.originalStart ? [`- Início atual: ${formatDraftDateTime(draft.originalStart, draft.timezone)}`] : []),
          ...(draft.originalEnd ? [`- Fim atual: ${formatDraftDateTime(draft.originalEnd, draft.timezone)}`] : []),
          ...(draft.originalLocation ? [`- Local atual: ${draft.originalLocation}`] : []),
          "",
          "Atualização proposta:",
        ]
      : []),
    `- Título: ${draft.summary}`,
    `- Início: ${formatDraftDateTime(draft.start, draft.timezone)}`,
    `- Fim: ${formatDraftDateTime(draft.end, draft.timezone)}`,
    ...(draft.account ? [`- Conta: ${draft.account}`] : []),
    ...(draft.calendarId ? [`- Calendário: ${draft.calendarId}`] : []),
    ...(draft.location ? [`- Local: ${draft.location}`] : []),
    ...(draft.attendees?.length ? [`- Convidados: ${draft.attendees.join(", ")}`] : []),
    `- Lembrete: ${draft.reminderMinutes ?? 30} minutos antes`,
    `- Meet: ${draft.createMeet ? "incluído" : "não incluído"}`,
    "Confirme com `sim, quero` ou `agendar`. Para descartar, use `cancelar rascunho`.",
    "",
    "GOOGLE_EVENT_UPDATE_DRAFT",
    JSON.stringify(draft),
    "END_GOOGLE_EVENT_UPDATE_DRAFT",
  ].join("\n");
}

export function buildGoogleEventDeleteBatchDraftReply(draft: PendingGoogleEventDeleteBatchDraft): string {
  return [
    `Rascunho de exclusão em lote pronto. Eventos encontrados: ${draft.events.length}.`,
    ...draft.events.slice(0, 10).map((event) =>
      `- ${event.summary} | ${event.start ? formatDraftDateTime(event.start, draft.timezone) : "sem horário"}${event.account ? ` | conta: ${event.account}` : ""}${event.calendarId ? ` | calendário: ${event.calendarId}` : ""}`
    ),
    "Confirme com `sim, quero` ou `agendar`. Para descartar, use `cancelar rascunho`.",
    "",
    "GOOGLE_EVENT_DELETE_BATCH_DRAFT",
    JSON.stringify(draft),
    "END_GOOGLE_EVENT_DELETE_BATCH_DRAFT",
  ].join("\n");
}

function formatImportEventLine(event: PendingGoogleEventImportBatchItem, timezone: string): string {
  const start = formatDraftDateTime(event.start, timezone);
  const endTime = formatDraftDateTime(event.end, timezone).split(" ").pop();
  const location = event.location ? ` | ${event.location}` : "";
  const warning = event.reviewWarning ? ` | atenção: ${event.reviewWarning}` : "";
  return `- ${start}${endTime ? `-${endTime}` : ""} - ${event.summary}${location}${warning}`;
}

function formatImportDateShiftContext(items: PendingGoogleEventImportBatchIgnoredItem[]): string | undefined {
  const grouped = new Map<string, Set<string>>();
  for (const item of items) {
    const dateKey = item.date?.trim() || "";
    const shifts = grouped.get(dateKey) ?? new Set<string>();
    if (item.shift?.trim()) {
      shifts.add(item.shift.trim());
    }
    grouped.set(dateKey, shifts);
  }

  const parts = Array.from(grouped.entries())
    .map(([date, shifts]) => {
      const orderedShifts = ["manhã", "tarde", "integral"].filter((shift) => shifts.has(shift));
      if (!date && orderedShifts.length === 0) {
        return "";
      }
      if (!date) {
        return orderedShifts.join(" e ");
      }
      if (orderedShifts.length === 0) {
        return date;
      }
      return `${date} ${orderedShifts.join(" e ")}`;
    })
    .filter(Boolean);

  if (parts.length === 0) {
    return undefined;
  }
  return parts.join("; ");
}

function formatGroupedImportIgnoredLines(items: PendingGoogleEventImportBatchIgnoredItem[]): string[] {
  const groups = new Map<string, PendingGoogleEventImportBatchIgnoredItem[]>();
  for (const item of items) {
    const key = `${item.category}|${normalize(item.summary)}`;
    const list = groups.get(key) ?? [];
    const duplicate = list.some((entry) =>
      normalize(entry.date ?? "") === normalize(item.date ?? "") &&
      normalize(entry.shift ?? "") === normalize(item.shift ?? ""));
    if (!duplicate) {
      list.push(item);
    }
    groups.set(key, list);
  }

  return Array.from(groups.values()).map((group) => {
    const [first] = group;
    const context = formatImportDateShiftContext(group);
    return context ? `- ${first.summary} (${context})` : `- ${first.summary}`;
  });
}

function compactImportAssumptions(assumptions: string[]): string[] {
  const unique = assumptions.filter((item, index, list) => list.indexOf(item) === index);
  const shiftAssumptions = unique.filter((item) => /^Horário assumido por turno:/i.test(item));
  const remaining = unique.filter((item) => !/^Horário assumido por turno:/i.test(item));

  if (shiftAssumptions.length === 0) {
    return remaining;
  }

  const normalized = shiftAssumptions.map((item) => normalize(item));
  const shiftLabels: string[] = [];
  if (normalized.some((item) => item.includes("manha"))) {
    shiftLabels.push("manhã 08:00-12:00");
  }
  if (normalized.some((item) => item.includes("tarde"))) {
    shiftLabels.push("tarde 13:30-17:00");
  }
  if (normalized.some((item) => item.includes("integral"))) {
    shiftLabels.push("integral 08:00-17:00");
  }

  return [
    `Quando o horário não apareceu no material, usei o padrão: ${shiftLabels.join(" e ")}.`,
    ...remaining,
  ];
}

function formatImportModeLabel(mode: PendingGoogleEventImportBatchDraft["importMode"]): string {
  if (mode === "self_only") {
    return "só eventos com Paulo";
  }
  if (mode === "full_block") {
    return "todos os eventos importáveis";
  }
  return "Paulo + reuniões importantes";
}

export function buildGoogleEventImportBatchDraftReply(draft: PendingGoogleEventImportBatchDraft): string {
  const counts = draft.blockCounts;
  const modeCounts = draft.modeCounts;
  const ignored = draft.ignoredItems?.filter((item) => item.category === "informational" || item.category === "holiday") ?? [];
  const demands = draft.demands ?? draft.ignoredItems?.filter((item) => item.category === "demand") ?? [];
  const ambiguous = draft.ambiguousItems ?? draft.ignoredItems?.filter((item) => item.category === "ambiguous") ?? [];
  const assumptions = compactImportAssumptions(draft.assumptions ?? []);

  return [
    "Rascunho de importação pronto.",
    ...(draft.sourceLabel ? [`Origem: ${draft.sourceLabel}`] : []),
    counts
      ? `Identifiquei ${counts.total} bloco(s): ${counts.event_importable} importável(is), ${counts.informational} informativo(s), ${counts.demand} demanda(s), ${counts.holiday} feriado(s) e ${counts.ambiguous} ambíguo(s).`
      : `Eventos importáveis no rascunho: ${draft.events.length}.`,
    `Prévia exibida no modo: ${formatImportModeLabel(draft.importMode)}.`,
    ...(typeof draft.relevantCount === "number" ? [`Relevantes para você: ${draft.relevantCount}.`] : []),
    "",
    "Rascunho importável:",
    ...(draft.events.length > 0
      ? draft.events.map((event) => formatImportEventLine(event, draft.timezone))
      : ["- Nenhum evento selecionado neste modo."]),
    ...(ignored.length
      ? [
          "",
          "Informativos/feriados ignorados:",
          ...formatGroupedImportIgnoredLines(ignored),
        ]
      : []),
    ...(demands.length
      ? [
          "",
          "Demandas detectadas:",
          ...formatGroupedImportIgnoredLines(demands),
        ]
      : []),
    ...(ambiguous.length
      ? [
          "",
          "Blocos ambíguos para revisão:",
          ...formatGroupedImportIgnoredLines(ambiguous),
        ]
      : []),
    ...(assumptions.length
      ? [
          "",
          "Observações:",
          ...assumptions.map((item) => `- ${item}`),
        ]
      : []),
    "",
    "Opções antes de importar:",
    `1. importar só os que têm Paulo${modeCounts ? ` (${modeCounts.self_only})` : ""}`,
    `2. importar meus eventos + reuniões importantes${modeCounts ? ` (${modeCounts.self_plus_structural})` : ""}`,
    `3. importar tudo que parece evento real${modeCounts ? ` (${modeCounts.full_block})` : ""}`,
    "",
    "Responda `1`, `2` ou `3` para ajustar o lote. Para já seguir, você pode usar `2 e agendar`, `agendar modo 2` ou `importar 2`. Para descartar, use `cancelar rascunho`.",
    "",
    "GOOGLE_EVENT_IMPORT_BATCH_DRAFT",
    JSON.stringify(draft),
    "END_GOOGLE_EVENT_IMPORT_BATCH_DRAFT",
  ].join("\n");
}
