import { normalizeEmailAnalysisText } from "../integrations/email/email-analysis.js";
import type { PersonalOperationalProfile } from "../types/personal-operational-memory.js";
import { rankApprovals } from "./approval-priority.js";
import { resolveEffectiveOperationalMode } from "./generic-prompt-helpers.js";
import type { PendingGoogleEventDraft } from "./google-draft-utils.js";
import type { IntentResolution } from "./intent-router.js";
import type { ExecutiveMorningBrief } from "./personal-os.js";

function includesAny(source: string, tokens: string[]): boolean {
  return tokens.some((token) => source.includes(token));
}

export function inferIntentObjective(prompt: string, input: IntentResolution): string {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (includesAny(normalized, ["aprovacoes", "aprovações", "approval"]) && includesAny(normalized, ["agenda", "compromissos", "meu dia"])) {
    return "revisar aprovações e reorganizar a agenda operacional";
  }
  if (includesAny(normalized, ["agenda", "compromissos", "calendario", "calendário"])) {
    return "organizar agenda e compromissos";
  }
  if (includesAny(normalized, ["aprovacoes", "aprovações", "approval"])) {
    return "revisar pendências que exigem aprovação";
  }
  if (input.orchestration.route.actionMode === "schedule") {
    return "agendar ou ajustar um compromisso";
  }
  if (input.orchestration.route.actionMode === "plan") {
    return "montar um plano operacional enxuto";
  }
  if (input.orchestration.route.actionMode === "analyze") {
    return "analisar o pedido e definir o melhor caminho";
  }
  return "executar o pedido com o domínio correto";
}

export function inferIntentNextStep(input: IntentResolution): string | undefined {
  switch (input.orchestration.route.actionMode) {
    case "plan":
      return "Posso transformar isso em um plano curto e priorizado agora.";
    case "schedule":
      return "Posso montar um rascunho de agenda e pedir sua confirmação.";
    case "communicate":
      return "Posso preparar um rascunho de resposta antes de enviar.";
    case "execute":
      return "Posso seguir para a execução assim que o contexto crítico estiver fechado.";
    case "monitor":
      return "Posso consolidar os sinais mais relevantes e devolver um resumo acionável.";
    default:
      return undefined;
  }
}

export function buildOperationalPlanContract(
  prompt: string,
  brief: ExecutiveMorningBrief,
  profile?: PersonalOperationalProfile,
): import("../types/response-contracts.js").OrganizationResponseContract {
  const normalized = normalizeEmailAnalysisText(prompt);
  const operationalMode = resolveEffectiveOperationalMode(prompt, profile);
  const currentSituation: string[] = [];
  const priorities: string[] = [];
  const actionPlan: string[] = [];
  const rankedApprovals = rankApprovals(brief.approvals);
  const pauloEvents = brief.events.filter((event) => event.owner === "paulo");
  const delegableEvents = brief.events.filter((event) => event.owner === "delegavel");
  const conflictEvents = pauloEvents.filter((event) => event.hasConflict);
  const nextPauloEvent = pauloEvents[0];
  const weatherToday = brief.weather?.days[0];
  const topApproval = rankedApprovals[0];
  const topEmail = brief.emails[0];
  const topOverdueTask = brief.taskBuckets.overdue[0];
  const topGoal = brief.activeGoals?.[0];

  if (brief.events.length > 0) {
    currentSituation.push(`${brief.events.length} compromisso(s) no dia`);
  }
  if (brief.goalSummary) {
    currentSituation.push(`objetivos ativos: ${brief.goalSummary.replace(/^Objetivos:\s*/i, "")}`);
  }
  if (nextPauloEvent) {
    currentSituation.push(`seu próximo compromisso: ${nextPauloEvent.summary}`);
  }
  if (delegableEvents.length > 0) {
    currentSituation.push(`${delegableEvents.length} compromisso(s) delegável(is)`);
  }
  if (conflictEvents.length > 0) {
    currentSituation.push(`${conflictEvents.length} conflito(s) de agenda para Paulo`);
  }
  if (topApproval) {
    currentSituation.push(`${brief.approvals.length} aprovação(ões) pendente(s)`);
  }
  if (brief.taskBuckets.overdue.length > 0) {
    currentSituation.push(`${brief.taskBuckets.overdue.length} tarefa(s) atrasada(s)`);
  }
  if (topEmail) {
    currentSituation.push(`email prioritário: ${topEmail.subject}`);
  }
  if (weatherToday) {
    currentSituation.push(`clima hoje: ${weatherToday.description.toLowerCase()} | ${weatherToday.tip}`);
  }
  if (brief.mobilityAlerts[0]) {
    currentSituation.push(`deslocamento: ${brief.mobilityAlerts[0]}`);
  }
  if (brief.conflictSummary.duplicates > 0) {
    currentSituation.push(`${brief.conflictSummary.duplicates} duplicidade(s) provável(is) na agenda`);
  }
  if (operationalMode === "field") {
    currentSituation.push("modo rua ativo neste chat");
  }

  if (conflictEvents[0]) {
    priorities.push(`resolver o conflito de agenda em ${conflictEvents[0].summary}`);
  }
  if (topGoal) {
    priorities.push(`proteger avanço do objetivo ativo: ${topGoal.title}`);
  }
  if (nextPauloEvent) {
    priorities.push(`${nextPauloEvent.prepHint} para ${nextPauloEvent.summary}`);
  }
  if (topApproval) {
    priorities.push(`revisar a aprovação mais urgente: ${topApproval.item.subject} (${topApproval.reason})`);
  }
  if (topOverdueTask) {
    priorities.push(`decidir a tarefa atrasada: ${topOverdueTask.title}`);
  }
  if (topEmail) {
    priorities.push(`validar se o email ${topEmail.subject} exige ação agora`);
  }
  if (brief.mobilityAlerts[0]) {
    priorities.push(`preparar operação externa com base em: ${brief.mobilityAlerts[0]}`);
  }
  if (operationalMode === "field") {
    priorities.push("responder curto e preservar deslocamento");
  }

  if (conflictEvents.length > 0) {
    actionPlan.push("resolver primeiro os conflitos da sua agenda para não travar o restante do dia");
  }
  if (topGoal) {
    actionPlan.push(`alinhar a execução de hoje ao objetivo ativo ${topGoal.title}`);
  }
  if (includesAny(normalized, ["aprovacoes", "aprovações", "approval"]) && topApproval) {
    actionPlan.push("revisar primeiro as aprovações que destravam hoje");
  }
  if (nextPauloEvent) {
    actionPlan.push(`${nextPauloEvent.prepHint} para ${nextPauloEvent.summary}`);
  }
  if (delegableEvents[0]) {
    actionPlan.push(`definir dono para ${delegableEvents[0].summary} e tirar isso do seu foco direto`);
  }
  if (topOverdueTask) {
    actionPlan.push("decidir as tarefas atrasadas antes de abrir novas frentes");
  }
  if (topEmail) {
    actionPlan.push(`validar se o email ${topEmail.subject} exige ação real ou pode esperar`);
  }
  if (brief.dayRecommendation) {
    actionPlan.push(brief.dayRecommendation);
  }
  if (operationalMode === "field") {
    actionPlan.push("evitar novas frentes e operar com checklist curto");
  }

  return {
    objective: inferIntentObjective(prompt, {
      rawPrompt: prompt,
      activeUserPrompt: prompt,
      historyUserTurns: [],
      orchestration: {
        route: {
          primaryDomain: "secretario_operacional",
          secondaryDomains: [],
          confidence: 1,
          actionMode: "plan",
          reasons: [],
        },
        policy: {
          riskLevel: "low",
          autonomyLevel: "observe_only",
          guardrails: [],
          requiresApprovalFor: [],
          capabilities: {
            canReadSensitiveChannels: false,
            canDraftExternalReplies: false,
            canSendExternalReplies: false,
            canWriteWorkspace: false,
            canPersistMemory: false,
            canRunProjectTools: false,
            canModifyCalendar: false,
            canPublishContent: false,
          },
        },
      },
      mentionedDomains: [],
      compoundIntent: includesAny(normalized, [" e ", " junto "]),
    }),
    currentSituation,
    priorities,
    actionPlan,
    recommendedNextStep: conflictEvents[0]
      ? `Resolver o conflito envolvendo ${conflictEvents[0].summary}.`
      : nextPauloEvent
        ? `${nextPauloEvent.prepHint[0]?.toUpperCase() ?? ""}${nextPauloEvent.prepHint.slice(1)} para ${nextPauloEvent.summary}.`
        : topApproval
          ? `Decidir a aprovação ${topApproval.item.subject}.`
          : brief.dayRecommendation ?? brief.nextAction ?? actionPlan[0],
  };
}

