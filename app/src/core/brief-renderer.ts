import type { ApprovalInboxItemRecord } from "../types/approval-inbox.js";
import type { BriefingProfile, BriefingSectionKey } from "../types/briefing-profile.js";
import type {
  ExecutiveBriefAutonomySuggestion,
  ExecutiveBriefEmail,
  ExecutiveBriefEvent,
  ExecutiveBriefTask,
  ExecutiveBriefWorkflow,
  ExecutiveMorningBrief,
} from "./personal-os.js";
import { DEFAULT_SELF_BRIEFING_SECTIONS } from "./briefing-profile-helpers.js";

const INSTITUTIONAL_TERMS = ["cras", "creas", "caps", "domiciliados"];
const HIGH_PRIORITIES = new Set(["alta", "urgent", "urgente"]);
const COMPLETED_WORKFLOW_STATUSES = new Set(["concluido", "concluído", "completed", "done"]);

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

function formatDateLabel(brief: ExecutiveMorningBrief): string {
  const source = brief.events.find((event) => event.start)?.start;
  const date = source ? new Date(source) : new Date();
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: brief.timezone,
    day: "2-digit",
    month: "2-digit",
  }).format(date);
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
  }).format(parsed);
}

function formatTemperature(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "sem temperatura";
  }
  return `${Math.round(value)}°C`;
}

function extractSenderLabel(from: string[] | undefined): string {
  for (const item of from ?? []) {
    const nameMatch = item.match(/^([^<]+)</);
    if (nameMatch?.[1]?.trim()) {
      return nameMatch[1].trim();
    }
    const emailMatch = item.match(/<([^>]+)>/);
    if (emailMatch?.[1]?.trim()) {
      return emailMatch[1].trim();
    }
    if (item.trim()) {
      return item.trim();
    }
  }
  return "remetente indefinido";
}

function summarizeLocation(location: string | undefined): string | undefined {
  const clean = truncate(location, 44);
  if (!clean) {
    return undefined;
  }
  return clean
    .replace(/\s+-\s+[^-]+$/u, "")
    .trim();
}

function hasInstitutionalFieldDay(brief: ExecutiveMorningBrief): boolean {
  return brief.events.some((event) => {
    const haystack = normalize([event.summary, event.location].filter(Boolean).join(" "));
    return INSTITUTIONAL_TERMS.some((term) => haystack.includes(term));
  });
}

function sortEvents(events: ExecutiveBriefEvent[]): ExecutiveBriefEvent[] {
  return [...events].sort((left, right) => {
    const leftMs = left.start ? Date.parse(left.start) : Number.POSITIVE_INFINITY;
    const rightMs = right.start ? Date.parse(right.start) : Number.POSITIVE_INFINITY;
    return leftMs - rightMs;
  });
}

function sortTasks(tasks: ExecutiveBriefTask[]): ExecutiveBriefTask[] {
  return [...tasks].sort((left, right) => {
    const leftMs = left.due ? Date.parse(left.due) : Number.POSITIVE_INFINITY;
    const rightMs = right.due ? Date.parse(right.due) : Number.POSITIVE_INFINITY;
    return leftMs - rightMs;
  });
}

function priorityWeight(value: string): number {
  const normalized = normalize(value);
  if (normalized === "urgente" || normalized === "urgent") {
    return 0;
  }
  if (normalized === "alta") {
    return 1;
  }
  return 5;
}

function formatGoalLines(goalSummary: string | undefined, maxLines: number): string[] {
  const normalized = goalSummary?.replace(/^Objetivos:\s*/i, "").trim();
  if (!normalized) {
    return [];
  }
  return normalized
    .split(/;\s*/)
    .map((item) => truncate(item, 108))
    .filter(Boolean)
    .slice(0, maxLines)
    .map((item) => `- ${item}`);
}

function formatEventLine(event: ExecutiveBriefEvent, timezone: string): string {
  const timeLabel = formatTime(event.start, timezone);
  const conflictPrefix = event.hasConflict ? "⚠️ " : "";
  const location = summarizeLocation(event.location);
  return `- ${timeLabel} ${conflictPrefix}${truncate(event.summary, 72)}${location ? ` — ${location}` : ""}`;
}

