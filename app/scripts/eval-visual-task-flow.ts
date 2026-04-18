import process from "node:process";
import {
  buildVisualTaskFailureReply,
  buildVisualTaskState,
  buildVisualTaskStrategyReply,
  buildVisualTaskUnsupportedReply,
  detectVisualTaskPlan,
  markVisualTaskExtractionFailed,
  shouldAttemptScheduleImport,
} from "../src/integrations/telegram/visual-task-flow.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

function run() {
  const results: EvalResult[] = [];
  const baseAttachment = {
    fileId: "file-1",
    fileName: "agenda-semanal.jpg",
    mimeType: "image/jpeg",
    kind: "image" as const,
  };

  const agendaPlan = detectVisualTaskPlan({
    text: "transforma essa agenda semanal em eventos",
    attachmentKind: "image",
  });
  const agendaState = buildVisualTaskState({
    plan: agendaPlan,
    attachment: baseAttachment,
    now: 1,
  });
  const agendaStrategy = buildVisualTaskStrategyReply(agendaState, agendaPlan);
  results.push({
    name: "print_agenda_gets_guided_strategy_before_extraction",
    passed:
      agendaPlan.kind === "agenda_import" &&
      shouldAttemptScheduleImport(agendaPlan) &&
      agendaStrategy.includes("Vou tentar extrair") &&
      agendaStrategy.includes("Se eu não conseguir ler com segurança"),
    detail: agendaStrategy,
  });

  const failedAgenda = markVisualTaskExtractionFailed(
    agendaState,
    "não consegui identificar eventos válidos",
    2,
  );
  const failureReply = buildVisualTaskFailureReply(failedAgenda);
  results.push({
    name: "partial_failure_keeps_visual_task_open",
    passed:
      failedAgenda.status === "awaiting_better_material" &&
      failureReply.includes("continuo com o objetivo") &&
      failureReply.includes("Assim que você mandar o próximo material"),
    detail: failureReply,
  });

  results.push({
    name: "partial_failure_suggests_better_formats",
    passed:
      failureReply.includes("print mais nítido") &&
      failureReply.includes("PDF pesquisável") &&
      failureReply.includes("cortes por dia/período"),
    detail: failureReply,
  });

  const secondState = buildVisualTaskState({
    previous: failedAgenda,
    plan: agendaPlan,
    attachment: {
      ...baseAttachment,
      fileId: "file-2",
      fileName: "agenda-semanal-2.jpg",
    },
    now: 3,
  });
  const multiReply = buildVisualTaskStrategyReply(secondState, agendaPlan);
  results.push({
    name: "multiple_files_are_treated_as_same_visual_task",
    passed: secondState.files.length === 2 && multiReply.includes("Recebi 2 materiais desta tarefa visual"),
    detail: multiReply,
  });

  const continuationPlan = detectVisualTaskPlan({
    text: "",
    attachmentKind: "image",
    previous: failedAgenda,
  });
  results.push({
    name: "new_file_continues_previous_visual_task_kind",
    passed: continuationPlan.kind === "agenda_import",
    detail: JSON.stringify(continuationPlan, null, 2),
  });

  const socialPlan = detectVisualTaskPlan({
    text: "analisa meu perfil por esses prints",
    attachmentKind: "image",
  });
  const socialState = buildVisualTaskState({
    plan: socialPlan,
    attachment: {
      fileId: "profile-1",
      fileName: "perfil.png",
      mimeType: "image/png",
      kind: "image",
    },
    now: 4,
  });
  const socialReply = [
    buildVisualTaskStrategyReply(socialState, socialPlan),
    buildVisualTaskUnsupportedReply(socialState, socialPlan),
  ].join("\n");
  results.push({
    name: "social_profile_visual_task_is_guided_without_blind_parser",
    passed:
      socialPlan.kind === "social_profile_analysis" &&
      !shouldAttemptScheduleImport(socialPlan) &&
      socialReply.includes("prints do perfil") &&
      socialReply.includes("não vou tentar uma extração automática completa"),
    detail: socialReply,
  });

  const taskPlan = detectVisualTaskPlan({
    text: "extrai as tarefas dessa imagem",
    attachmentKind: "image",
  });
  results.push({
    name: "task_extraction_visual_request_gets_specific_kind",
    passed: taskPlan.kind === "task_extraction" && taskPlan.expectedData.includes("tarefas"),
    detail: JSON.stringify(taskPlan, null, 2),
  });

  const nonVisualPlan = detectVisualTaskPlan({
    text: "qual o clima hoje?",
    attachmentKind: "image",
  });
  results.push({
    name: "non_visual_text_with_attachment_does_not_force_agenda_import",
    passed: nonVisualPlan.kind === "general_visual" && !shouldAttemptScheduleImport(nonVisualPlan),
    detail: JSON.stringify(nonVisualPlan, null, 2),
  });

  const strongAgendaVisualPlan = detectVisualTaskPlan({
    text: "",
    attachmentKind: "image",
    agendaEvidence: {
      confidence: 0.84,
      signals: ["datas dd/mm", "turnos", "grade semanal"],
    },
  });
  results.push({
    name: "single_print_with_strong_visual_agenda_signal_routes_to_agenda_import",
    passed: strongAgendaVisualPlan.kind === "agenda_import" && shouldAttemptScheduleImport(strongAgendaVisualPlan),
    detail: JSON.stringify(strongAgendaVisualPlan, null, 2),
  });

  const priorGenericState = buildVisualTaskState({
    plan: nonVisualPlan,
    attachment: {
      fileId: "generic-1",
      fileName: "print-1.jpg",
      mimeType: "image/jpeg",
      kind: "image",
    },
    now: 5,
  });
  const secondAgendaLikePlan = detectVisualTaskPlan({
    text: "",
    attachmentKind: "image",
    previous: priorGenericState,
    agendaEvidence: {
      confidence: 0.58,
      signals: ["datas dd/mm", "manhã/tarde"],
    },
  });
  results.push({
    name: "second_print_of_same_batch_upgrades_to_agenda_import",
    passed: secondAgendaLikePlan.kind === "agenda_import" && shouldAttemptScheduleImport(secondAgendaLikePlan),
    detail: JSON.stringify(secondAgendaLikePlan, null, 2),
  });

  const ambiguousAgendaPlan = detectVisualTaskPlan({
    text: "",
    attachmentKind: "image",
    agendaEvidence: {
      confidence: 0.46,
      signals: ["datas dd/mm", "turnos"],
    },
  });
  const ambiguousState = buildVisualTaskState({
    plan: ambiguousAgendaPlan,
    attachment: {
      fileId: "amb-1",
      fileName: "ambiguous.jpg",
      mimeType: "image/jpeg",
      kind: "image",
    },
    now: 6,
  });
  const ambiguousReply = buildVisualTaskStrategyReply(ambiguousState, ambiguousAgendaPlan);
  results.push({
    name: "ambiguous_print_asks_short_question",
    passed:
      ambiguousAgendaPlan.kind === "general_visual" &&
      !shouldAttemptScheduleImport(ambiguousAgendaPlan) &&
      ambiguousReply.includes("Isso parece uma agenda semanal"),
    detail: ambiguousReply,
  });

  const genericThenEvidenceReply = buildVisualTaskStrategyReply(
    buildVisualTaskState({
      previous: priorGenericState,
      plan: secondAgendaLikePlan,
      attachment: {
        fileId: "generic-2",
        fileName: "print-2.jpg",
        mimeType: "image/jpeg",
        kind: "image",
      },
      now: 7,
    }),
    secondAgendaLikePlan,
  );
  results.push({
    name: "generic_batch_with_more_evidence_does_not_repeat_generic_waiting_reply",
    passed:
      !genericThenEvidenceReply.includes("Posso trabalhar com:") &&
      genericThenEvidenceReply.includes("Vou tentar extrair"),
    detail: genericThenEvidenceReply,
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

  console.log(`\nVisual task flow evals ok: ${results.length}/${results.length}`);
}

run();
