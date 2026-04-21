import process from "node:process";
import { AgentCore } from "../src/core/agent-core.js";
import type { Logger } from "../src/types/logger.js";
import type { CapabilityPlan } from "../src/core/capability-planner.js";
import type { LlmChatResponse } from "../src/types/llm.js";
import type { GooglePlaceLookupResult, GoogleRouteLookupResult } from "../src/integrations/google/google-maps.js";

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
      confidence: 0.93,
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

function makePlace(name: string, address: string): GooglePlaceLookupResult {
  return {
    source: "places",
    query: name,
    name,
    formattedAddress: address,
    shortFormattedAddress: address,
    mapsUrl: `https://maps.google.com/?q=${encodeURIComponent(name)}`,
    placeId: name.toLowerCase().replace(/\s+/g, "-"),
    latitude: -30.0,
    longitude: -51.0,
    types: ["point_of_interest"],
  };
}

function makeRoute(): GoogleRouteLookupResult {
  return {
    originQuery: "Porto Alegre",
    destinationQuery: "Torres",
    origin: makePlace("Porto Alegre", "Porto Alegre - RS"),
    destination: makePlace("Torres", "Torres - RS"),
    distanceMeters: 190000,
    durationSeconds: 10800,
    hasTolls: true,
    tolls: [{ currencyCode: "BRL", amount: 23.5 }],
    tollPriceKnown: true,
    localizedDistanceText: "190 km",
    localizedDurationText: "3 h",
    mapsUrl: "https://maps.google.com/?saddr=Porto+Alegre&daddr=Torres",
    warnings: [],
  };
}

function buildCoreStub() {
  const core = Object.create(AgentCore.prototype) as AgentCore;
  const logger = makeLogger();

  (core as any).logger = logger;
  (core as any).config = {
    google: {
      defaultTimezone: "America/Sao_Paulo",
    },
  };
  (core as any).client = {
    chat: async (): Promise<LlmChatResponse> => ({
      model: "eval-llm",
      done: true,
      message: {
        role: "assistant",
        content: "",
      },
    }),
  };
  (core as any).googleMaps = {
    computeRoute: async () => makeRoute(),
    searchPlaces: async () => ({
      query: "restaurante em porto alegre",
      results: [
        makePlace("Restaurante A", "Rua A, 100 - Porto Alegre - RS"),
        makePlace("Restaurante B", "Rua B, 200 - Porto Alegre - RS"),
      ],
    }),
  };
  (core as any).createWebResearchService = () => ({
    search: async () => ([
      {
        title: "Atlas Prime roadmap",
        url: "https://example.com/atlas-prime",
        sourceHost: "example.com",
        snippet: "Roadmap atualizado do Atlas Prime.",
        excerpt: "Roadmap atualizado do Atlas Prime com foco em canais e planner.",
        publishedAt: "2026-04-20",
        score: 90,
      },
    ]),
    fetchPageExcerpt: async () => "Roadmap atualizado do Atlas Prime com foco em canais e planner.",
  });
  (core as any).activeGoals = new Map([["chat-1", { kind: "travel_planning", objective: "travel_cost_estimate" }]]);

  return core;
}

async function run(): Promise<void> {
  const results: EvalResult[] = [];
  const core = buildCoreStub();
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
    const result = await (core as any).tryRunDirectWebResearch(
      "pesquise na internet sobre Atlas Prime com fontes",
      "req-web-direct",
      logger,
      orchestration,
    );
    results.push(assert(
      "agent_core_web_research_wrapper_uses_extracted_service",
      Boolean(
        result?.reply?.includes("Atlas Prime") &&
        result.reply.includes("example.com") &&
        result.toolExecutions[0]?.toolName === "web_search",
      ),
      result?.reply,
    ));
  }

  {
    const plan: CapabilityPlan = {
      objective: "recent_information_lookup",
      summary: "Pesquisar informação recente",
      confidence: 0.9,
      requiredCapabilities: ["web.search"],
      availability: [],
      missingRequirements: [],
      missingUserData: [],
      suggestedAction: "run_web_search",
      webQuery: "Atlas Prime roadmap",
      researchMode: "executive",
    };

    const result = await (core as any).executeCapabilityPlan({
      userPrompt: "me traga o roadmap recente do Atlas Prime",
      requestId: "req-plan-web",
      requestLogger: logger,
      orchestration,
      preferences,
      plan,
      relatedSkill: "research",
    });

    results.push(assert(
      "execute_capability_plan_delegates_run_web_search_to_service",
      Boolean(
        result?.reply?.includes("Atlas Prime") &&
        result.toolExecutions[0]?.toolName === "web_search",
      ),
      result?.reply,
    ));
  }

  {
    (core as any).activeGoals.set("chat-1", { kind: "travel_planning", objective: "travel_cost_estimate" });
    const plan: CapabilityPlan = {
      objective: "travel_cost_estimate",
      summary: "Calcular rota e custo",
      confidence: 0.95,
      requiredCapabilities: ["maps.route"],
      availability: [],
      missingRequirements: [],
      missingUserData: [],
      suggestedAction: "run_maps_route",
      routeRequest: {
        origin: "Porto Alegre",
        destination: "Torres",
        includeTolls: true,
        objective: "travel_cost_estimate",
        roundTrip: true,
        fuelPricePerLiter: 6.7,
        consumptionKmPerLiter: 13,
        vehicle: "JAC T40",
      },
    };

    const result = await (core as any).executeCapabilityPlan({
      userPrompt: "quanto vou gastar de Porto Alegre até Torres?",
      requestId: "req-plan-route",
      requestLogger: logger,
      orchestration,
      preferences,
      plan,
      relatedSkill: "travel",
      activeGoalChatId: "chat-1",
    });

    results.push(assert(
      "execute_capability_plan_delegates_run_maps_route_and_clears_active_goal",
      Boolean(
        result?.reply?.includes("Porto Alegre - RS") &&
        result.reply.includes("Torres - RS") &&
        result.toolExecutions[0]?.toolName === "maps.route" &&
        !(core as any).activeGoals.has("chat-1"),
      ),
      result?.reply,
    ));
  }

  {
    (core as any).activeGoals.set("chat-1", { kind: "place_discovery", objective: "restaurant_search" });
    const plan: CapabilityPlan = {
      objective: "place_discovery",
      summary: "Buscar restaurantes próximos",
      confidence: 0.91,
      requiredCapabilities: ["maps.places_search"],
      availability: [],
      missingRequirements: [],
      missingUserData: [],
      suggestedAction: "run_maps_places_search",
      placesRequest: {
        query: "restaurante em porto alegre",
        category: "restaurant",
        categoryLabel: "restaurante",
        locationQuery: "Porto Alegre",
        maxResults: 5,
      },
    };

    const result = await (core as any).executeCapabilityPlan({
      userPrompt: "me mostra restaurantes perto de mim",
      requestId: "req-plan-places",
      requestLogger: logger,
      orchestration,
      preferences,
      plan,
      relatedSkill: "places",
      activeGoalChatId: "chat-1",
    });

    results.push(assert(
      "execute_capability_plan_delegates_run_maps_places_search_and_clears_active_goal",
      Boolean(
        result?.reply?.includes("Restaurante A") &&
        result.reply.includes("Porto Alegre") &&
        result.toolExecutions[0]?.toolName === "maps.places_search" &&
        !(core as any).activeGoals.has("chat-1"),
      ),
      result?.reply,
    ));
  }

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

  console.log(`\nAgent core phase 9 evals ok: ${results.length}/${results.length}`);
}

void run();
