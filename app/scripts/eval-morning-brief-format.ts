import process from "node:process";
import { buildMorningBriefReply } from "../src/core/agent-core.js";
import type { ExecutiveMorningBrief } from "../src/core/personal-os.js";
import type { PersonalOperationalProfile } from "../src/types/personal-operational-memory.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const profile: PersonalOperationalProfile = {
  displayName: "Paulo",
  primaryRole: "operador de rotina",
  routineSummary: ["dois contextos de trabalho e rotina externa frequente"],
  timezone: "America/Sao_Paulo",
  preferredChannels: ["telegram", "whatsapp"],
  preferredAlertChannel: "telegram",
  priorityAreas: ["agenda", "deslocamento", "conflitos"],
  defaultAgendaScope: "both",
  workCalendarAliases: ["abordagem"],
  responseStyle: "direto e objetivo",
  briefingPreference: "curto",
  detailLevel: "resumo",
  tonePreference: "executivo",
  defaultOperationalMode: "normal",
  mobilityPreferences: ["priorizar deslocamento e rota antes de sair"],
  autonomyPreferences: ["leituras simples executam direto"],
  savedFocus: ["resolver conflitos antes de aceitar novas demandas"],
  routineAnchors: ["agenda simples em modo resumo"],
  operationalRules: ["ações destrutivas exigem confirmação forte"],
  attire: {
    umbrellaProbabilityThreshold: 40,
    coldTemperatureC: 18,
    lightClothingTemperatureC: 24,
    carryItems: ["carregador", "casaco leve"],
  },
  fieldModeHours: 18,
};

const brief: ExecutiveMorningBrief = {
  timezone: "America/Sao_Paulo",
  events: [
    {
      account: "primary",
      summary: "Reunião CAPS Girassol",
      start: "2026-04-17T10:00:00-03:00",
      end: "2026-04-17T11:00:00-03:00",
      location: "Restinga",
      owner: "paulo",
      context: "externo",
      hasConflict: false,
      prepHint: "preparar deslocamento",
    },
  ],
  taskBuckets: {
    today: [
      {
        id: "task-1",
        taskListId: "list-1",
        taskListTitle: "Pessoal",
        title: "Fechar retorno do CREAS",
        status: "needsAction",
        due: "2026-04-17T15:00:00-03:00",
        updated: "2026-04-17T08:00:00-03:00",
        account: "primary",
      },
    ],
    overdue: [],
    stale: [],
    actionableCount: 1,
  },
  emails: [
    {
      account: "primary",
      uid: "email-1",
      subject: "Retorno urgente do CREAS",
      from: ["Equipe CREAS <creas@example.com>"],
      priority: "alta",
      action: "responder hoje",
      relationship: "colleague",
      group: "profissional",
    },
  ],
  approvals: [],
  workflows: [],
  focus: [],
  memoryEntities: {
    total: 0,
    byKind: {},
    recent: [],
  },
  motivation: {
    text: "Resolver bem hoje vale mais do que prometer muito amanhã.",
  },
  founderSnapshot: {
    executiveLine: "Atlas aguardando integração de dados no Founder Brief.",
    sections: [],
    trackedMetrics: [],
  },
  nextAction: "Preparar deslocamento para o CAPS.",
  personalFocus: ["resolver conflitos antes de aceitar novas demandas"],
  overloadLevel: "moderado",
  mobilityAlerts: ["saída externa: Reunião CAPS Girassol | local: Restinga", "itens base: carregador, casaco leve"],
  conflictSummary: {
    overlaps: 0,
    duplicates: 0,
    naming: 0,
  },
  dayRecommendation: "prepare a rua cedo: saída externa: Reunião CAPS Girassol | local: Restinga",
  weather: {
    locationLabel: "Porto Alegre, RS",
    current: {
      description: "parcialmente nublado",
      temperatureC: 22,
    },
    days: [
      {
        label: "Hoje",
        description: "pancadas de chuva fracas",
        minTempC: 19,
        maxTempC: 24,
        precipitationProbabilityMax: 75,
        tip: "vestir: roupa leve | levar: leve guarda-chuva",
      },
      {
        label: "Amanhã",
        description: "encoberto",
        minTempC: 18,
        maxTempC: 23,
        precipitationProbabilityMax: 10,
        tip: "vestir: camada leve cedo | levar: sem necessidade de guarda-chuva",
      },
    ],
  },
};

function run() {
  const normal = buildMorningBriefReply(brief, {
    profile,
    compact: false,
    operationalMode: null,
  });
  const field = buildMorningBriefReply(brief, {
    profile,
    compact: true,
    operationalMode: "field",
  });

  const results: EvalResult[] = [
    {
      name: "morning_brief_has_operational_sections_in_order",
      passed:
        normal.includes("Visão do dia:")
        && normal.includes("Atenção principal:")
        && normal.includes("Rua, clima e deslocamento:")
        && normal.includes("Agenda limpa:")
        && normal.includes("Prioridade do dia / próxima ação:")
        && normal.includes("Mensagem do dia:"),
      detail: normal,
    },
    {
      name: "morning_brief_opens_with_assistive_day_summary",
      passed:
        normal.includes("Hoje teu dia está")
        && normal.includes("O principal agora é")
        && !normal.includes("Resumo rápido:")
        && !normal.includes("Leitura operacional"),
      detail: normal,
    },
    {
      name: "morning_brief_compact_field_mode_mentions_carry_items",
      passed:
        field.includes("Levar: carregador, casaco leve")
        && field.includes("Hoje o foco é operar em modo rua"),
      detail: field,
    },
    {
      name: "morning_brief_field_mode_is_more_compact",
      passed: field.split("\n").length <= normal.split("\n").length,
      detail: `normal_lines=${normal.split("\n").length} field_lines=${field.split("\n").length}`,
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

  console.log(`\nMorning brief evals ok: ${results.length}/${results.length}`);
}

run();