function formatEmailLine(email: ExecutiveBriefEmail): string {
  return `- ${truncate(email.subject, 72)} — ${truncate(extractSenderLabel(email.from), 28)}`;
}

function formatTaskLine(task: ExecutiveBriefTask, bucketLabel: string, timezone: string): string {
  const dueLabel = task.due ? ` — ${formatTime(task.due, timezone)}` : "";
  return `- ${bucketLabel}: ${truncate(task.title, 72)}${dueLabel}`;
}

function formatApprovalLine(item: ApprovalInboxItemRecord): string {
  return `- ${truncate(item.subject, 84)}`;
}

function formatAutonomySuggestionLine(item: ExecutiveBriefAutonomySuggestion): string {
  const priorityLabel = item.priority >= 0.8
    ? "Alta"
    : item.priority >= 0.55
      ? "Média"
      : "Baixa";
  const suffix = item.requiresApproval ? " — exige aprovação" : "";
  return `- ${priorityLabel}: ${truncate(item.title, 68)}${suffix}`;
}

function formatWorkflowLine(item: ExecutiveBriefWorkflow): string {
  const nextAction = item.nextAction ? ` — ${truncate(item.nextAction, 48)}` : "";
  return `- ${truncate(item.title, 60)}${nextAction}`;
}

function renderMotivationLine(brief: ExecutiveMorningBrief): string | undefined {
  if (!brief.motivation?.text?.trim()) {
    return undefined;
  }
  const author = brief.motivation.author?.trim();
  return `_${truncate(brief.motivation.text, 120)}${author ? ` — ${truncate(author, 28)}` : ""}_`;
}

function openingLine(brief: ExecutiveMorningBrief, sections: Set<BriefingSectionKey>): string {
  const localNow = new Date(new Date().toLocaleString("en-US", { timeZone: brief.timezone }));
  const greeting = localNow.getHours() >= 18 ? "Boa noite" : localNow.getHours() >= 12 ? "Boa tarde" : "Bom dia";
  const dateLabel = formatDateLabel(brief);
  const includeWeather = sections.has("weather");
  const weatherDescription = includeWeather
    ? brief.weather?.current?.description?.trim() ?? "sem clima do momento"
    : "sem leitura climática";
  const tempLabel = includeWeather ? formatTemperature(brief.weather?.current?.temperatureC) : "sem clima";
  const fieldTag = hasInstitutionalFieldDay(brief) ? " — 🏢 Dia de campo" : "";
  return `${greeting} — ${dateLabel} — ${tempLabel}, ${truncate(weatherDescription, 48)}${fieldTag}`;
}

function addSection(lines: string[], title: string, content: string[], maxLines: number): void {
  if (content.length === 0) {
    return;
  }
  if (lines.length + 1 > maxLines) {
    return;
  }
  lines.push(`*${title}*`);
  for (const line of content) {
    if (lines.length >= maxLines) {
      break;
    }
    lines.push(line);
  }
}

export class BriefRenderer {
  render(brief: ExecutiveMorningBrief): string {
    return this.renderInternal(brief, {
      sections: DEFAULT_SELF_BRIEFING_SECTIONS,
      compact: brief.overloadLevel === "pesado",
    });
  }

  renderCompact(brief: ExecutiveMorningBrief): string {
    return this.renderInternal(brief, {
      sections: DEFAULT_SELF_BRIEFING_SECTIONS,
      compact: true,
    });
  }

  renderForProfile(brief: ExecutiveMorningBrief, profile: BriefingProfile): string {
    return this.renderInternal(brief, {
      sections: profile.sections,
      compact: profile.style === "compact" || (profile.style === "auto" && brief.overloadLevel === "pesado"),
      preferDetailed: profile.style === "detailed",
    });
  }

