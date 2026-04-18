export type ScheduleImportCategory =
  | "event_importable"
  | "informational"
  | "demand"
  | "holiday"
  | "ambiguous";

export type ScheduleImportRelevance = "high" | "medium" | "low";

export type ScheduleImportMode = "self_only" | "self_plus_structural" | "full_block";

export interface ScheduleImportRefinementInputEvent {
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  timezone: string;
  calendarId?: string;
  account?: string;
  reminderMinutes?: number;
  createMeet?: boolean;
  confidence?: number;
  sourceLabel?: string;
  personallyRelevant?: boolean;
  matchedTerms?: string[];
  category?: ScheduleImportCategory;
  rawText?: string;
  assumedTime?: boolean;
}

export interface ScheduleImportRefinedEvent extends ScheduleImportRefinementInputEvent {
  summary: string;
  originalSummary?: string;
  importCategory: ScheduleImportCategory;
  relevanceLevel: ScheduleImportRelevance;
  shift?: "manhã" | "tarde" | "integral";
  assumedTime?: boolean;
  structuralEvent?: boolean;
}

export interface ScheduleImportIgnoredItem {
  summary: string;
  category: Exclude<ScheduleImportCategory, "event_importable">;
  reason: string;
  date?: string;
  shift?: string;
  sourceLabel?: string;
  relevanceLevel?: ScheduleImportRelevance;
}

export interface ScheduleImportRefinementResult {
  allImportableEvents: ScheduleImportRefinedEvent[];
  selectedEvents: ScheduleImportRefinedEvent[];
  ignoredItems: ScheduleImportIgnoredItem[];
  demands: ScheduleImportIgnoredItem[];
  ambiguousItems: ScheduleImportIgnoredItem[];
  blockCounts: Record<ScheduleImportCategory, number> & { total: number };
  mode: ScheduleImportMode;
  modeCounts: Record<ScheduleImportMode, number>;
  observations: string[];
}

interface RefineOptions {
  mode?: ScheduleImportMode;
  nonEvents?: ScheduleImportIgnoredItem[];
  assumptions?: string[];
}

const DEFAULT_MODE: ScheduleImportMode = "self_plus_structural";

const KNOWN_ACRONYMS = new Set([
  "caps",
  "creas",
  "cras",
  "seas",
  "paefi",
  "ti",
  "rg",
  "cpf",
  "ubs",
  "sus",
]);

const LOWERCASE_WORDS = new Set(["a", "as", "ao", "aos", "com", "da", "das", "de", "do", "dos", "e", "em", "na", "nas", "no", "nos", "para", "por"]);

function normalize(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cleanSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function includesAny(value: string, tokens: string[]): boolean {
  return tokens.some((token) => value.includes(token));
}

function getLocalHour(value: string, timezone: string): number | undefined {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  const hour = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    hour12: false,
  }).format(date);
  return Number.parseInt(hour, 10);
}

