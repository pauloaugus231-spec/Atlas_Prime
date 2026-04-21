import process from "node:process";
import { AgentCore } from "../src/core/agent-core.js";
import type { Logger } from "../src/types/logger.js";
import type { CapabilityPlan } from "../src/core/capability-planner.js";

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
      confidence: 0.92,
      actionMode: "assist",
      reasons: ["eval"],
    },
    policy: {
      riskLevel: "medium",
      autonomyLevel: "draft_with_confirmation",
      guardrails: ["confirmar antes de escrever"],
      requiresApprovalFor: ["calendar.write"],
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
  const recordedGaps: any[] = [];

  (core as any).logger = logger;
  (core as any).config = {
    google: {
      defaultTimezone: "America/Sao_Paulo",
    },
  };
  (core as any).activeGoals = new Map([[
    "chat-1",
    {
      kind: "travel_planning",
      objective: "travel_cost_estimate",
      origin: "Porto Alegre",
      destination: "Torres",
      includeTolls: true,
      roundTrip: true,
      createdAt: "2026-04-20T10:00:00.000Z",
      updatedAt: "2026-04-20T10:00:00.000Z",
      lastPrompt: "quanto vou gastar de Porto Alegre até Torres?",
    },
  ]]);
  (core as any).personalMemory = {
    recordProductGapObservation: (input: any) => {
      recordedGaps.push(input);
      return {
        id: 46,
        signature: input.signature,
        type: input.type,
        description: input.description,
        inferredObjective: input.inferredObjective,
        missingCapabilities: input.missingCapabilities,
        missingRequirementKinds: input.missingRequirementKinds,
        contextSummary: input.contextSummary,
        relatedSkill: input.relatedSkill,
        channel: input.channel,
        impact: input.impact ?? "medium",
        recurrence: 1,
        status: "open",
        createdAt: "2026-04-20T10:00:00.000Z",
        updatedAt: "2026-04-20T10:00:00.000Z",
        lastObservedAt: "2026-04-20T10:00:00.000Z",
      };
    },
  };

  return { core, recordedGaps };
}

async function run(): Promise<void> {
  const results: EvalResult[] = [];
  const { core, recordedGaps } = buildCoreStub();
  const orchestration = buildOrchestration();
  const logger = makeLogger();
  const preferences = {
    responseStyle: "executive",
    responseLength: "medium",
    proactiveNextStep: true,
    autoSourceFallback: false,
    preferredAgentName: "Atlas",
  };

  {
    const plan: CapabilityPlan = {
      objective: "memory.read",
      summary: "Resumo simples já disponível.",
      confidence: 0.91,
      requiredCapabilities: [],
      availability: [],
      missingRequirements: [],
      missingUserData: [],
      suggestedAction: "respond_direct",
      directReply: "Resumo simples já disponível.",
    };

    const result = await (core as any).executeCapabilityPlan({
      userPrompt: "me dá um resumo simples",
      requestId: "req-phase10-direct",
      requestLogger: logger,
      orchestration,
      preferences,
      plan,
      activeGoalChatId: "chat-1",
    });

    results.push(assert(
      "execute_capability_plan_delegates_respond_direct_to_capability_action_service",
      Boolean(
        result?.reply === "Resumo simples já disponível." &&
        result.toolExecutions[0]?.toolName === "capability_planner" &&
        !(core as any).activeGoals.has("chat-1"),
      ),
      result?.reply,
    ));
  }

  {
    const plan: CapabilityPlan = {
      objective: "travel_cost_estimate",
      summary: "Faltam dados de viagem",
      confidence: 0.94,
      requiredCapabilities: ["maps.route"],
      availability: [],
      missingRequirements: [
        {
          kind: "user_data",
          name: "fuel_price",
          label: "preço do combustível",
        },
      ],
      missingUserData: ["preço do combustível"],
      suggestedAction: "ask_user_data",
    };

    const result = await (core as any).executeCapabilityPlan({
      userPrompt: "quanto vou gastar de Porto Alegre até Torres?",
      requestId: "req-phase10-user-data",
      requestLogger: logger,
      orchestration,
      preferences,
      plan,
      activeGoal: {
        kind: "travel_planning",
        objective: "travel_cost_estimate",
        origin: "Porto Alegre",
        destination: "Torres",
        includeTolls: true,
        roundTrip: true,
        createdAt: "2026-04-20T10:00:00.000Z",
        updatedAt: "2026-04-20T10:00:00.000Z",
        lastPrompt: "quanto vou gastar de Porto Alegre até Torres?",
      },
    });

    results.push(assert(
      "execute_capability_plan_delegates_ask_user_data_to_capability_action_service",
      Boolean(
        result?.reply?.includes("Já peguei rota Porto Alegre → Torres") &&
        result.reply.includes("preço do combustível") &&
        result.toolExecutions[0]?.toolName === "capability_planner",
      ),
      result?.reply,
    ));
  }

  {
    const plan: CapabilityPlan = {
      objective: "travel_cost_estimate",
      summary: "Calcular custo com rota real e pedágios",
      confidence: 0.88,
      requiredCapabilities: ["maps.route", "maps.tolls"],
      availability: [],
      missingRequirements: [
        {
          kind: "integration",
          name: "maps.route",
          label: "rota real de mapas",
        },
        {
          kind: "integration",
          name: "maps.tolls",
          label: "pedágios da rota",
        },
      ],
      missingUserData: [],
      suggestedAction: "handle_gap",
      shouldLogGap: true,
      gapType: "travel_estimation_missing",
    };

    const result = await (core as any).executeCapabilityPlan({
      userPrompt: "quanto vou gastar de Porto Alegre até Torres com rota real?",
      requestId: "req-phase10-gap",
      requestLogger: logger,
      orchestration,
      preferences,
      plan,
      relatedSkill: "travel",
    });

    results.push(assert(
      "execute_capability_plan_delegates_handle_gap_to_capability_action_service",
      Boolean(
        result?.reply?.includes("me faltam rota real de mapas, pedágios da rota") &&
        result.reply.includes("lacuna real do Atlas (#46)") &&
        recordedGaps.length === 1 &&
        recordedGaps[0]?.impact === "high" &&
        result.toolExecutions[0]?.resultPreview?.includes("\"gapId\":46"),
      ),
      result?.reply,
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
  console.error("eval-agent-core-phase10 failed", error);
  process.exitCode = 1;
});