  private renderInternal(
    brief: ExecutiveMorningBrief,
    options: {
      sections: BriefingSectionKey[];
      compact: boolean;
      preferDetailed?: boolean;
    },
  ): string {
    const sections = new Set(options.sections);
    const maxLines = options.compact ? 15 : options.preferDetailed ? 35 : 28;
    const lines: string[] = [openingLine(brief, sections)];

    if (options.compact && brief.overloadLevel === "pesado") {
      lines.push("⚡ Dia intenso — foco no essencial");
    }

    if (sections.has("focus")) {
      addSection(lines, "Foco do dia", brief.dayRecommendation ? [`- ${truncate(brief.dayRecommendation, options.compact ? 92 : 110)}`] : [], maxLines);
    }
    if (sections.has("next_action")) {
      addSection(lines, "Próxima ação", brief.nextAction ? [`- ${truncate(brief.nextAction, options.compact ? 92 : 110)}`] : [], maxLines);
    }
    if (sections.has("autonomy")) {
      addSection(
        lines,
        "Pontos para revisar",
        (brief.autonomySuggestions ?? []).slice(0, options.compact ? 1 : 2).map(formatAutonomySuggestionLine),
        maxLines,
      );
    }
    if (sections.has("goals")) {
      addSection(lines, "Objetivos ativos", formatGoalLines(brief.goalSummary, options.compact ? 1 : 2), maxLines);
    }
    if (sections.has("agenda")) {
      addSection(
        lines,
        "Agenda",
        sortEvents(brief.events).slice(0, options.compact ? 2 : 4).map((event) => formatEventLine(event, brief.timezone)),
        maxLines,
      );
    }
    if (sections.has("emails")) {
      const criticalEmails = [...brief.emails]
        .filter((item) => HIGH_PRIORITIES.has(normalize(item.priority)))
        .sort((left, right) => priorityWeight(left.priority) - priorityWeight(right.priority))
        .slice(0, options.compact ? 1 : 3)
        .map(formatEmailLine);
      addSection(lines, "Emails críticos", criticalEmails, maxLines);
    }
    if (sections.has("tasks")) {
      const tasks = options.compact
        ? [
            ...sortTasks(brief.taskBuckets.overdue).slice(0, 1).map((task) => formatTaskLine(task, "Atrasada", brief.timezone)),
            ...sortTasks(brief.taskBuckets.today).slice(0, 1).map((task) => formatTaskLine(task, "Hoje", brief.timezone)),
          ].slice(0, 1)
        : [
            ...sortTasks(brief.taskBuckets.overdue).slice(0, 2).map((task) => formatTaskLine(task, "Atrasada", brief.timezone)),
            ...sortTasks(brief.taskBuckets.today).slice(0, 2).map((task) => formatTaskLine(task, "Hoje", brief.timezone)),
          ];
      addSection(lines, "Tarefas", tasks, maxLines);
    }
    if (sections.has("approvals")) {
      const pendingApprovals = brief.approvals
        .filter((item) => item.status === "pending")
        .slice(0, options.compact ? 1 : 3)
        .map(formatApprovalLine);
      addSection(lines, "Aprovações pendentes", pendingApprovals, maxLines);
    }
    if (sections.has("workflows")) {
      const activeWorkflows = brief.workflows
        .filter((item) => !COMPLETED_WORKFLOW_STATUSES.has(normalize(item.status)))
        .slice(0, options.compact ? 1 : 2)
        .map(formatWorkflowLine);
      addSection(lines, "Workflows", activeWorkflows, maxLines);
    }
    if (sections.has("mobility")) {
      addSection(
        lines,
        "Rua e deslocamento",
        brief.mobilityAlerts.slice(0, options.compact ? 1 : 2).map((item) => `- ${truncate(item, options.compact ? 92 : 110)}`),
        maxLines,
      );
    }
    if (sections.has("motivation")) {
      addSection(lines, "Motivação", renderMotivationLine(brief) ? [renderMotivationLine(brief)!] : [], maxLines);
    }

    return lines.slice(0, maxLines).join("\n");
  }
}
