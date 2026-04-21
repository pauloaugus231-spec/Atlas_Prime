import process from "node:process";
import { BriefRenderer } from "../src/core/brief-renderer.js";
import type { ExecutiveMorningBrief } from "../src/core/personal-os.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const baseBrief: ExecutiveMorningBrief = {
  timezone: "America/Sao_Paulo",
  events: [],
  taskBuckets: {
    today: [],
    overdue: [],
    stale: [],
    actionableCount: 0,
  },
  emails: [],
  approvals: [],
  workflows: [],
  focus: [],
  memoryEntities: {
    total: 0,
    byKind: {},
    recent: [],
  },
  motivation: {
    text: "Um passo bom ainda vale mais do que pressa sem direção.",
    author: "Atlas",
  },
  founderSnapshot: {
    executiveLine: "Atlas aguardando integração de dados no Founder Brief.",
    sections: [],
    trackedMetrics: [],
  },
  personalFocus: [],
  overloadLevel: "leve",
  mobilityAlerts: [],
  operationalSignals: [],
  conflictSummary: {
    overlaps: 0,
    duplicates: 0,
    naming: 0,
  },
  weather: {
    locationLabel: "Porto Alegre",
    current: {
      description: "tempo firme",
      temperatureC: 22,
    },
    days: [],
  },
};

function run() {
  const renderer = new BriefRenderer();
  const normal = renderer.render(baseBrief);
  const heavyBrief: ExecutiveMorningBrief = {
    ...baseBrief,
    overloadLevel: "pesado",
    dayRecommendation: "Fechar só o essencial antes do almoço.",
    nextAction: "Resolver o conflito da manhã.",
    goalSummary: "Objetivos: (1) Fechar 2 clientes SaaS — receita, prazo: 2026-05-31, 40%",
    events: [
      {
        account: "abordagem",
        summary: "Reunião CAPS Girassol",
        start: "2026-04-21T09:00:00-03:00",
        end: "2026-04-21T10:00:00-03:00",
        location: "Restinga",
        owner: "paulo",
        context: "externo",
        hasConflict: true,
        prepHint: "preparar deslocamento",
      },
      {
        account: "abordagem",
        summary: "CREAS Restinga",
        start: "2026-04-21T10:00:00-03:00",
        end: "2026-04-21T11:00:00-03:00",
        location: "CREAS Restinga",
        owner: "paulo",
        context: "externo",
        hasConflict: false,
        prepHint: "confirmar material",
      },
    ],
    emails: [
      {
        account: "primary",
        uid: "email-1",
        subject: "Retorno urgente do CREAS",
        from: ["Equipe CREAS <creas@example.com>"],
        priority: "urgente",
        action: "responder hoje",
        relationship: "colleague",
        group: "profissional",
      },
      {
        account: "primary",
        uid: "email-2",
        subject: "Alerta alto",
        from: ["Equipe CAPS <caps@example.com>"],
        priority: "alta",
        action: "verificar",
        relationship: "colleague",
        group: "profissional",
      },
    ],
    taskBuckets: {
      today: [
        {
          id: "task-1",
          taskListId: "list-1",
          taskListTitle: "Pessoal",
          title: "Retornar CAPS",
          status: "needsAction",
          due: "2026-04-21T15:00:00-03:00",
          updated: "2026-04-21T08:00:00-03:00",
          account: "primary",
        },
      ],
      overdue: [
        {
          id: "task-2",
          taskListId: "list-1",
          taskListTitle: "Pessoal",
          title: "Fechar relatório atrasado",
          status: "needsAction",
          due: "2026-04-20T16:00:00-03:00",
          updated: "2026-04-20T08:00:00-03:00",
          account: "primary",
        },
      ],
      stale: [],
      actionableCount: 2,
    },
  };
  const heavyRender = renderer.render(heavyBrief);
  const compact = renderer.renderCompact(heavyBrief);

  const results: EvalResult[] = [
    {
      name: "brief_renderer_render_with_empty_brief_does_not_throw",
      passed: typeof normal === "string" && normal.includes("Bom dia"),
      detail: normal,
    },
    {
      name: "brief_renderer_render_heavy_brief_returns_compact_version",
      passed: heavyRender === compact,
      detail: heavyRender,
    },
    {
      name: "brief_renderer_marks_conflicting_events_with_warning",
      passed: heavyRender.includes("⚠️"),
      detail: heavyRender,
    },
    {
      name: "brief_renderer_includes_goal_summary_when_present",
      passed: heavyRender.includes("*Objetivos ativos*") && heavyRender.includes("Fechar 2 clientes SaaS"),
      detail: heavyRender,
    },
    {
      name: "brief_renderer_marks_institutional_field_day_in_opening",
      passed: heavyRender.includes("🏢 Dia de campo"),
      detail: heavyRender,
    },
    {
      name: "brief_renderer_compact_respects_15_line_limit",
      passed: compact.split("\n").length <= 15,
      detail: `lines=${compact.split("\\n").length}\n${compact}`,
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

  console.log(`\nBrief renderer evals ok: ${results.length}/${results.length}`);
}

run();
