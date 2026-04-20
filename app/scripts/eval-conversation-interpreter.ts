import process from "node:process";
import { interpretConversationTurn } from "../src/core/conversation-interpreter.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

function run(): void {
  const results: EvalResult[] = [];

  const followUpTime = interpretConversationTurn({
    text: "às 8h",
    pendingFlow: { kind: "calendar_draft" },
  });
  results.push({
    name: "followup_time_after_calendar_draft",
    passed: followUpTime.isFollowUp && followUpTime.suggestedAction === "continue_pending_flow",
    detail: JSON.stringify(followUpTime, null, 2),
  });

  const correctionTomorrow = interpretConversationTurn({
    text: "não, quis dizer amanhã",
    pendingFlow: { kind: "calendar_draft" },
  });
  results.push({
    name: "correction_after_pending_calendar_flow",
    passed: correctionTomorrow.isCorrection && correctionTomorrow.isFollowUp && !correctionTomorrow.isTopicShift,
    detail: JSON.stringify(correctionTomorrow, null, 2),
  });

  const weatherTopicShift = interpretConversationTurn({
    text: "qual o clima hoje?",
    pendingFlow: { kind: "monitored_alert" },
  });
  results.push({
    name: "weather_interrupts_monitored_alert",
    passed: weatherTopicShift.isTopicShift && weatherTopicShift.skill === "weather",
    detail: JSON.stringify(weatherTopicShift, null, 2),
  });

  const shortConfirmation = interpretConversationTurn({
    text: "sim",
    pendingFlow: { kind: "monitored_alert" },
  });
  results.push({
    name: "sim_confirms_pending_alert",
    passed: shortConfirmation.isShortConfirmation && shortConfirmation.isFollowUp,
    detail: JSON.stringify(shortConfirmation, null, 2),
  });

  const cancellation = interpretConversationTurn({
    text: "deixa isso",
    pendingFlow: { kind: "monitored_alert" },
  });
  results.push({
    name: "deixa_is_pending_cancellation",
    passed: cancellation.isCancellation && cancellation.suggestedAction === "cancel_pending_flow",
    detail: JSON.stringify(cancellation, null, 2),
  });

  const visualWithPrint = interpretConversationTurn({
    text: "quero que veja isso",
    attachments: [{ kind: "image" }],
  });
  results.push({
    name: "visual_message_with_attachment_routes_visual_skill",
    passed: visualWithPrint.skill === "visual_task" && visualWithPrint.suggestedAction === "route_visual_task",
    detail: JSON.stringify(visualWithPrint, null, 2),
  });

  const agendaImport = interpretConversationTurn({
    text: "transforma essa agenda em eventos",
    attachments: [{ kind: "image" }, { kind: "image" }],
  });
  results.push({
    name: "agenda_attachment_prefers_agenda_import",
    passed: agendaImport.intent === "agenda_import" && agendaImport.skill === "agenda",
    detail: JSON.stringify(agendaImport, null, 2),
  });

  const correctedType = interpretConversationTurn({
    text: "isso não era tarefa, era evento",
    pendingFlow: { kind: "clarification" },
  });
  results.push({
    name: "event_task_correction_exposes_entity",
    passed: correctedType.isCorrection && correctedType.entities.corrected_target_type === "event",
    detail: JSON.stringify(correctedType, null, 2),
  });

  const greeting = interpretConversationTurn({
    text: "oi atlas, como está?",
  });
  results.push({
    name: "greeting_is_not_technical_route",
    passed: greeting.intent === "greeting" && greeting.skill === "greeting" && greeting.suggestedAction === "respond_direct",
    detail: JSON.stringify(greeting, null, 2),
  });

  const audioLikeFollowUp = interpretConversationTurn({
    text: "na abordagem",
    pendingFlow: { kind: "calendar_draft" },
    attachments: [{ kind: "audio" }],
  });
  results.push({
    name: "audio_like_short_reply_continues_calendar_flow",
    passed: audioLikeFollowUp.isFollowUp && audioLikeFollowUp.entities.calendar_account === "abordagem",
    detail: JSON.stringify(audioLikeFollowUp, null, 2),
  });

  const briefing = interpretConversationTurn({
    text: "briefing da manhã",
  });
  results.push({
    name: "briefing_routes_to_briefing_skill",
    passed: briefing.intent === "morning_brief" && briefing.skill === "briefing",
    detail: JSON.stringify(briefing, null, 2),
  });

  const recentInfo = interpretConversationTurn({
    text: "qual a cotação do dólar hoje?",
  });
  results.push({
    name: "recent_external_info_routes_to_web_search_intent",
    passed: recentInfo.intent === "web_search" && recentInfo.skill === "planning",
    detail: JSON.stringify(recentInfo, null, 2),
  });

  const taskRead = interpretConversationTurn({
    text: "me mostra minhas tarefas",
  });
  results.push({
    name: "tasks_read_routes_directly",
    passed: taskRead.intent === "task_read" && taskRead.suggestedAction === "respond_direct",
    detail: JSON.stringify(taskRead, null, 2),
  });

  const naturalTaskWrite = interpretConversationTurn({
    text: "anota isso pra mim",
  });
  results.push({
    name: "natural_task_phrase_routes_to_task_write",
    passed: naturalTaskWrite.intent === "task_write" && naturalTaskWrite.suggestedAction === "draft_then_confirm",
    detail: JSON.stringify(naturalTaskWrite, null, 2),
  });

  const naturalCalendarWrite = interpretConversationTurn({
    text: "coloca na abordagem",
  });
  results.push({
    name: "natural_calendar_phrase_routes_to_calendar_write",
    passed: naturalCalendarWrite.intent === "calendar_write" && naturalCalendarWrite.entities.calendar_account === "abordagem",
    detail: JSON.stringify(naturalCalendarWrite, null, 2),
  });

  const declarativeCalendarWrite = interpretConversationTurn({
    text: "amanhã terei uma reunião no Caps Girassol, às 9h da manhã.",
  });
  results.push({
    name: "declarative_commitment_routes_to_calendar_write",
    passed: declarativeCalendarWrite.intent === "calendar_write"
      && declarativeCalendarWrite.suggestedAction === "draft_then_confirm",
    detail: JSON.stringify(declarativeCalendarWrite, null, 2),
  });

  const socialVisual = interpretConversationTurn({
    text: "analisa esse perfil",
    attachments: [{ kind: "image" }],
  });
  results.push({
    name: "profile_attachment_prefers_social_visual_skill",
    passed: socialVisual.intent === "social_profile_analysis" && socialVisual.skill === "visual_task",
    detail: JSON.stringify(socialVisual, null, 2),
  });

  const documentVisual = interpretConversationTurn({
    text: "olha esse pdf",
    attachments: [{ kind: "pdf" }],
  });
  results.push({
    name: "pdf_attachment_prefers_document_review",
    passed: documentVisual.intent === "document_review" && documentVisual.skill === "visual_task",
    detail: JSON.stringify(documentVisual, null, 2),
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

  console.log(`\nConversation interpreter evals ok: ${results.length}/${results.length}`);
}

run();
