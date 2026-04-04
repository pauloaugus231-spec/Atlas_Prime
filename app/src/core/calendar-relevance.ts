export interface CalendarRelevanceInput {
  account: string;
  summary?: string;
  description?: string;
  location?: string;
}

export const PERSONAL_CALENDAR_INCLUDE_TERMS: Record<string, string[]> = {
  abordagem: [
    "paulo",
    "espaco de cuidados",
    "espaço de cuidados",
    "banho",
    "adulto",
    "equipe adulto",
  ],
};

function normalize(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export function matchPersonalCalendarTerms(input: CalendarRelevanceInput): string[] {
  const terms = PERSONAL_CALENDAR_INCLUDE_TERMS[input.account] ?? [];
  if (terms.length === 0) {
    return [];
  }

  const haystack = normalize([input.summary, input.description, input.location].filter(Boolean).join(" "));
  if (!haystack) {
    return [];
  }

  return [...new Set(
    terms
      .map((term) => normalize(term))
      .filter((term) => Boolean(term) && haystack.includes(term)),
  )];
}

export function isPersonallyRelevantCalendarEvent(input: CalendarRelevanceInput): boolean {
  const rules = PERSONAL_CALENDAR_INCLUDE_TERMS[input.account];
  if (!rules?.length) {
    return true;
  }

  return matchPersonalCalendarTerms(input).length > 0;
}
