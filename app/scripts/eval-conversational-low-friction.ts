import process from "node:process";
import {
  buildGreetingReply,
  rewriteConversationalSimpleReply,
  buildWeatherReply,
  extractConversationStyleCorrection,
  isGreetingPrompt,
  isWeatherPrompt,
  shouldBypassPreLocalExternalReasoningForPrompt,
} from "../src/core/agent-core.js";
import { ResponseOS } from "../src/core/response-os.js";
import type { IntentResolution } from "../src/core/intent-router.js";
import type { OrchestrationContext } from "../src/types/orchestration.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

function buildOrchestration(overrides?: {
  route?: Partial<OrchestrationContext["route"]>;
  policy?: Partial<OrchestrationContext["policy"]>;
}): OrchestrationContext {
  return {
    route: {
      primaryDomain: "secretario_operacional",
      secondaryDomains: [],
      confidence: 0.84,
      actionMode: "plan",
      reasons: ["eval"],
      ...overrides?.route,
    },
    policy: {
      riskLevel: "low",
      autonomyLevel: "autonomous_low_risk",
      guardrails: [],
      requiresApprovalFor: [],
      capabilities: {
        canReadSensitiveChannels: true,
        canDraftExternalReplies: true,
        canSendExternalReplies: false,
        canWriteWorkspace: false,
        canPersistMemory: true,
        canRunProjectTools: false,
        canModifyCalendar: false,
        canPublishContent: false,
      },
      ...overrides?.policy,
    },
  };
}

function buildIntent(input?: Partial<IntentResolution>): IntentResolution {
  return {
    rawPrompt: input?.rawPrompt ?? "Mensagem atual do usuário: oi atlas",
    activeUserPrompt: input?.activeUserPrompt ?? "oi atlas",
    historyUserTurns: input?.historyUserTurns ?? [],
    mentionedDomains: input?.mentionedDomains ?? ["secretario_operacional"],
    compoundIntent: input?.compoundIntent ?? false,
    orchestration: input?.orchestration ?? buildOrchestration(),
  };
}

function buildProfile(): any {
  return {
    displayName: "Paulo",
    responseStyle: "direto e objetivo",
    briefingPreference: "curto",
    detailLevel: "resumo",
    tonePreference: "objetivo",
    defaultOperationalMode: "normal",
    autonomyPreferences: ["leituras simples executam direto"],
  };
}

