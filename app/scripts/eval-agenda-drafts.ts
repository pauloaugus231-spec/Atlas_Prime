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

  const eventPrefixDraft = buildEventDraftFromPrompt(
    "cria o evento provas da faculdade dia 15 de junho às 8 da manhã",
    timezone,
  );
  results.push({
    name: "event_prefix_is_removed_from_clean_title",
    passed: Boolean(
      eventPrefixDraft.draft &&
      eventPrefixDraft.draft.summary === "Provas da faculdade" &&
      eventPrefixDraft.draft.start.includes("-06-15T08:00"),
    ),
    detail: JSON.stringify(eventPrefixDraft, null, 2),
  });

  const createEventDraft = buildEventDraftFromPrompt(
    "cria um evento provas da faculdade dia 15 de junho às 8 da manhã",
    timezone,
  );
  results.push({
    name: "create_event_command_is_not_part_of_title",
    passed: Boolean(
      createEventDraft.draft &&
      createEventDraft.draft.summary === "Provas da faculdade" &&
      createEventDraft.draft.start.includes("-06-15T08:00"),
    ),
    detail: JSON.stringify(createEventDraft, null, 2),
  });

  const agendaVerbDraft = buildEventDraftFromPrompt(
    "agenda prova da faculdade dia 15 às 8",
    timezone,
  );
  results.push({
    name: "agenda_as_imperative_creates_clean_title",
    passed: Boolean(
      agendaVerbDraft.draft &&
      agendaVerbDraft.draft.summary === "Prova da faculdade" &&
      agendaVerbDraft.draft.start.includes("T08:00"),
    ),
    detail: JSON.stringify(agendaVerbDraft, null, 2),
  });

  const agendaPhraseDraft = buildEventDraftFromPrompt(
    "coloca na agenda provas da faculdade dia 15 de junho às 8",
    timezone,
  );
  results.push({
    name: "coloca_na_agenda_prefix_is_removed",
    passed: Boolean(
      agendaPhraseDraft.draft &&
      agendaPhraseDraft.draft.summary === "Provas da faculdade" &&
      agendaPhraseDraft.draft.start.includes("-06-15T08:00"),
    ),
    detail: JSON.stringify(agendaPhraseDraft, null, 2),
  });

  const calledDraft = buildEventDraftFromPrompt(
    "cria um compromisso chamado provas da faculdade dia 15 às 8",
    timezone,
  );
  results.push({
    name: "called_phrase_is_removed_from_title",
    passed: Boolean(
      calledDraft.draft &&
      calledDraft.draft.summary === "Provas da faculdade" &&
      calledDraft.draft.start.includes("T08:00"),
    ),
    detail: JSON.stringify(calledDraft, null, 2),
  });

  const acronymDraft = buildEventDraftFromPrompt(
    "cria um evento reunião do caps dia 15 de junho às 8",
    timezone,
  );
  results.push({
    name: "event_title_uses_natural_capitalization_and_acronyms",
    passed: Boolean(
      acronymDraft.draft &&
      acronymDraft.draft.summary === "Reunião do CAPS" &&
      acronymDraft.draft.start.includes("-06-15T08:00"),
    ),
    detail: JSON.stringify(acronymDraft, null, 2),
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
