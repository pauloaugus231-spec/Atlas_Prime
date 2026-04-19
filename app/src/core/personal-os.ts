import type { ApprovalInboxStore } from "./approval-inbox.js";
import { rankApprovals } from "./approval-priority.js";
import { isPersonallyRelevantCalendarEvent, matchPersonalCalendarTerms } from "./calendar-relevance.js";
import type { CommunicationRouter } from "./contact-intelligence.js";
import type { FounderOpsService, FounderOpsSnapshot } from "./founder-ops.js";
import type { ContextMemoryService, ScopedMemorySummary } from "./context-memory.js";
import type { MemoryEntityStore } from "./memory-entity-store.js";
import type { OperationalMemoryStore } from "./operational-memory.js";
import type { PersonalOperationalMemoryStore } from "./personal-operational-memory.js";
import { WeatherService, type WeatherForecastResult } from "./weather-service.js";
import type { WorkflowOrchestratorStore } from "./workflow-orchestrator.js";
import { analyzeCalendarInsights } from "./calendar-insights.js";
import type { Logger } from "../types/logger.js";
import type { ApprovalInboxItemRecord } from "../types/approval-inbox.js";
import type { BriefingConfig } from "../types/config.js";
import type { MemoryEntityKind } from "../types/memory-entities.js";
import type { PersonalOperationalProfile } from "../types/personal-operational-memory.js";
import type { OperationalStateSignal } from "../types/operational-state.js";
import type { TaskSummary } from "../integrations/google/google-workspace.js";
import type { EmailAccountsService } from "../integrations/email/email-accounts.js";
import type { GoogleWorkspaceAccountsService } from "../integrations/google/google-workspace-accounts.js";
import { normalizeEmailAnalysisText, summarizeEmailForOperations, type EmailOperationalGroup } from "../integrations/email/email-analysis.js";

export interface ExecutiveBriefEvent {
  account: string;
  summary: string;
  start: string | null;
  end?: string | null;
  location?: string;
  matchedTerms?: string[];
  owner: "paulo" | "equipe" | "delegavel";
  context: "externo" | "interno";
  hasConflict: boolean;
  prepHint: string;
}

export interface ExecutiveBriefEmail {
  account: string;
  uid: string;
  subject: string;
  from: string[];
  priority: string;
  action: string;
  relationship: string;
  group: EmailOperationalGroup;
}

export interface ExecutiveBriefTask extends TaskSummary {
  account: string;
}

export interface ExecutiveBriefTaskBuckets {
  today: ExecutiveBriefTask[];
  overdue: ExecutiveBriefTask[];
  stale: ExecutiveBriefTask[];
  actionableCount: number;
}

export interface ExecutiveBriefWorkflow {
  id: number;
  title: string;
  status: string;
  nextAction: string | null;
}

export interface ExecutiveBriefFocusItem {
  title: string;
  nextAction: string;
}

export interface ExecutiveBriefEntity {
  id: string;
  kind: MemoryEntityKind;
  title: string;
  tags: string[];
  actionHint?: string;
}

export interface ExecutiveBriefEntitySummary {
  total: number;
  byKind: Partial<Record<MemoryEntityKind, number>>;
  recent: ExecutiveBriefEntity[];
}

export interface ExecutiveMorningBrief {
  timezone: string;
  events: ExecutiveBriefEvent[];
  taskBuckets: ExecutiveBriefTaskBuckets;
  emails: ExecutiveBriefEmail[];
  approvals: ApprovalInboxItemRecord[];
  workflows: ExecutiveBriefWorkflow[];
  focus: ExecutiveBriefFocusItem[];
  memoryEntities: ExecutiveBriefEntitySummary;
  motivation: {
    text: string;
    author?: string;
  };
  founderSnapshot: FounderOpsSnapshot;
  nextAction?: string;
  personalFocus: string[];
  overloadLevel: "leve" | "moderado" | "pesado";
  mobilityAlerts: string[];
  operationalSignals: OperationalStateSignal[];
  conflictSummary: {
    overlaps: number;
    duplicates: number;
    naming: number;
  };
  dayRecommendation?: string;
  weather?: {
    locationLabel: string;
    current?: {
      description: string;
      temperatureC?: number;
    };
    days: Array<{
      label: string;
      description: string;
      minTempC?: number;
      maxTempC?: number;
      precipitationProbabilityMax?: number;
      tip: string;
    }>;
  };
}