function run() {
  const responseOs = new ResponseOS();
  const results: EvalResult[] = [];

  const greetingReply = buildGreetingReply("oi atlas, como está?", {
    profile: buildProfile(),
  });
  results.push({
    name: "greeting_is_short_human_and_personal",
    passed: isGreetingPrompt("oi atlas, como está?")
      && greetingReply.includes("Estou bem, Paulo")
      && !greetingReply.includes("Conclusão")
      && !greetingReply.includes("A)"),
    detail: greetingReply,
  });

  const bomDiaReply = buildGreetingReply("bom dia", {
    profile: buildProfile(),
  });
  results.push({
    name: "bom_dia_reply_is_natural",
    passed: isGreetingPrompt("bom dia")
      && bomDiaReply.includes("Bom dia")
      && bomDiaReply.includes("Paulo"),
    detail: bomDiaReply,
  });

  const tudoCertoReply = buildGreetingReply("tudo certo?", {
    profile: buildProfile(),
  });
  results.push({
    name: "tudo_certo_reply_is_natural",
    passed: isGreetingPrompt("tudo certo?")
      && tudoCertoReply.includes("Tudo certo por aqui"),
    detail: tudoCertoReply,
  });
  results.push({
    name: "day_status_is_not_greeting_prompt",
    passed: !isGreetingPrompt("como está meu dia?"),
    detail: "como está meu dia?",
  });

  const weatherReply = buildWeatherReply({
    locationLabel: "Porto Alegre",
    timezone: "America/Sao_Paulo",
    current: {
      description: "céu limpo",
      temperatureC: 19,
    },
    daily: [
      {
        date: "2026-04-19",
        description: "céu limpo",
        minTempC: 17,
        maxTempC: 27,
        precipitationProbabilityMax: 0,
      },
      {
        date: "2026-04-20",
        description: "parcialmente nublado",
        minTempC: 18,
        maxTempC: 25,
        precipitationProbabilityMax: 10,
      },
    ],
  });
  results.push({
    name: "simple_weather_reply_is_direct_without_menu",
    passed: isWeatherPrompt("qual o clima hoje?")
      && weatherReply.includes("Hoje em Porto Alegre")
      && !weatherReply.includes("A)")
      && !weatherReply.includes("Conclusão")
      && !weatherReply.includes("Tempo em"),
    detail: weatherReply,
  });

  const taskReply = responseOs.buildTaskReviewReply({
    scopeLabel: "Google Tasks das contas conectadas",
    items: [
      {
        title: "Entregar relatório",
        taskListTitle: "Pessoal",
        account: "primary",
        status: "needsAction",
        dueLabel: "19/04, 10:00",
      },
      {
        title: "Revisar agenda",
        taskListTitle: "Abordagem",
        account: "abordagem",
        status: "needsAction",
        dueLabel: "19/04, 14:00",
      },
    ],
    recommendedNextStep: "Começar por Entregar relatório.",
  });
  results.push({
    name: "simple_tasks_reply_is_not_technical",
    passed: taskReply.includes("Você tem 2 tarefas abertas")
      && !taskReply.includes("Leitura operacional")
      && taskReply.includes("Se quiser, o próximo passo é"),
    detail: taskReply,
  });

  const scheduleReply = responseOs.buildScheduleLookupReply({
    targetLabel: "amanhã",
    topicLabel: "caps",
    events: [
      {
        account: "abordagem",
        summary: "Reunião no CAPS",
        start: "20/04, 08:00",
        location: "CAPS Restinga",
      },
    ],
    recommendedNextStep: "Revisar se existe conflito no mesmo turno.",
  });
  results.push({
    name: "simple_schedule_reply_is_not_report_like",
    passed: scheduleReply.includes("Encontrei 1 compromisso")
      && !scheduleReply.includes("Leitura operacional")
      && scheduleReply.includes("Se quiser, o próximo passo é"),
    detail: scheduleReply,
  });

  results.push({
    name: "greeting_bypasses_pre_local_external_reasoning",
    passed: shouldBypassPreLocalExternalReasoningForPrompt(
      "oi atlas, como está?",
      buildIntent({
        activeUserPrompt: "oi atlas, como está?",
      }),
    ),
  });

  results.push({
    name: "briefing_bypasses_pre_local_external_reasoning",
    passed: shouldBypassPreLocalExternalReasoningForPrompt(
      "briefing da manhã",
      buildIntent({
        activeUserPrompt: "briefing da manhã",
        orchestration: buildOrchestration({
          route: {
            actionMode: "brief",
          },
        }),
      }),
    ),
  });

  results.push({
    name: "tasks_read_bypasses_pre_local_external_reasoning",
    passed: shouldBypassPreLocalExternalReasoningForPrompt(
      "me mostra minhas tarefas",
      buildIntent({
        activeUserPrompt: "me mostra minhas tarefas",
        orchestration: buildOrchestration({
          route: {
            actionMode: "analyze",
          },
        }),
      }),
    ),
  });

  results.push({
    name: "simple_agenda_read_bypasses_pre_local_external_reasoning",
    passed: shouldBypassPreLocalExternalReasoningForPrompt(
      "agenda amanhã",
      buildIntent({
        activeUserPrompt: "agenda amanhã",
      }),
    ),
  });

  const rewrittenGreeting = rewriteConversationalSimpleReply(
    "oi atlas, como está?",
    [
      "Conclusão — Estou bem e pronto para ajudar agora.",
      "",
      "Evidência essencial — já tenho o briefing da manhã salvo.",
      "Lacuna / risco — preciso da sua confirmação explícita.",
      "Próxima ação recomendada — responda com 1, 2 ou 3.",
    ].join("\n"),
    {
      profile: buildProfile(),
    },
  );
  results.push({
    name: "technical_greeting_reply_is_rewritten_to_natural_reply",
    passed: rewrittenGreeting.includes("Estou bem, Paulo")
      && !rewrittenGreeting.includes("Conclusão")
      && !rewrittenGreeting.includes("Evidência essencial"),
    detail: rewrittenGreeting,
  });

  const correction = extractConversationStyleCorrection(
    "essa resposta está muito verbosa, seja mais direto e não precisa perguntar tanto",
    buildProfile(),
  );
  results.push({
    name: "style_correction_feeds_learned_preference",
    passed: Boolean(
      correction
      && correction.preferenceUpdate.responseLength === "short"
      && correction.learnedPreference.type === "response_style"
      && correction.learnedPreference.source === "correction"
      && correction.reply.includes("só vou perguntar quando faltar algo realmente crítico"),
    ),
    detail: correction ? JSON.stringify(correction, null, 2) : "correction=null",
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

  console.log(`\nConversational low-friction evals ok: ${results.length}/${results.length}`);
}

run();
