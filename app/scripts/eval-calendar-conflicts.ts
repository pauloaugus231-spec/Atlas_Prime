import process from "node:process";
import { analyzeCalendarInsights } from "../src/core/calendar-insights.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

function run() {
  const results: EvalResult[] = [];
  const insights = analyzeCalendarInsights([
    {
      account: "primary",
      summary: "Reunião CREAS",
      start: "2026-04-17T08:00:00-03:00",
      end: "2026-04-17T09:00:00-03:00",
      location: "CREAS Restinga",
      owner: "paulo",
    },
    {
      account: "abordagem",
      summary: "Reunião CREAS",
      start: "2026-04-17T08:00:00-03:00",
      end: "2026-04-17T09:00:00-03:00",
      location: "CREAS Restinga",
      owner: "equipe",
    },
    {
      account: "primary",
      summary: "Acompanhamento Guto",
      start: "2026-04-17T08:30:00-03:00",
      end: "2026-04-17T10:00:00-03:00",
      location: "Restinga",
      owner: "paulo",
    },
    {
      account: "abordagem",
      summary: "Acomp. Guto",
      start: "2026-04-17T08:30:00-03:00",
      end: "2026-04-17T10:00:00-03:00",
      location: "Restinga",
      owner: "equipe",
    },
  ], "America/Sao_Paulo");

  results.push({
    name: "detects_overlap",
    passed: insights.some((item) => item.kind === "overlap"),
    detail: JSON.stringify(insights, null, 2),
  });

  results.push({
    name: "detects_duplicate",
    passed: insights.some((item) => item.kind === "duplicate"),
    detail: JSON.stringify(insights, null, 2),
  });

  results.push({
    name: "detects_inconsistent_name",
    passed: insights.some((item) => item.kind === "inconsistent_name"),
    detail: JSON.stringify(insights, null, 2),
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

  console.log(`\nCalendar conflict evals ok: ${results.length}/${results.length}`);
}

run();