const EXECUTIVE_BRIEF_CALENDAR_ALIASES = new Set(["primary", "abordagem"]);
const TEAM_EVENT_HINTS = [
  "juliana",
  "maira",
  "máira",
  "simone",
  "equipe",
  "grupo",
  "trabalho interno",
  "acompanhamento",
  "muralismo",
  "reuniao",
  "reunião",
  "cras",
  "creas",
  "caps",
  "domiciliados",
];

const EXTERNAL_EVENT_HINTS = [
  "creas",
  "cras",
  "caps",
  "restinga",
  "extremo sul",
  "casa da sopa",
  "amurt",
  "amurtel",
  "justica itinerante",
  "justiça itinerante",
  "rua",
  "visita",
  "acolhida",
  "acompanhamento",
];

function includesAny(source: string, tokens: string[]): boolean {
  return tokens.some((token) => source.includes(token));
}

function extractEmailIdentifier(from: string[]): string | undefined {
  for (const item of from) {
    const match = item.match(/<([^>]+)>/);
    if (match?.[1]) {
      return match[1].trim().toLowerCase();
    }

    if (item.includes("@")) {
      return item.trim().toLowerCase();
    }
  }

  return undefined;
}

function isExecutiveNoise(value: string | null | undefined): boolean {
  const normalized = normalizeEmailAnalysisText(value ?? "");
  if (!normalized) {
    return false;
  }

  return includesAny(normalized, [
    "teste controlado",
    "shopee",
    "lojas oficiais",
    "newsletter",
    "digest",
    "read online",
    "renegocia aqui",
    "oferta do dia",
    "cupom",
    "liquidacao",
    "sale",
    "caixa com voce",
    "caixa com você",
    "adimplencia",
    "negociar bradesco",
    "fase critica",
    "fase crítica",
    "renegociacao",
    "renegociação",
    "cpf pode entrar",
    "nike",
  ]);
}

function classifyEventOwner(input: {
  account: string;
  summary?: string;
  description?: string;
  location?: string;
  matchedTerms?: string[];
}): "paulo" | "equipe" | "delegavel" {
  if (input.account === "primary") {
    return "paulo";
  }

  const normalized = normalizeEmailAnalysisText([
    input.summary,
    input.description,
    input.location,
    ...(input.matchedTerms ?? []),
  ].filter(Boolean).join(" "));

  if (!normalized) {
    return "delegavel";
  }

  if (normalized.includes("paulo")) {
    return "paulo";
  }

  if (includesAny(normalized, TEAM_EVENT_HINTS)) {
    return "equipe";
  }

  return "delegavel";
}

function classifyEventContext(input: {
  summary?: string;
  location?: string;
  description?: string;
}): "externo" | "interno" {
  const normalized = normalizeEmailAnalysisText([input.summary, input.location, input.description].filter(Boolean).join(" "));
  if (includesAny(normalized, EXTERNAL_EVENT_HINTS) || Boolean(input.location)) {
    return "externo";
  }
  return "interno";
}

function rangesOverlap(
  leftStart: string | null | undefined,
  leftEnd: string | null | undefined,
  rightStart: string | null | undefined,
  rightEnd: string | null | undefined,
): boolean {
  if (!leftStart || !leftEnd || !rightStart || !rightEnd) {
    return false;
  }
  const leftStartMs = Date.parse(leftStart);
  const leftEndMs = Date.parse(leftEnd);
  const rightStartMs = Date.parse(rightStart);
  const rightEndMs = Date.parse(rightEnd);
  if (![leftStartMs, leftEndMs, rightStartMs, rightEndMs].every(Number.isFinite)) {
    return false;
  }
  return leftStartMs < rightEndMs && rightStartMs < leftEndMs;
}

function annotateEvents(events: ExecutiveBriefEvent[]): ExecutiveBriefEvent[] {
  return events.map((event, index) => {
    const hasConflict = event.owner === "paulo"
      && events.some((candidate, candidateIndex) =>
        candidateIndex !== index
        && candidate.owner === "paulo"
        && rangesOverlap(event.start, event.end, candidate.start, candidate.end));

    let prepHint = "preparar contexto";
    if (hasConflict) {
      prepHint = "validar conflito";
    } else if (event.owner === "delegavel") {
      prepHint = "confirmar responsável";
    } else if (event.context === "externo") {
      prepHint = "preparar deslocamento";
    } else if (event.owner === "paulo") {
      prepHint = "preparar material";
    } else {
      prepHint = "acompanhar execução";
    }

    return {
      ...event,
      hasConflict,
      prepHint,
    };
  });
}

