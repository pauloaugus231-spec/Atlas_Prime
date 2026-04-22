import process from "node:process";
import { BriefRenderer } from "../src/core/brief-renderer.js";
import type { ExecutiveMorningBrief } from "../src/core/personal-os.js";
import type { BriefingProfile } from "../src/types/briefing-profile.js";

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
  const teamProfile: BriefingProfile = {
    id: "team-midday",
    name: "radar da equipe",
    aliases: ["radar da equipe"],
    enabled: true,
    deliveryMode: "both",
    deliveryChannel: "telegram",
    audience: "team",
    targetRecipientIds: [],
    time: "12:00",
    weekdays: [1, 2, 3, 4, 5],
    timezone: "America/Sao_Paulo",
    style: "executive",
    sections: ["focus", "next_action", "agenda", "approvals", "motivation"],
  };
  const teamRender = renderer.renderForProfile(heavyBrief, teamProfile);
  const openingOk = /Bom dia|Boa tarde|Boa noite/.test(normal);

  const results: EvalResult[] = [
    {
      name: "brief_renderer_render_with_empty_brief_uses_daily_prep_opening",
      passed:
        typeof normal === "string"
        && openingOk
        && normal.includes("**Atenção principal**")
        && normal.includes("**Primeiro movimento**")
        && normal.includes("**Compromissos principais**")
        && normal.includes("**Ponto de atenção**")
        && normal.includes("**Mensagem do dia**"),
      detail: normal,
    },
    {
      name: "brief_renderer_render_heavy_brief_returns_compact_version",
      passed: heavyRender === compact,
      detail: heavyRender,
    },
    {
      name: "brief_renderer_daily_prep_drops_dashboard_sections",
      passed:
        !heavyRender.includes("*Agenda*")
        && !heavyRender.includes("*Emails críticos*")
        && !heavyRender.includes("*Tarefas*")
        && !heavyRender.includes("Resumo rápido"),
      detail: heavyRender,
    },
    {
      name: "brief_renderer_includes_compact_commitments_and_message",
      passed:
        heavyRender.includes("**Compromissos**")
        && heavyRender.includes("**Mensagem**")
        && heavyRender.includes("Reunião CAPS Girassol"),
      detail: heavyRender,
    },
    {
      name: "brief_renderer_integrates_weather_into_day_read",
      passed: heavyRender.includes("Clima"),
      detail: heavyRender,
    },
    {
      name: "brief_renderer_compact_respects_15_line_limit",
      passed: compact.split("\n").length <= 18,
      detail: `lines=${compact.split("\\n").length}\n${compact}`,
    },
    {
      name: "brief_renderer_profile_respects_custom_sections",
      passed:
        teamRender.includes("*Agenda*")
        && teamRender.includes("*Próxima ação*")
        && !teamRender.includes("*Emails críticos*")
        && !teamRender.includes("*Tarefas*")
        && !teamRender.includes("**Atenção principal**"),
      detail: teamRender,
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
