import process from "node:process";
import { buildGoogleEventImportBatchDraftReply, type PendingGoogleEventImportBatchDraft } from "../src/core/google-draft-utils.js";
import {
  cleanScheduleImportTitle,
  refineScheduleImportEvents,
  resolveScheduleImportReplyCommand,
  resolveScheduleImportModeReply,
} from "../src/core/schedule-import-refinement.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const timezone = "America/Sao_Paulo";

function iso(date: string, time: string): string {
  return `${date}T${time}:00-03:00`;
}

function run() {
  const results: EvalResult[] = [];
  const refined = refineScheduleImportEvents(
    [
      {
        summary: "Paulo e Juliana: Sistemática Belém",
        start: iso("2026-04-20", "08:00"),
        end: iso("2026-04-20", "12:00"),
        timezone,
        sourceLabel: "manhã",
        personallyRelevant: true,
      },
      {
        summary: "Juliana e Paulo: CREAS",
        start: iso("2026-04-20", "13:30"),
        end: iso("2026-04-20", "17:00"),
        timezone,
        sourceLabel: "tarde",
        personallyRelevant: true,
      },
      {
        summary: "Reunião Ampliada",
        start: iso("2026-04-22", "08:00"),
        end: iso("2026-04-22", "12:00"),
        timezone,
        sourceLabel: "manhã",
      },
      {
        summary: "Simone: Fora da carga",
        start: iso("2026-04-22", "08:00"),
        end: iso("2026-04-22", "12:00"),
        timezone,
        sourceLabel: "manhã",
      },
      {
        summary: "FERIADO",
        start: iso("2026-04-21", "08:00"),
        end: iso("2026-04-21", "17:00"),
        timezone,
        sourceLabel: "integral",
      },
      {
        summary: "Juliana: TI",
        start: iso("2026-04-23", "13:30"),
        end: iso("2026-04-23", "17:00"),
        timezone,
        sourceLabel: "tarde",
      },
      {
        summary: "Equipe: Visita território",
        start: iso("2026-04-24", "13:30"),
        end: iso("2026-04-24", "17:00"),
        timezone,
        sourceLabel: "tarde",
      },
      {
        summary: "Paulo e Simone: Juntos na Rua",
        start: iso("2026-04-25", "13:30"),
        end: iso("2026-04-25", "17:00"),
        timezone,
        sourceLabel: "tarde",
        personallyRelevant: true,
        location: "Rua",
      },
      {
        summary: "David e Paulo: Sistemática Restinga - Lisandro",
        start: iso("2026-04-26", "08:00"),
        end: iso("2026-04-26", "12:00"),
        timezone,
        sourceLabel: "manhã",
        personallyRelevant: true,
        rawText: "David e Paulo: Sistemática até às 7:00 (entrada Restinga)",
      },
      {
        summary: "Bloco pouco legível",
        start: iso("2026-04-24", "08:00"),
        end: iso("2026-04-24", "12:00"),
        timezone,
        sourceLabel: "manhã",
        confidence: 0.3,
      },
    ],
    {
      nonEvents: [
        {
          summary: "Joacy e Luiz Eduardo: ver questão do RG",
          category: "demand",
          reason: "item estava na seção Demandas",
        },
      ],
      assumptions: ["Usado o ano corrente 2026."],
    },
  );

  const selfOnly = refineScheduleImportEvents(refined.allImportableEvents, { mode: "self_only" });
  const fullBlock = refineScheduleImportEvents(refined.allImportableEvents, { mode: "full_block" });

  results.push({
    name: "morning_shift_uses_0800_1200",
    passed: refined.allImportableEvents.some((event) =>
      event.shift === "manhã" &&
      event.assumedTime === true &&
      event.start.includes("08:00") &&
      event.end.includes("12:00")),
    detail: JSON.stringify(refined.allImportableEvents, null, 2),
  });

  results.push({
    name: "afternoon_shift_uses_1330_1700",
    passed: refined.allImportableEvents.some((event) =>
      event.shift === "tarde" &&
      event.assumedTime === true &&
      event.start.includes("13:30") &&
      event.end.includes("17:00")),
    detail: JSON.stringify(refined.allImportableEvents, null, 2),
  });

  results.push({
    name: "titles_are_cleaned",
    passed:
      cleanScheduleImportTitle("Paulo e Juliana: Sistemática Belém") === "Paulo e Juliana - Sistemática Belém" &&
      cleanScheduleImportTitle("Juliana e Paulo: CREAS") === "Juliana e Paulo - CREAS",
  });

  results.push({
    name: "holiday_does_not_become_regular_event",
    passed: refined.ignoredItems.some((item) => item.category === "holiday" && item.summary === "FERIADO") &&
      !refined.allImportableEvents.some((event) => event.summary === "FERIADO"),
    detail: JSON.stringify(refined.ignoredItems, null, 2),
  });

  results.push({
    name: "demand_section_is_separate",
    passed: refined.demands.some((item) => item.summary.includes("Joacy e Luiz Eduardo")) &&
      !refined.allImportableEvents.some((event) => event.summary.includes("Joacy e Luiz Eduardo")),
    detail: JSON.stringify(refined.demands, null, 2),
  });

  results.push({
    name: "self_only_selects_only_paulo_events",
    passed: selfOnly.selectedEvents.length === 4 &&
      selfOnly.selectedEvents.every((event) => event.summary.toLowerCase().includes("paulo")),
    detail: JSON.stringify(selfOnly.selectedEvents, null, 2),
  });

  results.push({
    name: "self_plus_structural_includes_important_meetings",
    passed: refined.selectedEvents.some((event) => event.summary === "Reunião Ampliada") &&
      refined.selectedEvents.some((event) => event.summary.includes("Paulo")),
    detail: JSON.stringify(refined.selectedEvents, null, 2),
  });

  results.push({
    name: "informational_blocks_are_not_default_events",
    passed: refined.ignoredItems.some((item) => item.summary === "Simone - Fora da Carga") &&
      refined.ignoredItems.some((item) => item.summary === "Juliana - TI"),
    detail: JSON.stringify(refined.ignoredItems, null, 2),
  });

  results.push({
    name: "pseudo_location_rua_is_removed",
    passed: refined.allImportableEvents.some((event) =>
      event.summary === "Paulo e Simone - Juntos na Rua" &&
      !event.location),
    detail: JSON.stringify(refined.allImportableEvents, null, 2),
  });

  results.push({
    name: "suspicious_original_time_is_flagged",
    passed: refined.allImportableEvents.some((event) =>
      event.summary === "David e Paulo - Sistemática Restinga - Lisandro" &&
      event.reviewWarning === "horário original parecia inconsistente"),
    detail: JSON.stringify(refined.allImportableEvents, null, 2),
  });

  const draft: PendingGoogleEventImportBatchDraft = {
    kind: "google_event_import_batch",
    timezone,
    account: "abordagem",
    events: refined.selectedEvents,
    allImportableEvents: refined.allImportableEvents,
    ignoredItems: refined.ignoredItems,
    demands: refined.demands,
    ambiguousItems: refined.ambiguousItems,
    blockCounts: refined.blockCounts,
    modeCounts: refined.modeCounts,
    importMode: refined.mode,
    assumptions: [
      ...refined.observations,
      "Horário assumido por turno: manhã.",
      "Horário assumido por turno: tarde.",
    ],
  };
  const reply = buildGoogleEventImportBatchDraftReply(draft);
  const visibleReply = reply.split("\n\nGOOGLE_EVENT_IMPORT_BATCH_DRAFT")[0] ?? reply;
  results.push({
    name: "draft_reply_is_legible",
    passed:
      visibleReply.includes("Rascunho importável:") &&
      visibleReply.includes("Informativos/feriados ignorados:") &&
      visibleReply.includes("Demandas detectadas:") &&
      visibleReply.includes("Opções antes de importar:"),
    detail: visibleReply,
  });

  results.push({
    name: "partial_ambiguity_does_not_block_clear_events",
    passed: refined.ambiguousItems.length === 1 && refined.selectedEvents.length > 0,
    detail: JSON.stringify({ ambiguous: refined.ambiguousItems, selected: refined.selectedEvents }, null, 2),
  });

  results.push({
    name: "mode_reply_parser_accepts_review_choices",
    passed:
      resolveScheduleImportModeReply("1") === "self_only" &&
      resolveScheduleImportModeReply("a segunda") === "self_plus_structural" &&
      resolveScheduleImportModeReply("importar tudo") === "full_block",
  });

  results.push({
    name: "draft_reply_uses_preview_label_instead_of_selected_mode",
    passed:
      visibleReply.includes("Prévia exibida no modo:") &&
      !visibleReply.includes("Modo selecionado:"),
    detail: visibleReply,
  });

  results.push({
    name: "draft_reply_does_not_repeat_turn_when_time_is_explicit",
    passed:
      !visibleReply.includes("08:00-12:00 manhã") &&
      !visibleReply.includes("13:30-17:00 tarde"),
    detail: visibleReply,
  });

  const duplicatedDraftReply = buildGoogleEventImportBatchDraftReply({
    ...draft,
    ignoredItems: [
      {
        summary: "Simone - Fora da Carga",
        category: "informational",
        reason: "informativo",
        date: "17/04",
        shift: "manhã",
      },
      {
        summary: "Simone - Fora da Carga",
        category: "informational",
        reason: "informativo",
        date: "17/04",
        shift: "tarde",
      },
      {
        summary: "Simone - Fora da Carga",
        category: "informational",
        reason: "informativo",
        date: "17/04",
        shift: "tarde",
      },
    ],
    demands: [],
    ambiguousItems: [],
  });
  results.push({
    name: "informational_duplicates_are_grouped_cleanly",
    passed:
      duplicatedDraftReply.includes("Simone - Fora da Carga (17/04 manhã e tarde)") &&
      !duplicatedDraftReply.includes("17/04 manhã; 17/04 tarde; 17/04 tarde"),
    detail: duplicatedDraftReply,
  });

  results.push({
    name: "observations_are_compacted",
    passed:
      visibleReply.includes("Quando o horário não apareceu no material, usei o padrão: manhã 08:00-12:00 e tarde 13:30-17:00.") &&
      !visibleReply.includes("Horário assumido por turno: manhã.") &&
      !visibleReply.includes("Horário assumido por turno: tarde."),
    detail: visibleReply,
  });

  results.push({
    name: "suspicious_time_warning_appears_in_visible_draft",
    passed: visibleReply.includes("atenção: horário original parecia inconsistente"),
    detail: visibleReply,
  });

  results.push({
    name: "combined_confirmation_2_e_agendar_is_understood",
    passed:
      resolveScheduleImportReplyCommand("2 e agendar")?.mode === "self_plus_structural" &&
      resolveScheduleImportReplyCommand("2 e agendar")?.confirm === true,
  });

  results.push({
    name: "combined_confirmation_agendar_modo_2_is_understood",
    passed:
      resolveScheduleImportReplyCommand("agendar modo 2")?.mode === "self_plus_structural" &&
      resolveScheduleImportReplyCommand("agendar modo 2")?.confirm === true,
  });

  results.push({
    name: "combined_confirmation_importar_2_is_understood",
    passed:
      resolveScheduleImportReplyCommand("importar 2")?.mode === "self_plus_structural" &&
      resolveScheduleImportReplyCommand("importar 2")?.confirm === true,
  });

  results.push({
    name: "full_block_keeps_all_real_events_only",
    passed: fullBlock.selectedEvents.length === 6 &&
      fullBlock.selectedEvents.every((event) => event.importCategory === "event_importable"),
    detail: JSON.stringify(fullBlock.selectedEvents, null, 2),
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

  console.log(`\nSchedule import refinement evals ok: ${results.length}/${results.length}`);
}

run();