function getLocalTime(value: string, timezone: string): string | undefined {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function getLocalDayMonth(value: string, timezone: string): string | undefined {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function inferShift(event: ScheduleImportRefinementInputEvent): "manhã" | "tarde" | "integral" | undefined {
  const source = normalize(`${event.sourceLabel ?? ""} ${event.summary} ${event.rawText ?? ""}`);
  if (source.includes("manha")) {
    return "manhã";
  }
  if (source.includes("tarde")) {
    return "tarde";
  }
  if (source.includes("integral") || source.includes("dia inteiro")) {
    return "integral";
  }

  const startHour = getLocalHour(event.start, event.timezone);
  if (startHour === undefined) {
    return undefined;
  }
  if (startHour < 12) {
    return "manhã";
  }
  if (startHour >= 12) {
    return "tarde";
  }
  return undefined;
}

function isDefaultShiftTime(event: ScheduleImportRefinementInputEvent, shift: string | undefined): boolean {
  const start = getLocalTime(event.start, event.timezone);
  const end = getLocalTime(event.end, event.timezone);
  if (shift === "manhã") {
    return start === "08:00" && end === "12:00";
  }
  if (shift === "tarde") {
    return start === "13:30" && end === "17:00";
  }
  if (shift === "integral") {
    return start === "08:00" && end === "17:00";
  }
  return false;
}

export function cleanScheduleImportTitle(summary: string): string {
  const withoutNoise = cleanSpaces(summary)
    .replace(/\s*:\s*/g, " - ")
    .replace(/\s+-\s+-\s+/g, " - ")
    .replace(/^(manh[ãa]|tarde|integral)\s+-\s+/i, "")
    .replace(/^demandas?\s+-\s+/i, "")
    .replace(/^evento\s+-\s+/i, "");

  const words = cleanSpaces(withoutNoise).split(" ");
  return words
    .map((word, index) => {
      const parts = word.split("-");
      return parts.map((part) => {
        const normalized = normalize(part);
        if (!part) {
          return part;
        }
        if (KNOWN_ACRONYMS.has(normalized)) {
          return normalized.toUpperCase();
        }
        if (index > 0 && LOWERCASE_WORDS.has(normalized)) {
          return normalized;
        }
        if (/^[A-ZÀ-Ü]{2,}$/.test(part)) {
          return part;
        }
        return `${part.charAt(0).toLocaleUpperCase("pt-BR")}${part.slice(1).toLocaleLowerCase("pt-BR")}`;
      }).join("-");
    })
    .join(" ")
    .replace(/\s+-\s+/g, " - ")
    .trim();
}

function isStructuralEvent(event: ScheduleImportRefinementInputEvent): boolean {
  const source = normalize(`${event.summary} ${event.description ?? ""} ${event.rawText ?? ""}`);
  return includesAny(source, [
    "reuniao de equipe",
    "reuniao ampliada",
    "reuniao de micro",
    "reuniao geral",
    "reuniao seas",
    "rede adulto",
    "micro adulto",
  ]) || (source.includes("reuniao") && includesAny(source, ["equipe", "ampliada", "micro", "seas", "adulto"]));
}

function classifyEvent(event: ScheduleImportRefinementInputEvent): ScheduleImportCategory {
  if (event.category) {
    return event.category;
  }

  const source = normalize(`${event.summary} ${event.description ?? ""} ${event.sourceLabel ?? ""} ${event.rawText ?? ""}`);
  if (source.includes("feriado")) {
    return "holiday";
  }
  if (source.includes("demandas") || source.includes("demanda:") || source.startsWith("demanda ")) {
    return "demand";
  }
  if (includesAny(source, ["fora da carga", "fora de carga"]) || /\b(folga|ferias|ti)\b/.test(source)) {
    return "informational";
  }
  if (typeof event.confidence === "number" && event.confidence < 0.55) {
    return "ambiguous";
  }
  return "event_importable";
}

function relevanceFor(event: ScheduleImportRefinementInputEvent, structuralEvent: boolean, category: ScheduleImportCategory): ScheduleImportRelevance {
  const source = normalize(`${event.summary} ${event.description ?? ""} ${event.rawText ?? ""}`);
  if (event.personallyRelevant || source.includes("paulo") || structuralEvent) {
    return "high";
  }
  if (category === "event_importable") {
    return "medium";
  }
  return "low";
}

function ignoredReason(category: Exclude<ScheduleImportCategory, "event_importable">): string {
  switch (category) {
    case "demand":
      return "demanda separada da agenda";
    case "holiday":
      return "feriado não importado como compromisso comum";
    case "informational":
      return "informativo sem compromisso claro para você";
    case "ambiguous":
      return "bloco ambíguo para revisão";
  }
}

function toIgnoredItem(event: ScheduleImportRefinementInputEvent, category: Exclude<ScheduleImportCategory, "event_importable">): ScheduleImportIgnoredItem {
  const shift = inferShift(event);
  return {
    summary: cleanScheduleImportTitle(event.summary),
    category,
    reason: ignoredReason(category),
    date: getLocalDayMonth(event.start, event.timezone),
    shift,
    sourceLabel: event.sourceLabel,
    relevanceLevel: relevanceFor(event, false, category),
  };
}

export function selectScheduleImportEvents(
  events: ScheduleImportRefinedEvent[],
  mode: ScheduleImportMode = DEFAULT_MODE,
): ScheduleImportRefinedEvent[] {
  return events.filter((event) => {
    if ((event.importCategory ?? "event_importable") !== "event_importable") {
      return false;
    }
    if (mode === "full_block") {
      return true;
    }
    const hasPaulo = normalize(`${event.summary} ${event.description ?? ""} ${event.rawText ?? ""}`).includes("paulo");
    if (mode === "self_only") {
      return hasPaulo;
    }
    return hasPaulo || event.structuralEvent === true;
  });
}

export function resolveScheduleImportModeReply(text: string): ScheduleImportMode | undefined {
  const normalized = normalize(text);
  const shortReply = normalized.split(/\s+/).length <= 6;
  if (
    (/(\b|^)(1|primeira|a primeira)(\b|$)/.test(normalized) && shortReply) ||
    /\b(so os meus|só os meus|meus|apenas paulo|self_only)\b/.test(normalized)
  ) {
    return "self_only";
  }
  if (
    (/(\b|^)(2|segunda|a segunda)(\b|$)/.test(normalized) && shortReply) ||
    /\b(meus eventos|reunioes importantes|reuniões importantes|self_plus_structural)\b/.test(normalized)
  ) {
    return "self_plus_structural";
  }
  if (
    (/(\b|^)(3|terceira|a terceira)(\b|$)/.test(normalized) && shortReply) ||
    /\b(tudo|importar tudo|full_block)\b/.test(normalized)
  ) {
    return "full_block";
  }
  return undefined;
}

export interface ScheduleImportReplyCommand {
  mode?: ScheduleImportMode;
  confirm: boolean;
}

export function resolveScheduleImportReplyCommand(text: string): ScheduleImportReplyCommand | undefined {
  const normalized = normalize(text);
  if (!normalized) {
    return undefined;
  }

  const mode = resolveScheduleImportModeReply(text);
  const confirm =
    /^agendar\b/.test(normalized) ||
    /^agende\b/.test(normalized) ||
    /^importar\b/.test(normalized) ||
    /\be agendar\b/.test(normalized) ||
    /\be seguir\b/.test(normalized);

  if (!mode && !confirm) {
    return undefined;
  }

  return { mode, confirm };
}

export function refineScheduleImportEvents(
  events: ScheduleImportRefinementInputEvent[],
  options: RefineOptions = {},
): ScheduleImportRefinementResult {
  const refined: ScheduleImportRefinedEvent[] = [];
  const ignoredItems: ScheduleImportIgnoredItem[] = [...(options.nonEvents ?? [])];
  const observations = new Set(options.assumptions ?? []);

  for (const event of events) {
    const category = classifyEvent(event);
    if (category !== "event_importable") {
      ignoredItems.push(toIgnoredItem(event, category));
      continue;
    }

    const shift = inferShift(event);
    const structuralEvent = isStructuralEvent(event);
    const cleanedTitle = cleanScheduleImportTitle(event.summary);
    const assumedTime = event.assumedTime === true || isDefaultShiftTime(event, shift);
    if (assumedTime && shift) {
      observations.add(`Horário assumido por turno: ${shift}.`);
    }

    refined.push({
      ...event,
      summary: cleanedTitle,
      originalSummary: event.summary !== cleanedTitle ? event.summary : event.rawText,
      importCategory: "event_importable",
      relevanceLevel: relevanceFor(event, structuralEvent, category),
      shift,
      assumedTime,
      structuralEvent,
    });
  }

  const allImportableEvents = refined.sort((left, right) => left.start.localeCompare(right.start));
  const mode = options.mode ?? DEFAULT_MODE;
  const selectedEvents = selectScheduleImportEvents(allImportableEvents, mode);
  const categorizedIgnored = ignoredItems.map((item) => ({
    ...item,
    summary: cleanScheduleImportTitle(item.summary),
  }));
  const demands = categorizedIgnored.filter((item) => item.category === "demand");
  const ambiguousItems = categorizedIgnored.filter((item) => item.category === "ambiguous");
  const blockCounts = {
    total: allImportableEvents.length + categorizedIgnored.length,
    event_importable: allImportableEvents.length,
    informational: categorizedIgnored.filter((item) => item.category === "informational").length,
    demand: demands.length,
    holiday: categorizedIgnored.filter((item) => item.category === "holiday").length,
    ambiguous: ambiguousItems.length,
  };
  const modeCounts = {
    self_only: selectScheduleImportEvents(allImportableEvents, "self_only").length,
    self_plus_structural: selectScheduleImportEvents(allImportableEvents, "self_plus_structural").length,
    full_block: selectScheduleImportEvents(allImportableEvents, "full_block").length,
  };

  return {
    allImportableEvents,
    selectedEvents,
    ignoredItems: categorizedIgnored,
    demands,
    ambiguousItems,
    blockCounts,
    mode,
    modeCounts,
    observations: Array.from(observations).slice(0, 10),
  };
}
