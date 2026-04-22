import process from "node:process";
import { MorningBriefPolicy } from "../src/core/morning-brief-policy.js";
import type { ExecutiveMorningBrief } from "../src/core/personal-os.js";
import type { BriefingProfile } from "../src/types/briefing-profile.js";
import type { PersonalOperationalProfile } from "../src/types/personal-operational-memory.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const profile: PersonalOperationalProfile = {
  displayName: "Paulo Augusto",
  primaryRole: "operador",
  routineSummary: [],
  timezone: "America/Sao_Paulo",
  preferredChannels: ["telegram"],
  priorityAreas: ["agenda"],
  defaultAgendaScope: "both",
  workCalendarAliases: ["abordagem"],
  responseStyle: "direto",
  briefingPreference: "executivo",
  detailLevel: "equilibrado",
  tonePreference: "humano",
  defaultOperationalMode: "normal",
  mobilityPreferences: ["sair com margem"],
  autonomyPreferences: [],
  savedFocus: [],
  routineAnchors: [],
  operationalRules: [],
  attire: {
    umbrellaProbabilityThreshold: 40,
    coldTemperatureC: 18,
    lightClothingTemperatureC: 25,
    carryItems: ["carregador"],
  },
  fieldModeHours: 12,
};

const briefingProfile: BriefingProfile = {
  id: "default-morning-brief",
  name: "briefing da manhã",
  aliases: ["briefing da manhã", "briefing"],
  enabled: true,
  deliveryMode: "both",
  deliveryChannel: "telegram",
  audience: "self",
  targetRecipientIds: [],
  time: "06:00",
  weekdays: [1, 2, 3, 4, 5],
  timezone: "America/Sao_Paulo",
  style: "executive",
  sections: ["weather", "agenda", "tasks", "approvals", "motivation"],
  purpose: "daily_prep",
  presentation: {
    hierarchy: "daily_prep_v1",
    tone: "human_firm",
    maxPrimaryCommitments: 3,
    weatherMode: "inline",
    workflowMode: "if_priority",
    emailMode: "if_critical",
    approvalMode: "if_urgent",
    watchpointMode: "operational_risk_first",
    compactWhenFieldMode: true,
  },
};

const brief: ExecutiveMorningBrief = {
  timezone: "America/Sao_Paulo",
  events: [
    {
      account: "abordagem",
      summary: "Atendimento com equipe criança",
      start: "2026-04-28T08:00:00-03:00",
      end: "2026-04-28T12:00:00-03:00",
      location: "Amurt-Amurtel Projetos Sociais",
      owner: "paulo",
      context: "externo",
      hasConflict: false,
      prepHint: "preparar deslocamento",
    },
    {
      account: "abordagem",
      summary: "Reunião interna",
      start: "2026-04-28T13:30:00-03:00",
      end: "2026-04-28T14:00:00-03:00",
      location: "SEAS",
      owner: "paulo",
      context: "interno",
      hasConflict: false,
      prepHint: "revisar pauta",
    },
  ],
  taskBuckets: {
    today: [],
    overdue: [
      {
        id: "task-1",
        taskListId: "list-1",
        taskListTitle: "Operação",
        title: "Revisar pendência da equipe",
        status: "needsAction",
        updated: "2026-04-27T10:00:00-03:00",
        due: "2026-04-28T11:00:00-03:00",
        account: "abordagem",
      },
    ],
    stale: [],
    actionableCount: 1,
  },
  emails: [
    {
      account: "primary",
      uid: "email-1",
      subject: "Retorno importante da coordenação",
      from: ["Coordenação <coord@example.com>"],
      priority: "alta",
      action: "responder",
      relationship: "work",
      group: "profissional",
    },
  ],
  approvals: [
    {
      id: 10,
      chatId: 1,
      channel: "telegram",
      actionKind: "send_email",
      subject: "Aprovar envio para a equipe",
      draftPayload: "{}",
      status: "pending",
      createdAt: "2026-04-27T22:00:00-03:00",
      updatedAt: "2026-04-27T22:00:00-03:00",
    },
  ],
  workflows: [],
  focus: [],
  memoryEntities: {
    total: 0,
    byKind: {},
    recent: [],
  },
  motivation: {
    text: "Disciplina é proteger o essencial antes que o ruído tome conta.",
  },
  founderSnapshot: {
    executiveLine: "",
    sections: [],
    trackedMetrics: [],
  },
  nextAction: "Revisar a aprovação mais urgente no Telegram.",
  personalFocus: [],
  overloadLevel: "moderado",
  mobilityAlerts: ["Saída longa pela manhã. Vale sair com margem e levar uma camada leve."],
  operationalSignals: [
    {
      key: "approval-risk",
      source: "context",
      kind: "attention",
      summary: "Há aprovação sensível esperando revisão antes do início da manhã.",
      priority: "high",
      active: true,
      createdAt: "2026-04-27T22:00:00-03:00",
      updatedAt: "2026-04-27T22:00:00-03:00",
    },
  ],
  conflictSummary: {
    overlaps: 0,
    duplicates: 0,
    naming: 0,
  },
  dayRecommendation: "Começa pelo que destrava a equipe e protege o período da manhã.",
  weather: {
    locationLabel: "Porto Alegre",
    current: {
      description: "tempo firme",
      temperatureC: 20,
    },
    days: [],
  },
};

function run() {
  const policy = new MorningBriefPolicy();
  const normal = policy.buildPlan({
    brief,
    profile: briefingProfile,
    personalProfile: profile,
  });
  const compact = policy.buildPlan({
    brief,
    profile: {
      ...briefingProfile,
      style: "compact",
    },
    personalProfile: {
      ...profile,
      briefingPreference: "curto",
      defaultOperationalMode: "field",
    },
    operationalMode: "field",
  });

  const results: EvalResult[] = [
    {
      name: "morning_brief_policy_builds_fixed_daily_prep_shape",
      passed:
        normal.purpose === "daily_prep"
        && Boolean(normal.greeting)
        && Boolean(normal.dayRead)
        && Boolean(normal.attention)
        && Boolean(normal.firstMove)
        && normal.commitments.length > 0
        && Boolean(normal.watchpoint)
        && Boolean(normal.closingMessage),
      detail: JSON.stringify(normal, null, 2),
    },
    {
      name: "morning_brief_policy_prioritizes_action_and_risk",
      passed:
        /aprova/i.test(normal.firstMove)
        && (/pendencia|aprova/i.test(normal.attention) || /aprova/i.test(normal.watchpoint)),
      detail: JSON.stringify(normal, null, 2),
    },
    {
      name: "morning_brief_policy_compact_variant_reduces_commitments",
      passed:
        compact.variant === "compact"
        && compact.commitments.length <= 2
        && compact.closingLabel === "Mensagem",
      detail: JSON.stringify(compact, null, 2),
    },
    {
      name: "morning_brief_policy_keeps_weather_inline_in_day_read",
      passed: /Clima/.test(normal.dayRead),
      detail: JSON.stringify(normal, null, 2),
    },
  ];

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

  console.log(`\nMorning brief policy evals ok: ${results.length}/${results.length}`);
}

run();
