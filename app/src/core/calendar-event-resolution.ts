import type { CalendarEventSummary } from "../integrations/google/google-workspace.js";

type CalendarAction = "move" | "delete" | "update";

export interface CalendarEventResolutionWorkspace {
  getStatus(): { ready: boolean };
  listEventsInWindow(input: {
    timeMin: string;
    timeMax: string;
    maxResults?: number;
    calendarId?: string;
    query?: string;
  }): Promise<CalendarEventSummary[]>;
}

export interface CalendarEventResolutionAccounts {
  getWorkspace(alias?: string): CalendarEventResolutionWorkspace;
}

export interface ResolveCalendarEventReferenceInput {
  accounts: CalendarEventResolutionAccounts;
  aliases: string[];
  timezone: string;
  timeMin: string;
  timeMax: string;
  action: CalendarAction;
  topic?: string;
  calendarId?: string;
  recentMessages?: string[];
}

export type ResolveCalendarEventReferenceResult =
  | {
      kind: "resolved";
      match: {
        account: string;
        calendarId?: string;
        event: CalendarEventSummary;
      };
    }
  | {
      kind: "clarify";
      message: string;
    }
  | {
      kind: "not_found";
      message: string;
    };

interface ResolvedCalendarCandidate {
  account: string;
  calendarId?: string;
  event: CalendarEventSummary;
  score: number;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hasNonEmptyString(value: string | undefined | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function formatEventSlot(
  event: CalendarEventSummary,
  timezone: string,
): string {
  if (!event.start) {
    return "sem horário";
  }
  const start = new Date(event.start);
  if (Number.isNaN(start.getTime())) {
    return event.start;
  }
  const startLabel = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(start);
  if (!event.end) {
    return startLabel;
  }
  const end = new Date(event.end);
  if (Number.isNaN(end.getTime())) {
    return startLabel;
  }
  const endLabel = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(end);
  return `${startLabel}–${endLabel}`;
}

function buildCalendarClarification(
  action: CalendarAction,
  candidates: ResolvedCalendarCandidate[],
  timezone: string,
): string {
  const verb = action === "delete" ? "ajustar/remover" : "ajustar";
  const preview = candidates
    .slice(0, 2)
    .map((item, index) =>
      `${index + 1}) ${item.event.summary} — ${formatEventSlot(item.event, timezone)}${item.event.location ? ` — ${item.event.location}` : ""} | conta: ${item.account}`,
    )
    .join("\n");
  return [
    "Encontrei mais de um evento compatível.",
    `Qual opção você quer ${verb}? Responda com 1 ou 2.`,
    preview,
  ].join("\n");
}

function scoreEventCandidate(
  event: CalendarEventSummary,
  topic: string | undefined,
  recentMessages: string[],
): number {
  if (!topic) {
    return hasNonEmptyString(event.summary) ? 10 : 0;
  }

  const normalizedTopic = normalize(topic);
  const normalizedSummary = normalize(event.summary);
  const normalizedContext = normalize([
    event.summary,
    event.description,
    event.location,
  ].filter(Boolean).join(" "));

  let score = 0;
  if (normalizedSummary === normalizedTopic) {
    score += 120;
  } else if (normalizedSummary.includes(normalizedTopic)) {
    score += 100;
  }

  const topicTokens = normalizedTopic.split(" ").filter((token) => token.length >= 3);
  const matchedTokens = topicTokens.filter((token) => normalizedSummary.includes(token));
  if (topicTokens.length > 0 && matchedTokens.length === topicTokens.length) {
    score += 80;
  } else if (matchedTokens.length > 0) {
    score += matchedTokens.length * 14;
  }

  const contextTokenMatches = topicTokens.filter((token) => normalizedContext.includes(token)).length;
  score += contextTokenMatches * 6;

  if (recentMessages.length > 0) {
    const recentHaystack = normalize(recentMessages.join(" \n "));
    if (recentHaystack.includes(normalizedSummary)) {
      score += 12;
    }
    if (event.location && recentHaystack.includes(normalize(event.location))) {
      score += 6;
    }
  }

  return score;
}

async function collectCandidates(
  input: ResolveCalendarEventReferenceInput,
): Promise<ResolvedCalendarCandidate[]> {
  const candidates: ResolvedCalendarCandidate[] = [];

  for (const alias of input.aliases) {
    const workspace = input.accounts.getWorkspace(alias);
    if (!workspace.getStatus().ready) {
      continue;
    }

    const primaryFetch = await workspace.listEventsInWindow({
      timeMin: input.timeMin,
      timeMax: input.timeMax,
      maxResults: 12,
      calendarId: input.calendarId,
      ...(hasNonEmptyString(input.topic) ? { query: input.topic } : {}),
    });

    const fallbackFetch = hasNonEmptyString(input.topic) && primaryFetch.length === 0
      ? await workspace.listEventsInWindow({
          timeMin: input.timeMin,
          timeMax: input.timeMax,
          maxResults: 25,
          calendarId: input.calendarId,
        })
      : [];

    const pool = primaryFetch.length > 0 ? primaryFetch : fallbackFetch;
    for (const event of pool) {
      const score = scoreEventCandidate(event, input.topic, input.recentMessages ?? []);
      if (!hasNonEmptyString(input.topic) || score > 0) {
        candidates.push({
          account: alias,
          calendarId: input.calendarId,
          event,
          score,
        });
      }
    }
  }

  return candidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return (left.event.start ?? "").localeCompare(right.event.start ?? "");
  });
}

export async function resolveCalendarEventReference(
  input: ResolveCalendarEventReferenceInput,
): Promise<ResolveCalendarEventReferenceResult> {
  const candidates = await collectCandidates(input);

  if (candidates.length === 0) {
    return {
      kind: "not_found",
      message: input.topic
        ? `Não encontrei evento correspondente para "${input.topic}".`
        : "Não encontrei evento correspondente no período informado.",
    };
  }

  if (!hasNonEmptyString(input.topic)) {
    if (candidates.length === 1) {
      return {
        kind: "resolved",
        match: candidates[0],
      };
    }
    return {
      kind: "clarify",
      message: buildCalendarClarification(input.action, candidates, input.timezone),
    };
  }

  const best = candidates[0];
  const second = candidates[1];
  if (!best) {
    return {
      kind: "not_found",
      message: `Não encontrei evento correspondente para "${input.topic}".`,
    };
  }

  const strongUniqueMatch = best.score >= 100 && (!second || best.score - second.score >= 18);
  const acceptableUniqueMatch = best.score >= 80 && (!second || best.score - second.score >= 28);
  if (strongUniqueMatch || acceptableUniqueMatch || candidates.length === 1) {
    return {
      kind: "resolved",
      match: best,
    };
  }

  return {
    kind: "clarify",
    message: buildCalendarClarification(input.action, candidates, input.timezone),
  };
}