function buildWeatherTip(day: {
  description: string;
  minTempC?: number;
  maxTempC?: number;
  precipitationProbabilityMax?: number;
}, profile: PersonalOperationalProfile): string {
  const rainChance = day.precipitationProbabilityMax ?? 0;
  const maxTemp = day.maxTempC ?? 0;
  const minTemp = day.minTempC ?? 0;
  const normalizedDescription = normalizeEmailAnalysisText(day.description);
  let clothingTip = "roupa confortável";
  if (minTemp <= Math.max(12, profile.attire.coldTemperatureC - 4) || maxTemp <= profile.attire.coldTemperatureC) {
    clothingTip = "agasalho";
  } else if (minTemp <= 16) {
    clothingTip = "camada leve cedo";
  } else if (minTemp <= 20 && maxTemp <= 25) {
    clothingTip = "roupa leve com camada fina";
  } else if (maxTemp >= profile.attire.lightClothingTemperatureC + 5) {
    clothingTip = "roupa bem leve";
  } else if (maxTemp >= profile.attire.lightClothingTemperatureC) {
    clothingTip = "roupa leve ou fresca";
  }

  let carryTip = "sem necessidade de guarda-chuva";
  if (
    rainChance >= Math.max(50, profile.attire.umbrellaProbabilityThreshold)
    || normalizedDescription.includes("chuva")
    || normalizedDescription.includes("trovoada")
  ) {
    carryTip = "leve guarda-chuva";
  } else if (rainChance >= Math.max(30, profile.attire.umbrellaProbabilityThreshold - 10)) {
    carryTip = "guarda-chuva por precaução";
  }

  const extras: string[] = [];
  if ((normalizedDescription.includes("limpo") || normalizedDescription.includes("sol")) && rainChance < 20 && maxTemp >= 23) {
    extras.push("óculos de sol");
  }
  if (normalizedDescription.includes("vento") || normalizedDescription.includes("encoberto")) {
    extras.push("casaco leve se for sair cedo");
  }

  return [`vestir: ${clothingTip}`, `levar: ${carryTip}`, ...extras].join(" | ");
}

function buildBriefWeather(
  forecast: WeatherForecastResult | null | undefined,
  profile: PersonalOperationalProfile,
): ExecutiveMorningBrief["weather"] | undefined {
  if (!forecast || forecast.daily.length === 0) {
    return undefined;
  }

  const days = forecast.daily.slice(0, 2).map((day, index) => ({
    label: index === 0 ? "Hoje" : "Amanhã",
    description: day.description,
    minTempC: day.minTempC,
    maxTempC: day.maxTempC,
    precipitationProbabilityMax: day.precipitationProbabilityMax,
    tip: buildWeatherTip(day, profile),
  }));

  return {
    locationLabel: forecast.locationLabel,
    current: forecast.current
      ? {
          description: forecast.current.description,
          temperatureC: forecast.current.temperatureC,
        }
      : undefined,
    days,
  };
}

function getBriefDayKey(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";
  return `${year}-${month}-${day}`;
}

