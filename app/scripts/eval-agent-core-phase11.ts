import process from "node:process";
import { AgentCore } from "../src/core/agent-core.js";
import type { Logger } from "../src/types/logger.js";

type EvalResult = {
  name: string;
  passed: boolean;
  detail?: string;
};

function assert(name: string, passed: boolean, detail?: string): EvalResult {
  return { name, passed, detail };
}

function makeLogger(): Logger {
  const logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => logger,
  } as unknown as Logger;
  return logger;
}

function buildOrchestration(): any {
  return {
    route: {
      primaryDomain: "secretario_operacional",
      secondaryDomains: [],
      confidence: 0.91,
      actionMode: "assist",
      reasons: ["eval"],
    },
    policy: {
      riskLevel: "medium",
      autonomyLevel: "draft_with_confirmation",
      guardrails: ["confirmar antes de escrever"],
      requiresApprovalFor: [],
      capabilities: {
        canReadSensitiveChannels: true,
        canDraftExternalReplies: true,
        canSendExternalReplies: false,
        canWriteWorkspace: false,
        canPersistMemory: true,
        canRunProjectTools: false,
        canModifyCalendar: true,
        canPublishContent: false,
      },
    },
  };
}

function buildCoreStub() {
  const core = Object.create(AgentCore.prototype) as AgentCore;
  const logger = makeLogger();
  const latestGap = {
    id: 77,
    signature: "travel_cost_estimate::maps.route|maps.tolls::no_user_data_gap",
    type: "travel_estimation_missing",
    description: "quanto vou gastar de Porto Alegre até Torres com rota real?",
    inferredObjective: "travel_cost_estimate",
    missingCapabilities: ["maps.route", "maps.tolls"],
    missingRequirementKinds: ["external_dependency", "external_dependency"],
    contextSummary: "Calcular custo com rota real e pedágios.",
    relatedSkill: "travel",
    channel: "telegram",
    impact: "high",
    recurrence: 3,
    status: "open",
    createdAt: "2026-04-20T11:00:00.000Z",
    updatedAt: "2026-04-20T11:00:00.000Z",
    lastObservedAt: "2026-04-20T11:00:00.000Z",
  };
  const openGaps = [
    latestGap,
    {
      ...latestGap,
      id: 78,
      signature: "place_discovery::maps.places_search::no_user_data_gap",
      inferredObjective: "place_discovery",
      missingCapabilities: ["maps.places_search"],
      recurrence: 1,
      impact: "medium",
    },
  ];

  (core as any).logger = logger;
  (core as any).config = {
    google: {
      defaultTimezone: "America/Sao_Paulo",
    },
  };
  (core as any).capabilityPlanner = {
    isCapabilityInspectionPrompt: (prompt: string) =>
      prompt.includes("gaps")
      || prompt.includes("lacunas")
      || prompt.includes("por que")
      || prompt.includes("capabilities"),
    listCapabilityAvailability: () => [
      {
        name: "weather.lookup",
        description: "Consulta clima",
        domain: "secretario_operacional",
        category: "weather",
        availability: "available",
        reason: "ativo",
        requiresApproval: false,
        experimental: false,
        declaredOnly: false,
      },
      {
        name: "maps.route",
        description: "Calcula rota",
        domain: "secretario_operacional",
        category: "maps",
        availability: "unavailable",
        reason: "integração ainda não conectada",
        requiresApproval: false,
        experimental: true,
        integrationKey: "google_maps",
        declaredOnly: false,
      },
      {
        name: "maps.tolls",
        description: "Calcula pedágios",
        domain: "secretario_operacional",
        category: "maps",
        availability: "partial",
        reason: "depende de rota real externa",
        requiresApproval: false,
        experimental: true,
        integrationKey: "google_maps",
        declaredOnly: true,
      },
    ],
  };
  (core as any).personalMemory = {
    listProductGaps: (input?: { status?: string; limit?: number }) => {
      if (input?.status === "open") {
        return openGaps.slice(0, input.limit ?? openGaps.length);
      }
      return [latestGap];
    },
  };

  return { core, latestGap, openGaps };
}

async function run(): Promise<void> {
  const results: EvalResult[] = [];
  const { core, latestGap, openGaps } = buildCoreStub();
  const orchestration = buildOrchestration();
  const preferences = {
    responseStyle: "executive",
    responseLength: "medium",
    proactiveNextStep: true,
    autoSourceFallback: false,
    preferredAgentName: "Atlas",
  };

  {
    const result = await (core as any).tryRunDirectCapabilityInspection(
      "por que você não conseguiu resolver isso",
      "req-phase11-why",
      orchestration,
      preferences,
    );

    results.push(assert(
      "agent_core_capability_inspection_wrapper_returns_latest_gap_detail_from_service",
      Boolean(
        result?.reply?.includes("maps.route, maps.tolls") &&
        result.reply.includes("Isso já apareceu 3 vezes") &&
        result.toolExecutions[0]?.toolName === "product_gap.inspect",
      ),
      result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectCapabilityInspection(
      "mostre gaps de capability",
      "req-phase11-gaps",
      orchestration,
      preferences,
    );

    results.push(assert(
      "agent_core_capability_inspection_wrapper_lists_open_gaps_from_service",
      Boolean(
        result?.reply?.includes(`Gaps recentes identificados pelo uso: ${openGaps.length}.`) &&
        result.reply.includes("#77") &&
        result.toolExecutions[0]?.toolName === "product_gap.list",
      ),
      result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectCapabilityInspection(
      "o que você ainda não consegue fazer? mostre capabilities",
      "req-phase11-availability",
      orchestration,
      preferences,
    );

    results.push(assert(
      "agent_core_capability_inspection_wrapper_lists_capability_availability_from_service",
      Boolean(
        result?.reply?.includes("maps.route | unavailable | integração ainda não conectada") &&
        result.reply.includes("maps.tolls | partial | depende de rota real externa") &&
        result.toolExecutions[0]?.toolName === "capability_registry.inspect",
      ),
      result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectCapabilityInspection(
      "oi atlas",
      "req-phase11-non-inspection",
      orchestration,
      preferences,
    );

    results.push(assert(
      "agent_core_capability_inspection_wrapper_ignores_non_inspection_prompt",
      result === null,
      String(result),
    ));
  }

  const failed = results.filter((item) => !item.passed);
  for (const result of results) {
    const prefix = result.passed ? "PASS" : "FAIL";
    const suffix = result.detail ? ` :: ${result.detail}` : "";
    console.log(`${prefix} ${result.name}${suffix}`);
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("eval-agent-core-phase11 failed", error);
  process.exitCode = 1;
});
