import type { BriefingPresentationConfig, BriefingProfile } from "../types/briefing-profile.js";
import type { PersonalOperationalProfile } from "../types/personal-operational-memory.js";
import type {
  ExecutiveBriefEmail,
  ExecutiveBriefEvent,
  ExecutiveMorningBrief,
} from "./personal-os.js";

export interface MorningBriefCommitment {
  timeLabel: string;
  title: string;
  note?: string;
}

export interface MorningBriefPlan {
  purpose: "daily_prep";
  variant: "normal" | "compact";
  greeting: string;
  dayRead: string;
  attention: string;
  firstMove: string;
  commitments: MorningBriefCommitment[];
  watchpoint: string;
  closingLabel: "Mensagem do dia" | "Mensagem";
  closingMessage: string;
}

function normalize(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value: string | undefined, max = 96): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function formatTime(value: string | null | undefined, timezone: string): string {
  if (!value) {
    return "sem horário";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

function getPresentation(profile: BriefingProfile): Required<BriefingPresentationConfig> {
  return {
    hierarchy: profile.presentation?.hierarchy ?? "daily_prep_v1",
    tone: profile.presentation?.tone ?? (profile.style === "compact" ? "compact_direct" : "human_firm"),
    maxPrimaryCommitments: profile.presentation?.maxPrimaryCommitments ?? 3,
    weatherMode: profile.presentation?.weatherMode ?? "inline",
    workflowMode: profile.presentation?.workflowMode ?? "if_priority",
    emailMode: profile.presentation?.emailMode ?? "if_critical",
    approvalMode: profile.presentation?.approvalMode ?? "if_urgent",
    watchpointMode: profile.presentation?.watchpointMode ?? "operational_risk_first",
    compactWhenFieldMode: profile.presentation?.compactWhenFieldMode ?? true,
  };
}

function sortEvents(events: ExecutiveBriefEvent[]): ExecutiveBriefEvent[] {
  return [...events].sort((left, right) => {
    const leftMs = left.start ? Date.parse(left.start) : Number.POSITIVE_INFINITY;
    const rightMs = right.start ? Date.parse(right.start) : Number.POSITIVE_INFINITY;
    return leftMs - rightMs;
  });
}

function firstName(value: string | undefined): string | undefined {
  const normalized = (value ?? "").trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.split(/\s+/)[0];
}

function hasFieldDay(brief: ExecutiveMorningBrief): boolean {
  return brief.mobilityAlerts.length > 0 || brief.events.some((event) => event.context === "externo");
}

function hasUrgentEmail(brief: ExecutiveMorningBrief): boolean {
  return brief.emails.some((item) => {
    const priority = normalize(item.priority);
    return priority === "alta" || priority === "urgente" || priority === "urgent";
  });
}

function pickUrgentEmail(brief: ExecutiveMorningBrief): ExecutiveBriefEmail | undefined {
  return brief.emails.find((item) => {
    const priority = normalize(item.priority);
    return priority === "urgente" || priority === "urgent" || priority === "alta";
  });
}

function buildGreeting(brief: ExecutiveMorningBrief, profile?: PersonalOperationalProfile): string {
  const localNow = new Date(new Date().toLocaleString("en-US", { timeZone: brief.timezone }));
  const base = localNow.getHours() >= 18 ? "Boa noite" : localNow.getHours() >= 12 ? "Boa tarde" : "Bom dia";
  const name = firstName(profile?.displayName);
  return name ? `${base}, ${name}.` : `${base}.`;
}

function buildWeatherRead(brief: ExecutiveMorningBrief, presentation: Required<BriefingPresentationConfig>): string | undefined {
  if (presentation.weatherMode === "hidden" || !brief.weather?.current?.description?.trim()) {
    return undefined;
  }

  const description = truncate(brief.weather.current.description, 56);
  const temperature = typeof brief.weather.current.temperatureC === "number"
    ? `${Math.round(brief.weather.current.temperatureC)}°C`
    : undefined;

  if (presentation.weatherMode === "field_only" && !hasFieldDay(brief)) {
    return undefined;
  }

  if (hasFieldDay(brief)) {
    return temperature
      ? `Clima em ${brief.weather.locationLabel}: ${description}, ${temperature}.`
      : `Clima em ${brief.weather.locationLabel}: ${description}.`;
  }

  return temperature
    ? `Clima de saída: ${description}, ${temperature}.`
    : `Clima de saída: ${description}.`;
}

function buildDayRead(
  brief: ExecutiveMorningBrief,
  presentation: Required<BriefingPresentationConfig>,
): string {
  const firstEvent = sortEvents(brief.events)[0];
  const weatherRead = buildWeatherRead(brief, presentation);
  let base = "Hoje o dia pede direção antes de velocidade.";

  if (brief.overloadLevel === "pesado") {
    base = "Hoje o dia pede foco no essencial e menos dispersão.";
  } else if (brief.conflictSummary.overlaps > 0) {
    base = "Hoje o dia pede ajuste cedo para não carregar conflito até mais tarde.";
  } else if (hasFieldDay(brief)) {
    base = "Dia de rua, com atenção a deslocamento e margem entre compromissos.";
  } else if (firstEvent?.start) {
    const firstHour = Number.parseInt(formatTime(firstEvent.start, brief.timezone).slice(0, 2), 10);
    base = Number.isFinite(firstHour) && firstHour < 10
      ? "Hoje teu dia começa cedo e pede entrada organizada."
      : "Hoje o dia começa mais estável e pede constância."
      ;
  } else if (brief.taskBuckets.actionableCount > 0) {
    base = "Hoje o avanço depende mais de execução do que de abrir novas frentes.";
  }

  return [base, weatherRead].filter(Boolean).join(" ");
}

function buildAttention(brief: ExecutiveMorningBrief): string {
  const pendingApprovals = brief.approvals.filter((item) => item.status === "pending");
  if (brief.conflictSummary.overlaps > 0) {
    return "Resolve primeiro os conflitos de agenda antes de assumir novas frentes.";
  }
  if (pendingApprovals.length > 0) {
    return "Resolve primeiro o que depende da tua aprovação para não travar o resto do dia.";
  }
  if (brief.taskBuckets.overdue.length > 0) {
    return "Protege cedo a pendência atrasada que pode contaminar teu ritmo do dia.";
  }
  if (hasUrgentEmail(brief)) {
    return "Responde cedo o ponto sensível que pode virar atraso se ficar para depois.";
  }
  if (hasFieldDay(brief)) {
    return "Prepara cedo o que exige rua, deslocamento ou material antes de abrir outras frentes.";
  }
  if (brief.dayRecommendation?.trim()) {
    return truncate(brief.dayRecommendation, 120);
  }
  return "O principal agora é proteger o que realmente move teu dia.";
}

function buildFirstMove(brief: ExecutiveMorningBrief): string {
  if (brief.nextAction?.trim()) {
    return truncate(brief.nextAction, 120);
  }

  const firstPendingApproval = brief.approvals.find((item) => item.status === "pending");
  if (firstPendingApproval) {
    return `Revisar a aprovação pendente mais importante: ${truncate(firstPendingApproval.subject, 88)}.`;
  }

  if (brief.conflictSummary.overlaps > 0) {
    return "Revisar o conflito de agenda mais cedo e decidir o que fica de pé.";
  }

  const firstOverdue = brief.taskBuckets.overdue[0];
  if (firstOverdue) {
    return `Definir o próximo passo de ${truncate(firstOverdue.title, 80)}.`;
  }

  const firstEvent = sortEvents(brief.events)[0];
  if (firstEvent) {
    return firstEvent.context === "externo"
      ? `Preparar deslocamento e material para ${truncate(firstEvent.summary, 72)}.`
      : `Entrar bem no primeiro compromisso: ${truncate(firstEvent.summary, 72)}.`;
  }

  return "Começa pelo ponto que elimina mais atrito do teu dia.";
}

function summarizeLocation(value: string | undefined): string | undefined {
  const text = truncate(value, 34);
  if (!text) {
    return undefined;
  }
  return text.replace(/\s+-\s+[^-]+$/u, "").trim();
}

function rankEvent(event: ExecutiveBriefEvent): number {
  let score = 0;
  if (event.owner === "paulo") {
    score += 4;
  }
  if (event.hasConflict) {
    score += 4;
  }
  if (event.context === "externo") {
    score += 3;
  }
  if (event.start) {
    const time = Date.parse(event.start);
    score += Number.isFinite(time) ? Math.max(0, 2 - Math.floor(time / (1000 * 60 * 60 * 8))) : 0;
  }
  return score;
}

function buildCommitments(
  brief: ExecutiveMorningBrief,
  presentation: Required<BriefingPresentationConfig>,
): MorningBriefCommitment[] {
  return sortEvents(brief.events)
    .map((event) => ({ event, rank: rankEvent(event) }))
    .sort((left, right) => right.rank - left.rank || (Date.parse(left.event.start ?? "") - Date.parse(right.event.start ?? "")))
    .slice(0, presentation.maxPrimaryCommitments)
    .map(({ event }) => ({
      timeLabel: formatTime(event.start, brief.timezone),
      title: truncate(event.summary, 64),
      ...(event.context === "externo" && summarizeLocation(event.location) ? { note: summarizeLocation(event.location) } : {}),
    }));
}

function buildWatchpoint(
  brief: ExecutiveMorningBrief,
  presentation: Required<BriefingPresentationConfig>,
): string {
  const pendingApprovals = brief.approvals.filter((item) => item.status === "pending");
  if (presentation.watchpointMode === "operational_risk_first" && brief.conflictSummary.overlaps > 0) {
    return `Há ${brief.conflictSummary.overlaps} conflito(s) de agenda que podem travar teu fluxo se ficarem para depois.`;
  }
  if (brief.taskBuckets.overdue.length > 0) {
    return `Há ${brief.taskBuckets.overdue.length} pendência(s) atrasada(s) que podem pesar teu ritmo se ficarem para mais tarde.`;
  }
  if (pendingApprovals.length > 0) {
    return `Há ${pendingApprovals.length} aprovação(ões) pendente(s) que podem travar teu andamento se ficarem para depois.`;
  }
  const urgentEmail = pickUrgentEmail(brief);
  if (urgentEmail) {
    return `Existe uma resposta importante esperando teu retorno: ${truncate(urgentEmail.subject, 72)}.`;
  }
  const activeSignal = brief.operationalSignals.find((item) => item.active && item.priority !== "low");
  if (activeSignal) {
    return truncate(activeSignal.summary, 108);
  }
  if (brief.mobilityAlerts[0]) {
    return truncate(brief.mobilityAlerts[0], 108);
  }
  return "O que pode te travar hoje é espalhar energia cedo demais.";
}

function buildClosing(brief: ExecutiveMorningBrief): string {
  if (brief.motivation.text?.trim()) {
    return truncate(brief.motivation.text, 120);
  }
  if (brief.overloadLevel === "pesado") {
    return "Protege o essencial primeiro. O resto só merece espaço depois.";
  }
  if (hasFieldDay(brief)) {
    return "Leve direção contigo. Rua sem direção vira desgaste.";
  }
  return "Clareza cedo costuma economizar o peso do resto do dia.";
}

export class MorningBriefPolicy {
  buildPlan(input: {
    brief: ExecutiveMorningBrief;
    profile: BriefingProfile;
    personalProfile?: PersonalOperationalProfile;
    compact?: boolean;
    operationalMode?: "field" | null;
  }): MorningBriefPlan {
    const presentation = getPresentation(input.profile);
    const fieldMode = input.operationalMode === "field" || hasFieldDay(input.brief) || input.personalProfile?.defaultOperationalMode === "field";
    const prefersCompact = input.profile.style === "compact"
      || input.personalProfile?.briefingPreference === "curto"
      || (input.profile.style === "auto" && input.brief.overloadLevel === "pesado");
    const variant = input.compact === true || (presentation.compactWhenFieldMode && fieldMode) || prefersCompact
      ? "compact"
      : "normal";

    return {
      purpose: "daily_prep",
      variant,
      greeting: buildGreeting(input.brief, input.personalProfile),
      dayRead: buildDayRead(input.brief, presentation),
      attention: buildAttention(input.brief),
      firstMove: buildFirstMove(input.brief),
      commitments: buildCommitments(input.brief, {
        ...presentation,
        maxPrimaryCommitments: variant === "compact"
          ? Math.min(2, presentation.maxPrimaryCommitments)
          : presentation.maxPrimaryCommitments,
      }),
      watchpoint: buildWatchpoint(input.brief, presentation),
      closingLabel: variant === "compact" ? "Mensagem" : "Mensagem do dia",
      closingMessage: buildClosing(input.brief),
    };
  }
}
