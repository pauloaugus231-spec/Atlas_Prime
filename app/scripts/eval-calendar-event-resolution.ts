import process from "node:process";
import { resolveCalendarEventReference } from "../src/core/calendar-event-resolution.js";
import type { CalendarEventSummary } from "../src/integrations/google/google-workspace.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

function buildWorkspace(events: CalendarEventSummary[]) {
  return {
    getStatus() {
      return { ready: true };
    },
    async listEventsInWindow(input: {
      query?: string;
    }) {
      if (!input.query?.trim()) {
        return events;
      }
      const normalizedQuery = input.query.toLowerCase();
      return events.filter((event) => event.summary.toLowerCase().includes(normalizedQuery));
    },
  };
}

async function run() {
  const abordagemEvents: CalendarEventSummary[] = [
    {
      id: "evt-1",
      status: "confirmed",
      summary: "Banho",
      start: "2026-04-13T13:30:00-03:00",
      end: "2026-04-13T17:00:00-03:00",
    },
    {
      id: "evt-2",
      status: "confirmed",
      summary: "Espaço de Cuidados",
      location: "CREAS Restinga",
      start: "2026-04-13T13:30:00-03:00",
      end: "2026-04-13T17:00:00-03:00",
    },
    {
      id: "evt-2b",
      status: "confirmed",
      summary: "Cuidados equipe adulto",
      location: "CREAS Restinga",
      start: "2026-04-13T13:30:00-03:00",
      end: "2026-04-13T17:00:00-03:00",
    },
    {
      id: "evt-3",
      status: "confirmed",
      summary: "Reunião CAPS Girassol",
      location: "Restinga",
      start: "2026-04-14T10:00:00-03:00",
      end: "2026-04-14T11:00:00-03:00",
    },
  ];

  const accounts = {
    getWorkspace(alias?: string) {
      return buildWorkspace(alias === "abordagem" ? abordagemEvents : []);
    },
  };

  const results: EvalResult[] = [];

  const unique = await resolveCalendarEventReference({
    accounts,
    aliases: ["abordagem"],
    timezone: "America/Sao_Paulo",
    timeMin: "2026-04-13T00:00:00-03:00",
    timeMax: "2026-04-14T23:59:59-03:00",
    action: "delete",
    topic: "banho",
    recentMessages: ["exclua o evento banho"],
  });
  results.push({
    name: "calendar_resolution_resolves_unique_partial_reference",
    passed: unique.kind === "resolved" && unique.match.event.id === "evt-1",
    detail: JSON.stringify(unique, null, 2),
  });

  const ambiguous = await resolveCalendarEventReference({
    accounts,
    aliases: ["abordagem"],
    timezone: "America/Sao_Paulo",
    timeMin: "2026-04-13T00:00:00-03:00",
    timeMax: "2026-04-14T23:59:59-03:00",
    action: "delete",
    topic: "cuidados",
    recentMessages: ["quero ajustar o evento das 13h30"],
  });
  results.push({
    name: "calendar_resolution_requests_short_clarification_when_ambiguous",
    passed: ambiguous.kind === "clarify" && ambiguous.message.includes("Responda com 1 ou 2"),
    detail: JSON.stringify(ambiguous, null, 2),
  });

  const missing = await resolveCalendarEventReference({
    accounts,
    aliases: ["abordagem"],
    timezone: "America/Sao_Paulo",
    timeMin: "2026-04-13T00:00:00-03:00",
    timeMax: "2026-04-14T23:59:59-03:00",
    action: "move",
    topic: "evento inexistente",
  });
  results.push({
    name: "calendar_resolution_reports_not_found_cleanly",
    passed: missing.kind === "not_found" && missing.message.includes("Não encontrei"),
    detail: JSON.stringify(missing, null, 2),
  });

  const failures = results.filter((item) => !item.passed);
  for (const item of results.filter((entry) => entry.passed)) {
    console.log(`PASS ${item.name}`);
  }

  if (failures.length > 0) {
    console.error("");
    for (const item of failures) {
      console.error(`FAIL ${item.name}`);
      if (item.detail) {
        console.error(item.detail);
      }
      console.error("");
    }
    process.exitCode = 1;
    return;
  }

  console.log(`\nCalendar resolution evals ok: ${results.length}/${results.length}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