function hashText(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function diffDayKeys(left: string, right: string): number {
  const leftDate = new Date(`${left}T00:00:00Z`);
  const rightDate = new Date(`${right}T00:00:00Z`);
  return Math.round((leftDate.getTime() - rightDate.getTime()) / (24 * 60 * 60 * 1000));
}

function classifyTaskBucket(
  task: ExecutiveBriefTask,
  timezone: string,
): "today" | "overdue" | "stale" {
  const nowKey = getBriefDayKey(new Date(), timezone);
  const dueDate = task.due ? new Date(task.due) : null;

  if (dueDate) {
    const dueKey = getBriefDayKey(dueDate, timezone);
    if (dueKey === nowKey) {
      return "today";
    }
    if (dueKey < nowKey) {
      return diffDayKeys(nowKey, dueKey) > 7 ? "stale" : "overdue";
    }
    return "today";
  }

  const updatedDate = task.updated ? new Date(task.updated) : null;
  if (!updatedDate) {
    return "today";
  }

  const updatedKey = getBriefDayKey(updatedDate, timezone);
  return diffDayKeys(nowKey, updatedKey) > 14 ? "stale" : "today";
}

function bucketTasks(tasks: ExecutiveBriefTask[], timezone: string): ExecutiveBriefTaskBuckets {
  const sorted = [...tasks].sort((left, right) =>
    (left.due ?? left.updated ?? "").localeCompare(right.due ?? right.updated ?? ""),
  );
  const buckets: ExecutiveBriefTaskBuckets = {
    today: [],
    overdue: [],
    stale: [],
    actionableCount: 0,
  };

  for (const task of sorted) {
    buckets[classifyTaskBucket(task, timezone)].push(task);
  }

  buckets.actionableCount = buckets.today.length + buckets.overdue.length;
  return buckets;
}

function emailRelationshipWeight(relationship: string): number {
  switch (relationship) {
    case "family":
    case "partner":
    case "client":
    case "lead":
    case "social_case":
      return 18;
    case "colleague":
    case "vendor":
      return 10;
    case "friend":
      return 8;
    case "unknown":
      return 2;
    case "spam":
      return -50;
    default:
      return 0;
  }
}

function chooseNextAction(input: {
  timezone: string;
  events: ExecutiveBriefEvent[];
  taskBuckets: ExecutiveBriefTaskBuckets;
  emails: ExecutiveBriefEmail[];
  approvals: ApprovalInboxItemRecord[];
  workflows: ExecutiveBriefWorkflow[];
  focus: ExecutiveBriefFocusItem[];
  memoryEntities: ExecutiveBriefEntitySummary;
  operationalMemory: ScopedMemorySummary;
}): string | undefined {
  const candidates: Array<{ score: number; text: string }> = [];
  const conflictEvent = input.events.find((event) => event.hasConflict);
  if (conflictEvent) {
    candidates.push({
      score: 98,
      text: `Resolver o conflito da agenda de Paulo: ${conflictEvent.summary}.`,
    });
  }
  const nextEvent = input.events[0];
  if (nextEvent?.start) {
    const minutesUntil = Math.round((new Date(nextEvent.start).getTime() - Date.now()) / (60 * 1000));
    const eventScore = minutesUntil <= 45 ? 100 : minutesUntil <= 120 ? 94 : minutesUntil <= 240 ? 84 : 70;
    candidates.push({
      score: eventScore,
      text: `${nextEvent.prepHint[0]?.toUpperCase() ?? ""}${nextEvent.prepHint.slice(1)} para ${nextEvent.summary} às ${nextEvent.start}.`,
    });
  }

  const topEmail = input.emails[0];
  if (topEmail) {
    const baseScore = topEmail.priority === "alta" ? 88 : 66;
    const groupBoost = topEmail.group === "seguranca" ? 12 : topEmail.group === "financeiro" ? 8 : 0;
    candidates.push({
      score: baseScore + groupBoost + emailRelationshipWeight(topEmail.relationship),
      text: `Responder ou validar o email prioritário: ${topEmail.subject || "(sem assunto)"}.`,
    });
  }

  const overdueTask = input.taskBuckets.overdue[0];
  if (overdueTask) {
    candidates.push({
      score: 86,
      text: `Destravar a tarefa atrasada: ${overdueTask.title}.`,
    });
  }

  const todayTask = input.taskBuckets.today[0];
  if (todayTask) {
    candidates.push({
      score: 72,
      text: `Atacar a tarefa de hoje: ${todayTask.title}.`,
    });
  }

  const rankedApprovals = rankApprovals(input.approvals);
  if (rankedApprovals.length > 0) {
    candidates.push({
      score: rankedApprovals[0].score,
      text: `Revisar a aprovação mais urgente no Telegram: ${rankedApprovals[0].item.subject} (${rankedApprovals[0].reason}).`,
    });
  }

  if (input.workflows[0]?.nextAction) {
    candidates.push({
      score: 36,
      text: input.workflows[0].nextAction,
    });
  }

  if (input.focus[0]?.nextAction) {
    candidates.push({
      score: 28,
      text: input.focus[0].nextAction,
    });
  }

  const recentOperationalEntity = input.operationalMemory.entities[0];
  if (recentOperationalEntity) {
    const operationalScore = recentOperationalEntity.kind === "approval"
      ? 68
      : recentOperationalEntity.kind === "workflow_run"
        ? 48
        : recentOperationalEntity.kind === "task"
          ? 40
          : 20;
    candidates.push({
      score: operationalScore,
      text: `Verificar o contexto operacional recente: ${recentOperationalEntity.title}.`,
    });
  }

  const recentEntityWithAction = input.memoryEntities.recent.find((entity) => entity.actionHint);
  if (recentEntityWithAction?.actionHint) {
    const baseScore = recentEntityWithAction.kind === "approval"
      ? 62
      : recentEntityWithAction.kind === "workflow_run"
        ? 44
        : recentEntityWithAction.kind === "contact"
          ? 34
          : 22;
    candidates.push({
      score: baseScore,
      text: recentEntityWithAction.actionHint,
    });
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.text;
}

function deriveEntityActionHint(input: {
  kind: MemoryEntityKind;
  title: string;
  state: Record<string, unknown>;
}): string | undefined {
  if (input.kind === "workflow_run") {
    const nextAction = typeof input.state.nextAction === "string" ? input.state.nextAction.trim() : "";
    if (nextAction) {
      return nextAction;
    }
    return `Revisar o workflow: ${input.title}.`;
  }

  if (input.kind === "approval") {
    const status = typeof input.state.status === "string" ? input.state.status.trim().toLowerCase() : "";
    if (status === "pending") {
      return `Decidir a aprovação pendente: ${input.title}.`;
    }
  }

  if (input.kind === "contact") {
    const priority = typeof input.state.priority === "string" ? input.state.priority.trim().toLowerCase() : "";
    if (priority === "alta") {
      return `Retomar o contato prioritário: ${input.title}.`;
    }
  }

  return undefined;
}

function pickDailyMotivation(timezone: string): { text: string; author?: string } {
  const catalog = [
    { text: "Disciplina é continuar quando o entusiasmo já foi embora." },
    { text: "A dificuldade mostra o tamanho do chamado. Responder a ela é parte da vitória." },
    { text: "Você tem poder sobre sua mente, não sobre os eventos. Perceba isso, e encontrará força.", author: "Marco Aurélio" },
    { text: "Não explique sua filosofia. Incorpore-a.", author: "Epicteto" },
    { text: "A coragem cresce quando a ação começa antes da certeza completa." },
    { text: "A constância resolve o que a pressa só agrava." },
    { text: "Aquele que tem um porquê enfrenta quase qualquer como.", author: "Friedrich Nietzsche" },
    { text: "Enquanto adiamos, o problema cresce; quando enfrentamos, ele começa a ceder." },
    { text: "Dificuldades fortalecem a mente, como o trabalho fortalece o corpo.", author: "Sêneca" },
    { text: "Resiliência não é negar a luta; é continuar útil dentro dela." },
    { text: "O homem que move montanhas começa carregando pequenas pedras.", author: "Confúcio" },
    { text: "Resolver bem hoje vale mais do que prometer muito amanhã." },
  ] as const;

  const key = getBriefDayKey(new Date(), timezone);
  return catalog[hashText(key) % catalog.length];
}

function summarizeConflictInsights(events: ExecutiveBriefEvent[], timezone: string): ExecutiveMorningBrief["conflictSummary"] {
  const insights = analyzeCalendarInsights(
    events.map((event) => ({
      account: event.account,
      summary: event.summary,
      start: event.start,
      end: event.end ?? null,
      location: event.location,
      owner: event.owner,
    })),
    timezone,
  );

  return {
    overlaps: insights.filter((item) => item.kind === "overlap").length,
    duplicates: insights.filter((item) => item.kind === "duplicate").length,
    naming: insights.filter((item) => item.kind === "inconsistent_name").length,
  };
}

function buildMobilityAlerts(input: {
  events: ExecutiveBriefEvent[];
  weather: ExecutiveMorningBrief["weather"];
  profile: PersonalOperationalProfile;
}): string[] {
  const alerts: string[] = [];
  const nextExternal = input.events.find((event) => event.owner === "paulo" && event.context === "externo");
  if (nextExternal) {
    alerts.push(`saída externa: ${nextExternal.summary}${nextExternal.location ? ` | local: ${nextExternal.location}` : ""}`);
    if (!nextExternal.location) {
      alerts.push("compromisso externo sem local claro");
    }
  }

  const todayWeather = input.weather?.days[0];
  if (todayWeather) {
    alerts.push(todayWeather.tip);
  }

  if (input.profile.attire.carryItems.length > 0) {
    alerts.push(`itens base: ${input.profile.attire.carryItems.slice(0, 3).join(", ")}`);
  }

  for (const preference of input.profile.mobilityPreferences.slice(0, 2)) {
    alerts.push(`preferência de rua: ${preference}`);
  }

  return alerts.slice(0, 4);
}

function classifyOverloadLevel(input: {
  events: ExecutiveBriefEvent[];
  taskBuckets: ExecutiveBriefTaskBuckets;
  conflicts: ExecutiveMorningBrief["conflictSummary"];
}): ExecutiveMorningBrief["overloadLevel"] {
  const score =
    input.events.length
    + input.taskBuckets.actionableCount
    + input.conflicts.overlaps * 2
    + input.conflicts.duplicates;

  if (score >= 8) {
    return "pesado";
  }
  if (score >= 4) {
    return "moderado";
  }
  return "leve";
}

function chooseDayRecommendation(input: {
  nextAction?: string;
  overloadLevel: ExecutiveMorningBrief["overloadLevel"];
  mobilityAlerts: string[];
  conflicts: ExecutiveMorningBrief["conflictSummary"];
}): string | undefined {
  if (input.conflicts.overlaps > 0) {
    return "trave primeiro os conflitos da agenda antes de assumir qualquer nova frente";
  }
  if (input.mobilityAlerts[0]) {
    return `prepare a rua cedo: ${input.mobilityAlerts[0]}`;
  }
  if (input.overloadLevel === "moderado" && input.mobilityAlerts[1]) {
    return `deixe o básico pronto cedo: ${input.mobilityAlerts[1]}`;
  }
  if (input.overloadLevel === "pesado") {
    return "mantenha resposta curta, preserve deslocamento e evite abrir novas pendências";
  }
  return input.nextAction;
}

export class PersonalOSService {
  private readonly weather: WeatherService;

  constructor(
    private readonly timezone: string,
    private readonly logger: Logger,
    private readonly briefingConfig: BriefingConfig,
    private readonly googleWorkspaces: GoogleWorkspaceAccountsService,
    private readonly emailAccounts: EmailAccountsService,
    private readonly communicationRouter: CommunicationRouter,
    private readonly approvals: ApprovalInboxStore,
    private readonly workflows: WorkflowOrchestratorStore,
    private readonly founderOps: FounderOpsService,
    private readonly memory: OperationalMemoryStore,
    private readonly memoryEntities: MemoryEntityStore,
    private readonly contextMemory: ContextMemoryService,
    private readonly personalMemory: PersonalOperationalMemoryStore,
  ) {
    this.weather = new WeatherService(this.logger.child({ scope: "weather" }));
  }

  async getExecutiveMorningBrief(): Promise<ExecutiveMorningBrief> {
    const events: ExecutiveBriefEvent[] = [];
    const tasks: ExecutiveBriefTask[] = [];

    for (const alias of this.googleWorkspaces.getAliases()) {
      const workspace = this.googleWorkspaces.getWorkspace(alias);
      const status = workspace.getStatus();
      if (!status.ready) {
        continue;
      }

      const brief = await workspace.getDailyBrief();
      events.push(
        ...brief.events
          .map((event) => {
            const matchedTerms = matchPersonalCalendarTerms({
              account: alias,
              summary: event.summary,
              description: event.description,
              location: event.location,
            });
            return {
              account: alias,
              summary: event.summary,
              start: event.start,
              end: event.end,
              location: event.location,
              description: event.description,
              matchedTerms,
              owner: classifyEventOwner({
                account: alias,
                summary: event.summary,
                description: event.description,
                location: event.location,
                matchedTerms,
              }),
              context: classifyEventContext({
                summary: event.summary,
                location: event.location,
                description: event.description,
              }),
              hasConflict: false,
              prepHint: "preparar contexto",
            };
          })
          .filter((event) => {
            if (EXECUTIVE_BRIEF_CALENDAR_ALIASES.has(alias)) {
              return true;
            }
            return isPersonallyRelevantCalendarEvent(event);
          }),
      );
      tasks.push(...brief.tasks.map((task) => ({ ...task, account: alias })));
    }

    events.sort((left, right) => (left.start ?? "").localeCompare(right.start ?? ""));
    const annotatedEvents = annotateEvents(events);
    const visibleTasks = tasks.filter((task) => !isExecutiveNoise(task.title));
    const taskBuckets = bucketTasks(visibleTasks, this.timezone);

    const prioritizedEmails: ExecutiveBriefEmail[] = [];
    for (const alias of this.emailAccounts.getAliases()) {
      const reader = this.emailAccounts.getReader(alias);
      const status = await reader.getStatus();
      if (!status.ready) {
        continue;
      }

      const messages = await reader.listRecentMessages({
        limit: 8,
        unreadOnly: true,
        sinceHours: 18,
      });

      for (const message of messages) {
        const sender = message.from[0] ?? "";
        const classification = this.communicationRouter.classify({
          channel: "email",
          identifier: extractEmailIdentifier(message.from),
          displayName: sender,
          subject: message.subject,
          text: message.preview,
        });
        const summary = summarizeEmailForOperations({
          subject: message.subject,
          from: message.from,
          text: message.preview,
        });
        if (summary.priority === "baixa" || classification.actionPolicy === "ignore" || classification.relationship === "spam") {
          continue;
        }
        prioritizedEmails.push({
          account: alias,
          uid: message.uid,
          subject: message.subject,
          from: message.from,
          priority: summary.priority,
          action: summary.action,
          relationship: classification.relationship,
          group: summary.group,
        });
      }
    }

    const priorityOrder = { alta: 0, media: 1, baixa: 2 } as const;
    const relationshipOrder = {
      client: 0,
      social_case: 1,
      family: 2,
      partner: 3,
      lead: 4,
      colleague: 5,
      vendor: 6,
      friend: 7,
      unknown: 8,
      spam: 9,
    } as const;

    prioritizedEmails.sort(
      (left, right) =>
        priorityOrder[left.priority as keyof typeof priorityOrder]
        - priorityOrder[right.priority as keyof typeof priorityOrder]
        || (relationshipOrder[left.relationship as keyof typeof relationshipOrder] ?? 50)
          - (relationshipOrder[right.relationship as keyof typeof relationshipOrder] ?? 50),
    );

    const emails = prioritizedEmails.filter((item) => {
      if (isExecutiveNoise(item.subject)) {
        return false;
      }
      if (item.group === "promocional") {
        return false;
      }
      if (item.group === "financeiro") {
        const normalizedSubject = normalizeEmailAnalysisText(item.subject);
        if (includesAny(normalizedSubject, [
          "adimplencia",
          "regularize",
          "renegoci",
          "fase critica",
          "cpf pode entrar",
          "negociar",
          "emprestimo",
          "credito",
          "crédito",
          "nike",
        ])) {
          return false;
        }
      }
      return true;
    });
    const approvals = rankApprovals(this.approvals.listPendingAll(12))
      .slice(0, 6)
      .map((entry) => entry.item);
    const workflows = this.workflows
      .listPlans(10)
      .filter((plan) => (plan.status === "active" || plan.status === "draft") && !isExecutiveNoise(plan.title))
      .map((plan) => ({
        id: plan.id,
        title: plan.title,
        status: plan.status,
        nextAction: plan.nextAction,
      }));
    const focus = this.memory.getDailyFocus(3)
      .map((item) => ({
        title: item.item.title,
        nextAction: item.nextAction,
      }))
      .filter((item) => !isExecutiveNoise(item.title));
    const recentEntities = this.memoryEntities.list(12).filter((item) => !isExecutiveNoise(item.title));
    const memoryEntities: ExecutiveBriefEntitySummary = {
      total: recentEntities.length,
      byKind: recentEntities.reduce<Partial<Record<MemoryEntityKind, number>>>((acc, item) => {
        acc[item.kind] = (acc[item.kind] ?? 0) + 1;
        return acc;
      }, {}),
      recent: recentEntities.slice(0, 4).map((item) => ({
        id: item.id,
        kind: item.kind,
        title: item.title,
        tags: item.tags,
        actionHint: deriveEntityActionHint({
          kind: item.kind,
          title: item.title,
          state: item.state,
        }),
      })),
    };
    const founderSnapshot = this.founderOps.getDailySnapshot();
    const motivation = pickDailyMotivation(this.timezone);
    const operationalMemory = this.contextMemory.summarize("operational", 4);
    const currentOperationalState = this.personalMemory.getOperationalState();
    const activeOperationalSignals = currentOperationalState
      .signals
      .filter((item) => item.active)
      .slice(0, 4);
    const profile = this.personalMemory.getProfile();
    const weatherForecast = this.briefingConfig.weatherEnabled
      ? await this.weather.getForecast({
          location: this.briefingConfig.weatherLocation,
          days: this.briefingConfig.weatherDays,
          timezone: this.timezone,
        }).catch((error) => {
          this.logger.warn("Failed to load morning brief weather", {
            error: error instanceof Error ? error.message : String(error),
            location: this.briefingConfig.weatherLocation,
          });
          return null;
        })
      : null;
    const weather = buildBriefWeather(weatherForecast, profile);
    const conflictSummary = summarizeConflictInsights(annotatedEvents, this.timezone);
    const personalFocus = profile.savedFocus.slice(0, 3);
    const mobilityAlerts = buildMobilityAlerts({
      events: annotatedEvents,
      weather,
      profile,
    });
    const nextAction = chooseNextAction({
      timezone: this.timezone,
      events: annotatedEvents,
      taskBuckets,
      emails,
      approvals,
      workflows,
      focus,
      memoryEntities,
      operationalMemory,
    });
    const overloadLevel = classifyOverloadLevel({
      events: annotatedEvents,
      taskBuckets,
      conflicts: conflictSummary,
    });
    const dayRecommendation = chooseDayRecommendation({
      nextAction,
      overloadLevel,
      mobilityAlerts,
      conflicts: conflictSummary,
    });

    this.logger.debug("Built executive morning brief snapshot", {
      events: annotatedEvents.length,
      tasks: taskBuckets.actionableCount,
      emails: emails.length,
      approvals: approvals.length,
      workflows: workflows.length,
    });

    this.personalMemory.updateOperationalState({
      focus: personalFocus,
      weeklyPriorities: personalFocus,
      pendingAlerts: Array.from(new Set([
        ...approvals.slice(0, 4).map((item) => item.subject),
        ...activeOperationalSignals.map((item) => `Institucional: ${item.summary}`),
        ...currentOperationalState.pendingAlerts,
      ])).slice(0, 6),
      criticalTasks: [
        ...taskBuckets.overdue.slice(0, 2).map((item) => item.title),
        ...taskBuckets.today.slice(0, 2).map((item) => item.title),
      ].slice(0, 4),
      upcomingCommitments: annotatedEvents.slice(0, 4).map((event) => ({
        summary: event.summary,
        start: event.start ?? undefined,
        account: event.account,
        location: event.location,
      })),
      primaryRisk:
        conflictSummary.overlaps > 0
          ? `${conflictSummary.overlaps} conflito(s) de agenda`
          : activeOperationalSignals.length > 0 && currentOperationalState.primaryRisk
            ? currentOperationalState.primaryRisk
          : overloadLevel === "pesado"
            ? "sobrecarga operacional"
            : emails[0]?.subject,
      briefing: {
        lastGeneratedAt: new Date().toISOString(),
        nextAction,
        overloadLevel,
      },
      recentContext: [
        ...activeOperationalSignals.map((item) => `Institucional: ${item.summary}`),
        ...(mobilityAlerts.slice(0, 2)),
        ...(dayRecommendation ? [dayRecommendation] : []),
        ...currentOperationalState.recentContext,
      ].slice(0, 4),
      pendingApprovals: approvals.length,
    });

    return {
      timezone: this.timezone,
      events: annotatedEvents,
      taskBuckets,
      emails,
      approvals,
      workflows,
      focus,
      memoryEntities,
      motivation,
      founderSnapshot,
      weather,
      nextAction,
      personalFocus,
      overloadLevel,
      mobilityAlerts,
      operationalSignals: activeOperationalSignals,
      conflictSummary,
      dayRecommendation,
    };
  }
}
