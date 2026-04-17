import process from "node:process";
import {
  adjustEventDraftFromInstruction,
  buildEventDraftFromPrompt,
} from "../src/core/google-draft-utils.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

function run() {
  const timezone = "America/Sao_Paulo";
  const results: EvalResult[] = [];

  const simpleDraft = buildEventDraftFromPrompt(
    "agende uma reunião de teste no CAPS Girassol amanhã às 10h na minha agenda principal",
    timezone,
  );
  results.push({
    name: "simple_schedule_defaults_to_one_hour",
    passed: Boolean(
      simpleDraft.draft
      && simpleDraft.draft.summary.toLowerCase().includes("caps girassol")
      && simpleDraft.draft.end !== simpleDraft.draft.start,
      ),
    detail: JSON.stringify(simpleDraft, null, 2),
  });

  const rangedDraft = buildEventDraftFromPrompt(
    "agende reunião interna amanhã das 13h às 17h na agenda principal",
    timezone,
  );
  results.push({
    name: "explicit_range_is_preserved",
    passed: Boolean(
      rangedDraft.draft
      && rangedDraft.draft.start.includes("T13:00")
      && rangedDraft.draft.end.includes("T17:00"),
    ),
    detail: JSON.stringify(rangedDraft, null, 2),
  });

  const adjustedDraft = simpleDraft.draft
    ? adjustEventDraftFromInstruction(simpleDraft.draft, "duração de 2h")
    : null;
  results.push({
    name: "draft_adjustment_changes_duration",
    passed: Boolean(adjustedDraft && adjustedDraft.end !== simpleDraft.draft?.end),
    detail: JSON.stringify(adjustedDraft, null, 2),
  });

  const renamedDraft = simpleDraft.draft
    ? adjustEventDraftFromInstruction(simpleDraft.draft, "titulo: Reunião teste CAPS")
    : null;
  results.push({
    name: "draft_adjustment_changes_title",
    passed: Boolean(renamedDraft && renamedDraft.summary === "Reunião teste CAPS"),
    detail: JSON.stringify(renamedDraft, null, 2),
  });

  const relocatedDraft = simpleDraft.draft
    ? adjustEventDraftFromInstruction(simpleDraft.draft, "local: Sala 5")
    : null;
  results.push({
    name: "draft_adjustment_changes_location",
    passed: Boolean(relocatedDraft && relocatedDraft.location === "Sala 5"),
    detail: JSON.stringify(relocatedDraft, null, 2),
  });

  const movedDraft = simpleDraft.draft
    ? adjustEventDraftFromInstruction(simpleDraft.draft, "às 8h da manhã")
    : null;
  results.push({
    name: "draft_single_time_adjustment_preserves_local_duration",
    passed: Boolean(
      movedDraft &&
      movedDraft.start.includes("T08:00") &&
      movedDraft.end.includes("T09:00")
    ),
    detail: JSON.stringify(movedDraft, null, 2),
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

  console.log(`\nAgenda draft evals ok: ${results.length}/${results.length}`);
}

run();
