export interface CalendarInsightEvent {
  account: string;
  summary: string;
  start: string | null;
  end: string | null;
  location?: string;
  owner?: "paulo" | "equipe" | "delegavel";
}

export interface CalendarConflictInsight {
  kind: "overlap" | "duplicate" | "inconsistent_name";
  dayLabel: string;
  events: CalendarInsightEvent[];
  summary: string;
  recommendation: string;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function toDateKey(value: string | null | undefined, timezone: string): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

function formatDayLabel(value: string | null | undefined, timezone: string): string {
  if (!value) {
    return "sem data";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "sem data";
  }
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function rangesOverlap(left: CalendarInsightEvent, right: CalendarInsightEvent): boolean {
  if (!left.start || !left.end || !right.start || !right.end) {
    return false;
  }
  const leftStart = Date.parse(left.start);
  const leftEnd = Date.parse(left.end);
  const rightStart = Date.parse(right.start);
  const rightEnd = Date.parse(right.end);
  if (![leftStart, leftEnd, rightStart, rightEnd].every(Number.isFinite)) {
    return false;
  }
  return leftStart < rightEnd && rightStart < leftEnd;
}

function looksDuplicate(left: CalendarInsightEvent, right: CalendarInsightEvent, timezone: string): boolean {
  if (toDateKey(left.start, timezone) !== toDateKey(right.start, timezone)) {
    return false;
  }
  const sameSummary = normalize(left.summary) === normalize(right.summary);
  const sameLocation = normalize(left.location ?? "") === normalize(right.location ?? "");
  if (!sameSummary) {
    return false;
  }
  if (!left.start || !right.start) {
    return sameLocation;
  }
  return Math.abs(Date.parse(left.start) - Date.parse(right.start)) <= 15 * 60 * 1000;
}

function looksInconsistentDuplicate(left: CalendarInsightEvent, right: CalendarInsightEvent, timezone: string): boolean {
  if (toDateKey(left.start, timezone) !== toDateKey(right.start, timezone)) {
    return false;
  }
  if (!left.start || !right.start) {
    return false;
  }
  if (Math.abs(Date.parse(left.start) - Date.parse(right.start)) > 15 * 60 * 1000) {
    return false;
  }
  const leftSummary = normalize(left.summary);
  const rightSummary = normalize(right.summary);
  if (!leftSummary || !rightSummary || leftSummary === rightSummary) {
    return false;
  }
  const leftTokens = leftSummary.split(" ").filter((token) => token.length >= 4);
  const rightTokens = rightSummary.split(" ").filter((token) => token.length >= 4);
  const shared = leftTokens.filter((token) => rightTokens.includes(token));
  return shared.length >= 1 && normalize(left.location ?? "") === normalize(right.location ?? "");
}

export function analyzeCalendarInsights(
  events: CalendarInsightEvent[],
  timezone: string,
): CalendarConflictInsight[] {
  const insights: CalendarConflictInsight[] = [];

  for (let index = 0; index < events.length; index += 1) {
    for (let candidateIndex = index + 1; candidateIndex < events.length; candidateIndex += 1) {
      const left = events[index];
      const right = events[candidateIndex];
      const dayLabel = formatDayLabel(left.start ?? right.start, timezone);

      if (rangesOverlap(left, right)) {
        insights.push({
          kind: "overlap",
          dayLabel,
          events: [left, right],
          summary: `${left.summary} sobrepõe ${right.summary}`,
          recommendation: "revisar conflito de horário e definir qual evento tem prioridade real",
        });
      }

      if (looksDuplicate(left, right, timezone)) {
        insights.push({
          kind: "duplicate",
          dayLabel,
          events: [left, right],
          summary: `duplicidade provável entre ${left.summary} e ${right.summary}`,
          recommendation: "verificar se um dos eventos é redundante antes de limpar manualmente",
        });
      } else if (looksInconsistentDuplicate(left, right, timezone)) {
        insights.push({
          kind: "inconsistent_name",
          dayLabel,
          events: [left, right],
          summary: `nomes inconsistentes para o mesmo bloco em ${dayLabel}`,
          recommendation: "padronizar o título para facilitar leitura e evitar duplicidade futura",
        });
      }
    }
  }

  return insights;
}
