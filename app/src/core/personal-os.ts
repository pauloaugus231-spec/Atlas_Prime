import type { ApprovalInboxStore } from "./approval-inbox.js";
import { isPersonallyRelevantCalendarEvent, matchPersonalCalendarTerms } from "./calendar-relevance.js";
import type { CommunicationRouter } from "./contact-intelligence.js";
import type { FounderOpsService, FounderOpsSnapshot } from "./founder-ops.js";
import type { OperationalMemoryStore } from "./operational-memory.js";
import type { WorkflowOrchestratorStore } from "./workflow-orchestrator.js";
import type { Logger } from "../types/logger.js";
import type { ApprovalInboxItemRecord } from "../types/approval-inbox.js";
import type { TaskSummary } from "../integrations/google/google-workspace.js";
import type { EmailAccountsService } from "../integrations/email/email-accounts.js";
import type { GoogleWorkspaceAccountsService } from "../integrations/google/google-workspace-accounts.js";
import { normalizeEmailAnalysisText, summarizeEmailForOperations, type EmailOperationalGroup } from "../integrations/email/email-analysis.js";

export interface ExecutiveBriefEvent {
  account: string;
  summary: string;
  start: string | null;
  location?: string;
  matchedTerms?: string[];
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

export interface ExecutiveMorningBrief {
  timezone: string;
  events: ExecutiveBriefEvent[];
  taskBuckets: ExecutiveBriefTaskBuckets;
  emails: ExecutiveBriefEmail[];
  approvals: ApprovalInboxItemRecord[];
  workflows: ExecutiveBriefWorkflow[];
  focus: ExecutiveBriefFocusItem[];
  founderSnapshot: FounderOpsSnapshot;
  nextAction?: string;
}

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
  ]);
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
}): string | undefined {
  const candidates: Array<{ score: number; text: string }> = [];
  const nextEvent = input.events[0];
  if (nextEvent?.start) {
    const minutesUntil = Math.round((new Date(nextEvent.start).getTime() - Date.now()) / (60 * 1000));
    const eventScore = minutesUntil <= 45 ? 100 : minutesUntil <= 120 ? 94 : minutesUntil <= 240 ? 84 : 70;
    candidates.push({
      score: eventScore,
      text: `Preparar o compromisso das ${nextEvent.start}.`,
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

  if (input.approvals.length > 0) {
    candidates.push({
      score: 55 + Math.min(12, input.approvals.length * 2),
      text: `Revisar a aprovação mais urgente no Telegram: ${input.approvals[0].subject}.`,
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

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.text;
}

export class PersonalOSService {
  constructor(
    private readonly timezone: string,
    private readonly logger: Logger,
    private readonly googleWorkspaces: GoogleWorkspaceAccountsService,
    private readonly emailAccounts: EmailAccountsService,
    private readonly communicationRouter: CommunicationRouter,
    private readonly approvals: ApprovalInboxStore,
    private readonly workflows: WorkflowOrchestratorStore,
    private readonly founderOps: FounderOpsService,
    private readonly memory: OperationalMemoryStore,
  ) {}

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
          .map((event) => ({
            account: alias,
            summary: event.summary,
            start: event.start,
            location: event.location,
            description: event.description,
            matchedTerms: matchPersonalCalendarTerms({
              account: alias,
              summary: event.summary,
              description: event.description,
              location: event.location,
            }),
          }))
          .filter((event) => isPersonallyRelevantCalendarEvent(event)),
      );
      tasks.push(...brief.tasks.map((task) => ({ ...task, account: alias })));
    }

    events.sort((left, right) => (left.start ?? "").localeCompare(right.start ?? ""));
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

    const emails = prioritizedEmails.filter((item) => !isExecutiveNoise(item.subject));
    const approvals = this.approvals.listPendingAll(6);
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
    const founderSnapshot = this.founderOps.getDailySnapshot();
    const nextAction = chooseNextAction({
      timezone: this.timezone,
      events,
      taskBuckets,
      emails,
      approvals,
      workflows,
      focus,
    });

    this.logger.debug("Built executive morning brief snapshot", {
      events: events.length,
      tasks: taskBuckets.actionableCount,
      emails: emails.length,
      approvals: approvals.length,
      workflows: workflows.length,
    });

    return {
      timezone: this.timezone,
      events,
      taskBuckets,
      emails,
      approvals,
      workflows,
      focus,
      founderSnapshot,
      nextAction,
    };
  }
}
