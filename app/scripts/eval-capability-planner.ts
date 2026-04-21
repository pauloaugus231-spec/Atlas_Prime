import process from "node:process";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import type { AppConfig } from "../src/types/config.js";
import type { Logger } from "../src/types/logger.js";
import type { GoogleWorkspaceAccountsService } from "../src/integrations/google/google-workspace-accounts.js";
import type { GoogleMapsService } from "../src/integrations/google/google-maps.js";
import type { ExternalReasoningClient } from "../src/integrations/external-reasoning/external-reasoning-client.js";
import { ToolPluginRegistry } from "../src/core/plugin-registry.js";
import { CapabilityRegistry } from "../src/core/capability-registry.js";
import { createBuiltInCapabilities } from "../src/core/capabilities/index.js";
import { createDeclaredCapabilityCatalog } from "../src/core/capabilities/catalog.js";
import {
  CapabilityPlanner,
  looksLikeCapabilityAwarePlacePrompt,
  looksLikeCapabilityAwareTravelPrompt,
  looksLikeCapabilityInspectionPrompt,
} from "../src/core/capability-planner.js";
import { PersonalOperationalMemoryStore } from "../src/core/personal-operational-memory.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

class SilentLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  child(): Logger {
    return this;
  }
}

function buildPlanner(input?: {
  googleReady?: boolean;
  googleWriteReady?: boolean;
  mapsReady?: boolean;
  whatsappEnabled?: boolean;
  whatsappSidecarEnabled?: boolean;
  planningContext?: {
    goalSummary?: string;
    activeGoals?: Array<{
      title: string;
      description?: string;
      domain: "revenue" | "product" | "personal" | "content" | "ops" | "other";
      deadline?: string;
      progress?: number;
    }>;
  };
}): CapabilityPlanner {
  const logger = new SilentLogger();
  const toolRegistry = new ToolPluginRegistry([], logger);
  const capabilityRegistry = new CapabilityRegistry(
    toolRegistry,
    createBuiltInCapabilities(),
    createDeclaredCapabilityCatalog(),
    logger,
  );

  const config = {
    llm: {
      provider: "ollama",
    },
    whatsapp: {
      enabled: input?.whatsappEnabled ?? true,
      sidecarEnabled: input?.whatsappSidecarEnabled ?? true,
    },
  } as AppConfig;

  const googleWorkspaces = {
    getAliases: () => ["primary"],
    getWorkspace: () => ({
      getStatus: () => ({
        ready: input?.googleReady ?? true,
        writeReady: input?.googleWriteReady ?? true,
      }),
    }),
  } as unknown as GoogleWorkspaceAccountsService;

  const googleMaps = {
    getStatus: () => ({
      enabled: input?.mapsReady ?? false,
      configured: input?.mapsReady ?? false,
      ready: input?.mapsReady ?? false,
      message: input?.mapsReady
        ? "Google Maps integration ready."
        : "Google Maps integration is disabled.",
      defaultRegionCode: "BR",
      defaultLanguageCode: "pt-BR",
    }),
  } as unknown as GoogleMapsService;

  const externalReasoning = {} as ExternalReasoningClient;

  return new CapabilityPlanner(
    config,
    capabilityRegistry,
    googleWorkspaces,
    googleMaps,
    externalReasoning,
    logger,
    () => input?.planningContext,
  );
}

