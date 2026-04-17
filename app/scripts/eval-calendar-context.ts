import process from "node:process";
import {
  adjustEventDraftFromInstruction,
  buildEventDraftFromPrompt,
} from "../src/core/google-draft-utils.js";
import {
  extractExplicitGoogleAccountAlias,
  resolveGoogleAccountAliasesForPrompt,
  resolveShortGoogleAccountReply,
} from "../src/core/google-account-resolution.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

function localHour(iso: string): number {
  const match = iso.match(/T(\d{2}):/);
  return match ? Number.parseInt(match[1], 10) : -1;
}

function run() {
  const aliases = ["primary", "abordagem"];
  const timezone = "America/Sao_Paulo";
  const results: EvalResult[] = [];

  results.push({
    name: "agenda_abordagem_resolves_to_work_account",
    passed: JSON.stringify(resolveGoogleAccountAliasesForPrompt("qual minha agenda da abordagem hoje?", aliases)) === JSON.stringify(["abordagem"]),
  });

  results.push({
    name: "ambos_resolves_to_primary_and_abordagem",
    passed: JSON.stringify(resolveGoogleAccountAliasesForPrompt("ambos", aliases)) === JSON.stringify(["primary", "abordagem"]),
  });

  results.push({
    name: "write_prompt_resolves_abordagem_account",
    passed: extractExplicitGoogleAccountAlias("crie esse evento na abordagem", aliases) === "abordagem",
  });

  results.push({
    name: "update_prompt_resolves_da_abordagem_account",
    passed: extractExplicitGoogleAccountAlias("mova esse evento da abordagem para 15h", aliases) === "abordagem",
  });

  results.push({
    name: "short_context_reply_resolves_abordagem_account",
    passed: JSON.stringify(resolveShortGoogleAccountReply("na abordagem", aliases)) === JSON.stringify({ kind: "single", account: "abordagem" }),
  });

  results.push({
    name: "short_context_reply_resolves_primary_account",
    passed: JSON.stringify(resolveShortGoogleAccountReply("no pessoal", aliases)) === JSON.stringify({ kind: "single", account: "primary" }),
  });

  const combinedDraft = buildEventDraftFromPrompt(
    "crie um evento Reunião teste contextual amanhã às 8h da manhã na abordagem",
    timezone,
  ).draft;
  results.push({
    name: "short_time_context_builds_calendar_draft_at_8am",
    passed: Boolean(combinedDraft && localHour(combinedDraft.start) === 8 && !combinedDraft.location),
    detail: JSON.stringify(combinedDraft, null, 2),
  });

  const baseDraft = buildEventDraftFromPrompt(
    "crie um evento Reunião teste contextual amanhã às 10h na abordagem",
    timezone,
  ).draft;
  const adjusted = baseDraft ? adjustEventDraftFromInstruction(baseDraft, "às 8h da manhã") : null;
  results.push({
    name: "short_time_context_adjusts_pending_calendar_draft",
    passed: Boolean(adjusted && localHour(adjusted.start) === 8),
    detail: JSON.stringify(adjusted, null, 2),
  });

  results.push({
    name: "abordagem_account_is_not_treated_as_event_location",
    passed: Boolean(combinedDraft && !combinedDraft.location),
    detail: JSON.stringify(combinedDraft, null, 2),
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

  console.log(`\nCalendar context evals ok: ${results.length}/${results.length}`);
}

run();