export function shouldAutoCreateGoogleEvent(prompt: string, draft: PendingGoogleEventDraft, writeReady: boolean): boolean {
  if (!writeReady) {
    return false;
  }
  if ((draft.attendees?.length ?? 0) > 0 || draft.createMeet) {
    return false;
  }

  const normalized = normalizeEmailAnalysisText(prompt);
  const explicitSelfCalendarRequest = includesAny(normalized, [
    "coloque no meu calendario",
    "coloca no meu calendario",
    "coloque na minha agenda",
    "coloca na minha agenda",
    "adicione no meu calendario",
    "adicione na minha agenda",
    "coloque um evento no meu calendario",
    "coloque um evento na minha agenda",
    "crie um evento no meu calendario",
    "crie um evento na minha agenda",
  ]);
  if (!explicitSelfCalendarRequest) {
    return false;
  }

  const hedged = includesAny(normalized, [
    "rascunho",
    "proponha",
    "sugira",
    "sugerir",
    "pode criar",
    "se der",
    "talvez",
  ]);
  return !hedged;
}

export function buildDirectGoogleEventCreateReply(rawResult: unknown, timeZone: string): string {
  const record = rawResult && typeof rawResult === "object" ? (rawResult as Record<string, unknown>) : undefined;
  const event = record?.event && typeof record.event === "object"
    ? (record.event as Record<string, unknown>)
    : undefined;
  const account = typeof record?.account === "string" ? record.account : "primary";
  const lines = ["Evento criado no seu calendário."];
  if (typeof event?.summary === "string") {
    lines.push(`- Título: ${event.summary}`);
  }
  if (typeof event?.start === "string") {
    const formatted = new Intl.DateTimeFormat("pt-BR", {
      timeZone,
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(event.start));
    lines.push(`- Início: ${formatted}`);
  }
  if (typeof event?.end === "string") {
    const formatted = new Intl.DateTimeFormat("pt-BR", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(event.end));
    lines.push(`- Fim: ${formatted}`);
  }
  if (typeof event?.location === "string" && event.location.trim()) {
    lines.push(`- Local: ${event.location}`);
  }
  if (typeof event?.reminderMinutes === "number") {
    lines.push(`- Lembrete: ${event.reminderMinutes} min antes`);
  }
  lines.push(`- Conta: ${account}`);
  if (typeof event?.htmlLink === "string" && event.htmlLink.trim()) {
    lines.push(`- Link: ${event.htmlLink}`);
  }
  lines.push("Se quiser, eu também posso adicionar convidados ou Meet.");
  return lines.join("\n");
}