async function run(): Promise<void> {
  const results: EvalResult[] = [];

  const planner = buildPlanner();
  const availability = planner.listCapabilityAvailability();
  const weather = availability.find((item) => item.name === "weather.lookup");
  results.push({
    name: "available_capability_is_reported_normally",
    passed: weather?.availability === "available",
    detail: JSON.stringify(weather, null, 2),
  });

  const partialPlanner = buildPlanner({
    googleReady: true,
    googleWriteReady: false,
  });
  const partialAvailability = partialPlanner.listCapabilityAvailability();
  const calendarWrite = partialAvailability.find((item) => item.name === "calendar.write");
  results.push({
    name: "partially_available_capability_is_distinguished",
    passed: calendarWrite?.availability === "partial",
    detail: JSON.stringify(calendarWrite, null, 2),
  });

  const mapsReadyPlanner = buildPlanner({
    mapsReady: true,
  });
  const routeReadyPlan = mapsReadyPlanner.plan("qual a distância de Porto Alegre até Torres?");
  results.push({
    name: "distance_request_uses_real_route_when_maps_is_available",
    passed:
      routeReadyPlan?.objective === "route_distance"
      && routeReadyPlan.suggestedAction === "run_maps_route"
      && routeReadyPlan.routeRequest?.origin === "Porto Alegre"
      && routeReadyPlan.routeRequest?.destination === "Torres",
    detail: JSON.stringify(routeReadyPlan, null, 2),
  });

  const travelCostWithMapsReady = mapsReadyPlanner.plan("quanto vou gastar de Porto Alegre até Torres com gasolina 6,19 e 11 km/l?");
  results.push({
    name: "travel_cost_with_maps_ready_uses_route_execution",
    passed:
      travelCostWithMapsReady?.objective === "travel_cost_estimate"
      && travelCostWithMapsReady.suggestedAction === "run_maps_route"
      && travelCostWithMapsReady.routeRequest?.includeTolls === true,
    detail: JSON.stringify(travelCostWithMapsReady, null, 2),
  });

  const roundTripTravelCostWithMapsReady = mapsReadyPlanner.plan("quanto vou gastar de Porto Alegre até Torres ida e volta com gasolina 6,19 e 11 km/l?");
  results.push({
    name: "round_trip_travel_cost_marks_route_request_as_round_trip",
    passed:
      roundTripTravelCostWithMapsReady?.objective === "travel_cost_estimate"
      && roundTripTravelCostWithMapsReady.suggestedAction === "run_maps_route"
      && roundTripTravelCostWithMapsReady.routeRequest?.roundTrip === true,
    detail: JSON.stringify(roundTripTravelCostWithMapsReady, null, 2),
  });

  const travelGapPlan = planner.plan("quanto vou gastar de Porto Alegre até Torres com meu JAC T40?");
  results.push({
    name: "travel_cost_request_with_missing_maps_routes_to_gap_handler",
    passed:
      travelGapPlan?.suggestedAction === "handle_gap"
      && travelGapPlan.missingRequirements.some((item) => item.name === "maps.route")
      && travelGapPlan.gapType === "travel_estimation_missing",
    detail: JSON.stringify(travelGapPlan, null, 2),
  });

  const mapsDistancePlan = planner.plan("qual a distância de Porto Alegre até Torres?");
  results.push({
    name: "distance_request_stays_in_maps_gap_not_generic_web_search",
    passed:
      mapsDistancePlan?.objective === "route_distance"
      && mapsDistancePlan.suggestedAction === "handle_gap"
      && mapsDistancePlan.missingRequirements.some((item) => item.name === "maps.distance"),
    detail: JSON.stringify(mapsDistancePlan, null, 2),
  });

  const travelUserDataPlan = planner.plan("quanto vou gastar em 180 km com meu carro?");
  results.push({
    name: "travel_cost_request_with_distance_only_asks_minimal_user_data",
    passed:
      travelUserDataPlan?.suggestedAction === "ask_user_data"
      && travelUserDataPlan.missingUserData.includes("consumo médio do carro em km/l")
      && travelUserDataPlan.missingUserData.includes("preço do combustível por litro")
      && travelUserDataPlan.missingRequirements.length === 0,
    detail: JSON.stringify(travelUserDataPlan, null, 2),
  });

  const travelDirectPlan = planner.plan("quanto vou gastar em 180 km com meu carro fazendo 11 km/l e gasolina 6,19?");
  results.push({
    name: "travel_cost_request_with_enough_inputs_responds_directly",
    passed:
      travelDirectPlan?.suggestedAction === "respond_direct"
      && typeof travelDirectPlan.directReply === "string"
      && travelDirectPlan.directReply.includes("gasto com combustível"),
    detail: JSON.stringify(travelDirectPlan, null, 2),
  });

  const nearbyPlacesPlan = mapsReadyPlanner.plan("me mostra restaurantes na Restinga");
  results.push({
    name: "nearby_place_request_uses_maps_places_search_when_maps_is_available",
    passed:
      nearbyPlacesPlan?.objective === "place_discovery"
      && nearbyPlacesPlan.suggestedAction === "run_maps_places_search"
      && nearbyPlacesPlan.placesRequest?.locationQuery === "Restinga",
    detail: JSON.stringify(nearbyPlacesPlan, null, 2),
  });

  const nearbyMissingLocationPlan = mapsReadyPlanner.plan("me mostra restaurantes perto de mim");
  results.push({
    name: "nearby_place_request_asks_only_for_reference_location_when_missing",
    passed:
      nearbyMissingLocationPlan?.objective === "place_discovery"
      && nearbyMissingLocationPlan.suggestedAction === "ask_user_data"
      && nearbyMissingLocationPlan.missingUserData.includes("local de referência"),
    detail: JSON.stringify(nearbyMissingLocationPlan, null, 2),
  });

  const flightSearchPlan = planner.plan("compare preços de passagens aéreas de Porto Alegre para Recife em dezembro");
  results.push({
    name: "flight_search_request_routes_to_web_search_with_minimal_structure",
    passed:
      flightSearchPlan?.objective === "flight_search"
      && flightSearchPlan.suggestedAction === "run_web_search"
      && flightSearchPlan.requiredCapabilities.includes("web.search"),
    detail: JSON.stringify(flightSearchPlan, null, 2),
  });

  const hotelMissingPeriodPlan = planner.plan("me mostra hotéis em Torres");
  results.push({
    name: "hotel_search_request_asks_for_period_when_missing",
    passed:
      hotelMissingPeriodPlan?.objective === "hotel_search"
      && hotelMissingPeriodPlan.suggestedAction === "ask_user_data"
      && hotelMissingPeriodPlan.missingUserData.includes("período da viagem"),
    detail: JSON.stringify(hotelMissingPeriodPlan, null, 2),
  });

  results.push({
    name: "inspection_prompt_detector_matches_capability_questions",
    passed:
      looksLikeCapabilityInspectionPrompt("o que você ainda não consegue fazer?")
      && looksLikeCapabilityInspectionPrompt("quais lacunas você identificou recentemente?"),
  });

  results.push({
    name: "travel_prompt_detector_matches_route_and_cost_requests",
    passed:
      looksLikeCapabilityAwareTravelPrompt("quanto vou gastar de Porto Alegre até Torres?")
      && looksLikeCapabilityAwareTravelPrompt("qual a distância de Porto Alegre até Torres?"),
  });

  results.push({
    name: "place_prompt_detector_matches_nearby_requests",
    passed:
      looksLikeCapabilityAwarePlacePrompt("me mostra restaurantes na Restinga")
      && looksLikeCapabilityAwarePlacePrompt("hotel perto do aeroporto"),
  });

  const webResearchPlan = planner.plan("qual a cotação do dólar hoje?");
  results.push({
    name: "recent_external_information_routes_to_real_web_search",
    passed:
      webResearchPlan?.objective === "recent_information_lookup"
      && webResearchPlan.suggestedAction === "run_web_search"
      && webResearchPlan.requiredCapabilities.includes("web.search"),
    detail: JSON.stringify(webResearchPlan, null, 2),
  });

  const webComparisonPlan = planner.plan("compare OpenAI e Anthropic hoje com fontes");
  results.push({
    name: "comparison_request_uses_web_search_capability",
    passed:
      webComparisonPlan?.objective === "web_comparison"
      && webComparisonPlan.suggestedAction === "run_web_search"
      && webComparisonPlan.researchMode === "executive",
    detail: JSON.stringify(webComparisonPlan, null, 2),
  });

  const goalAlignedTravelPlanner = buildPlanner({
    planningContext: {
      goalSummary: "Objetivos: Planejar viagem para palestra em Recife",
      activeGoals: [
        {
          title: "Planejar viagem para palestra em Recife",
          description: "Fechar deslocamento e custos da viagem de dezembro",
          domain: "ops",
          progress: 0.2,
        },
      ],
    },
  });
  const goalAlignedTravelPlan = goalAlignedTravelPlanner.plan(
    "compare preços de passagens aéreas de Porto Alegre para Recife em dezembro",
  );
  results.push({
    name: "travel_search_plan_mentions_aligned_active_goal",
    passed:
      goalAlignedTravelPlan?.objective === "flight_search"
      && goalAlignedTravelPlan.alignedGoals?.includes("Planejar viagem para palestra em Recife")
      && goalAlignedTravelPlan.summary.includes("objetivo ativo"),
    detail: JSON.stringify(goalAlignedTravelPlan, null, 2),
  });

  const goalAlignedWebPlanner = buildPlanner({
    planningContext: {
      goalSummary: "Objetivos: Acompanhar cotação do dólar para revisão de preços",
      activeGoals: [
        {
          title: "Acompanhar cotação do dólar",
          description: "Usar isso para revisar preços e margens",
          domain: "revenue",
          progress: 0.4,
        },
      ],
    },
  });
  const goalAlignedWebPlan = goalAlignedWebPlanner.plan("qual a cotação do dólar hoje?");
  results.push({
    name: "web_research_plan_mentions_aligned_active_goal",
    passed:
      goalAlignedWebPlan?.objective === "recent_information_lookup"
      && goalAlignedWebPlan.alignedGoals?.includes("Acompanhar cotação do dólar")
      && goalAlignedWebPlan.summary.includes("objetivo ativo"),
    detail: JSON.stringify(goalAlignedWebPlan, null, 2),
  });

  const vagueWebPlan = planner.plan("pesquise isso");
  results.push({
    name: "vague_web_request_asks_minimal_user_data",
    passed:
      vagueWebPlan?.objective === "recent_information_lookup"
      && vagueWebPlan.suggestedAction === "ask_user_data"
      && vagueWebPlan.missingUserData.includes("o tema ou termo de busca"),
    detail: JSON.stringify(vagueWebPlan, null, 2),
  });

  const logger = new SilentLogger();
  const sandboxDir = mkdtempSync(path.join(tmpdir(), "atlas-capability-gap-"));
  const store = new PersonalOperationalMemoryStore(path.join(sandboxDir, "personal.sqlite"), logger);
  try {
    const firstGap = store.recordProductGapObservation({
      signature: "travel_cost_estimate::maps.route|maps.distance|maps.tolls::consumo|combustivel",
      type: "travel_estimation_missing",
      description: "quanto vou gastar de Porto Alegre até Torres com meu JAC T40?",
      inferredObjective: "travel_cost_estimate",
      missingCapabilities: ["maps.route", "maps.distance", "maps.tolls"],
      missingRequirementKinds: ["capability"],
      contextSummary: "O pedido depende de rota/distância/pedágio que o Atlas ainda não calcula sozinho neste ambiente.",
      relatedSkill: "planning",
      impact: "high",
    });
    const secondGap = store.recordProductGapObservation({
      signature: "travel_cost_estimate::maps.route|maps.distance|maps.tolls::consumo|combustivel",
      type: "travel_estimation_missing",
      description: "quanto vou gastar de Porto Alegre até Torres com meu JAC T40?",
      inferredObjective: "travel_cost_estimate",
      missingCapabilities: ["maps.route", "maps.distance", "maps.tolls"],
      missingRequirementKinds: ["capability"],
      contextSummary: "O pedido depende de rota/distância/pedágio que o Atlas ainda não calcula sozinho neste ambiente.",
      relatedSkill: "planning",
      impact: "high",
    });

    results.push({
      name: "recurrent_gap_observation_increments_recurrence",
      passed:
        firstGap.id === secondGap.id
        && secondGap.recurrence >= 2,
      detail: JSON.stringify(secondGap, null, 2),
    });
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
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

  console.log(`\nCapability planner evals ok: ${results.length}/${results.length}`);
}

run();
