import type { AppConfig } from "../types/config.js";
import type {
  CapabilityAvailabilityRecord,
  CapabilityDefinition,
  CapabilityGapRequirement,
} from "../types/capability.js";
import type { ProductGapType } from "../types/product-gaps.js";
import type { Logger } from "../types/logger.js";
import type { ConversationInterpreterResult } from "./conversation-interpreter.js";
import type { CapabilityRegistry } from "./capability-registry.js";
import type { GoogleWorkspaceAccountsService } from "../integrations/google/google-workspace-accounts.js";
import type { GoogleMapsService } from "../integrations/google/google-maps.js";
import type { ExternalReasoningClient } from "../integrations/external-reasoning/external-reasoning-client.js";
import type { WebResearchMode } from "./web-research.js";
import type { ActiveGoal } from "./goal-store.js";

export type CapabilityPlannerAction =
  | "continue_normal_flow"
  | "ask_user_data"
  | "handle_gap"
  | "respond_direct"
  | "run_web_search"
  | "run_maps_route"
  | "run_maps_places_search"
  | "inspect_gaps"
  | "inspect_capabilities";

export interface CapabilityPlan {
  objective: string;
  summary: string;
  confidence: number;
  requiredCapabilities: string[];
  availability: CapabilityAvailabilityRecord[];
  missingRequirements: CapabilityGapRequirement[];
  missingUserData: string[];
  suggestedAction: CapabilityPlannerAction;
  directReply?: string;
  gapType?: ProductGapType;
  shouldLogGap?: boolean;
  webQuery?: string;
  researchMode?: WebResearchMode;
  routeRequest?: {
    origin: string;
    destination: string;
    includeTolls: boolean;
    objective: TravelRequest["objective"];
    roundTrip: boolean;
    fuelPricePerLiter?: number;
    consumptionKmPerLiter?: number;
    vehicle?: string;
  };
  placesRequest?: {
    query: string;
    category: NearbyPlaceRequest["category"];
    categoryLabel: string;
    locationQuery: string;
    maxResults: number;
  };
  alignedGoals?: string[];
  activeGoalSummary?: string;
}

export interface CapabilityPlanningContext {
  activeGoals?: Array<Pick<ActiveGoal, "title" | "description" | "domain" | "deadline" | "progress">>;
  goalSummary?: string;
}

export interface TravelRequest {
  objective: "travel_cost_estimate" | "route_distance" | "route_tolls";
  origin?: string;
  destination?: string;
  distanceKm?: number;
  fuelPricePerLiter?: number;
  consumptionKmPerLiter?: number;
  vehicle?: string;
  wantsTolls: boolean;
  roundTrip: boolean;
}

interface WebResearchRequest {
  objective: "recent_information_lookup" | "web_comparison" | "source_validation";
  query: string;
  mode: WebResearchMode;
}

interface NearbyPlaceRequest {
  objective: "place_discovery";
  category: "restaurant" | "hotel" | "pharmacy" | "hospital" | "market" | "fuel" | "parking";
  categoryLabel: string;
  locationQuery?: string;
}

interface TravelResearchRequest {
  objective: "flight_search" | "bus_search" | "hotel_search";
  query: string;
  mode: WebResearchMode;
  origin?: string;
  destination?: string;
  city?: string;
  periodHint?: string;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(source: string, tokens: string[]): boolean {
  return tokens.some((token) => source.includes(token));
}

const GOAL_CONTEXT_STOPWORDS = new Set([
  "para", "com", "sem", "sobre", "entre", "depois", "antes", "agora", "hoje", "amanha", "amanhã",
  "meu", "minha", "meus", "minhas", "isso", "essa", "esse", "quero", "preciso", "ajuda", "ajudar",
  "objetivo", "objetivos", "meta", "metas", "ativo", "ativos", "uma", "umas", "uns", "esse", "essa",
  "cliente", "clientes", "fechar", "seguir", "fazer", "como", "qual", "quais", "para", "pela", "pelo",
]);

function formatMoney(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatNumber(value: number, digits = 1): string {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function extractGoalContextTokens(value: string | undefined): string[] {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((item) => item.trim())
    .filter((item) => item.length >= 4 && !GOAL_CONTEXT_STOPWORDS.has(item));
}

function appendGoalContextSummary(summary: string, alignedGoals: string[]): string {
  if (alignedGoals.length === 0) {
    return summary;
  }
  return `${summary} Isso conversa com o objetivo ativo: ${alignedGoals.slice(0, 2).join(" | ")}.`;
}

function computeGoalContext(
  prompt: string,
  context?: CapabilityPlanningContext,
): Pick<CapabilityPlan, "alignedGoals" | "activeGoalSummary"> {
  const activeGoals = context?.activeGoals ?? [];
  if (activeGoals.length === 0) {
    return {};
  }

  const promptTokens = new Set(extractGoalContextTokens(prompt));
  const alignedGoals = activeGoals
    .map((goal) => {
      const tokens = new Set([
        ...extractGoalContextTokens(goal.title),
        ...extractGoalContextTokens(goal.description),
      ]);
      const overlap = [...tokens].filter((token) => promptTokens.has(token)).length;
      return {
        goal,
        overlap,
      };
    })
    .filter((item) => item.overlap > 0)
    .sort((left, right) => right.overlap - left.overlap)
    .slice(0, 2)
    .map((item) => item.goal.title);

  return {
    alignedGoals,
    activeGoalSummary: context?.goalSummary,
  };
}

export function looksLikeCapabilityInspectionPrompt(prompt: string): boolean {
  const normalized = normalize(prompt);
  return includesAny(normalized, [
    "o que voce ainda nao consegue fazer",
    "o que você ainda não consegue fazer",
    "quais lacunas voce identificou recentemente",
    "quais lacunas você identificou recentemente",
    "mostre gaps de capability",
    "mostre gaps de capacidade",
    "mostre melhorias sugeridas pelo uso",
    "liste gaps abertos",
    "por que voce nao conseguiu resolver isso",
    "por que você não conseguiu resolver isso",
  ]);
}

export function looksLikeCapabilityAwareTravelPrompt(prompt: string): boolean {
  return extractTravelRequest(prompt) !== null;
}

export function looksLikeCapabilityAwareWebPrompt(prompt: string): boolean {
  return extractWebResearchRequest(prompt) !== null || extractTravelResearchRequest(prompt) !== null;
}

export function looksLikeCapabilityAwarePlacePrompt(prompt: string): boolean {
  return extractNearbyPlaceRequest(prompt) !== null;
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.replace(/\./g, "").replace(",", ".").trim();
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isGenericReferentialQuery(value: string): boolean {
  const normalized = normalize(value);
  return [
    "isso",
    "isso ai",
    "isso aí",
    "essa",
    "esse",
    "ve isso",
    "vê isso",
    "me ajuda com isso",
    "quero que veja isso",
  ].includes(normalized);
}

function inferResearchMode(normalized: string): WebResearchMode {
  if (includesAny(normalized, [
    "profundo",
    "profunda",
    "detalhado",
    "detalhada",
    "completo",
    "completa",
    "aprofunde",
  ])) {
    return "deep";
  }
  if (includesAny(normalized, [
    "rapido",
    "rápido",
    "curto",
    "curta",
    "breve",
    "resumo rapido",
    "resumo rápido",
  ])) {
    return "quick";
  }
  return "executive";
}

function extractWebResearchRequest(prompt: string): WebResearchRequest | null {
  const normalized = normalize(prompt);
  const explicitWebSignal = includesAny(normalized, [
    "pesquise",
    "na internet",
    "com fontes",
    "fontes oficiais",
    "procure",
    "busque",
    "buscar",
    "compare",
    "comparar",
    "valide",
    "confirme",
    "verifique",
    "mais recente",
    "ultimas noticias",
    "últimas notícias",
    "ultimas",
    "últimas",
  ]);
  const freshExternalSignal = includesAny(normalized, [
    "hoje",
    "agora",
    "mais recente",
    "ultimas",
    "últimas",
    "cotacao",
    "cotação",
    "preco",
    "preço",
    "noticia",
    "notícia",
    "noticias",
    "notícias",
    "fonte oficial",
    "fontes oficiais",
  ]);

  if (!explicitWebSignal && !freshExternalSignal) {
    return null;
  }

  const query = prompt
    .replace(/\b(?:pesquise|procure|busque|buscar|encontre|valide|confirme|verifique)\b/gi, "")
    .replace(/\bna internet\b/gi, "")
    .replace(/\bcom fontes\b/gi, "")
    .replace(/\bfontes oficiais\b/gi, "")
    .replace(/\bpor favor\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?-]+$/g, "")
    .trim();

  if (!query) {
    return null;
  }

  const objective = includesAny(normalized, ["compare", "comparar"])
    ? "web_comparison"
    : includesAny(normalized, ["fonte oficial", "fontes oficiais", "valide", "confirme", "verifique"])
      ? "source_validation"
      : "recent_information_lookup";

  return {
    objective,
    query,
    mode: inferResearchMode(normalized),
  };
}

const MONTH_PATTERN = /\b(?:janeiro|fevereiro|marco|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/i;

function extractPeriodHint(prompt: string): string | undefined {
  const monthMatch = prompt.match(MONTH_PATTERN);
  if (monthMatch?.[0]) {
    return monthMatch[0].trim();
  }
  const dateMatch = prompt.match(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/);
  if (dateMatch?.[0]) {
    return dateMatch[0].trim();
  }
  const relativeMatch = prompt.match(/\b(?:hoje|amanha|amanhã|semana que vem|proximo fim de semana|próximo fim de semana|fim de semana|mes que vem|mês que vem)\b/i);
  return relativeMatch?.[0]?.trim();
}

function extractTravelRoutePair(prompt: string): { origin?: string; destination?: string } {
  const directRouteMatch = prompt.match(
    /\bde\s+(.+?)\s+(?:para|ate|até)\s+(.+?)(?=(?:\s+(?:em|no|na)\s+\b(?:janeiro|fevereiro|marco|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b|[,.!?]|$))/i,
  );
  return {
    origin: directRouteMatch?.[1]?.trim(),
    destination: directRouteMatch?.[2]?.trim(),
  };
}

function extractTravelCity(prompt: string): string | undefined {
  const cityMatch = prompt.match(
    /\b(?:em|na|no)\s+(.+?)(?=(?:\s+(?:em|no|na)\s+\b(?:janeiro|fevereiro|marco|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b|[,.!?]|$))/i,
  );
  return cityMatch?.[1]?.trim();
}

function extractTravelResearchRequest(prompt: string): TravelResearchRequest | null {
  const normalized = normalize(prompt);
  const wantsFlights = includesAny(normalized, ["passagem aerea", "passagem aérea", "passagens aereas", "passagens aéreas", "voo", "voos"]);
  const wantsBuses = includesAny(normalized, ["onibus", "ônibus", "rodoviario", "rodoviário", "passagem de onibus", "passagem de ônibus"]);
  const wantsHotels = includesAny(normalized, ["hotel", "hoteis", "hotéis", "hospedagem", "pousada"]);
  if (!wantsFlights && !wantsBuses && !wantsHotels) {
    return null;
  }

  const hasSearchIntent = includesAny(normalized, [
    "compare",
    "comparar",
    "buscar",
    "busque",
    "procure",
    "pesquise",
    "encontre",
    "quero ver",
    "me mostra",
    "mostra",
    "veja",
  ]);
  if (!hasSearchIntent) {
    return null;
  }

  const routePair = extractTravelRoutePair(prompt);
  const periodHint = extractPeriodHint(prompt);
  const city = wantsHotels ? (extractTravelCity(prompt) ?? routePair.destination) : undefined;
  const objective = wantsFlights ? "flight_search" : wantsBuses ? "bus_search" : "hotel_search";

  return {
    objective,
    query: prompt.trim(),
    mode: includesAny(normalized, ["compare", "comparar"]) ? "executive" : inferResearchMode(normalized),
    origin: routePair.origin,
    destination: routePair.destination,
    city,
    periodHint,
  };
}

function extractNearbyPlaceRequest(prompt: string): NearbyPlaceRequest | null {
  const normalized = normalize(prompt);
  const proximityFocusedSignal = includesAny(normalized, [
    "perto de mim",
    "perto daqui",
    "proximo de",
    "próximo de",
    "perto do",
    "perto da",
  ]);
  const category = includesAny(normalized, ["restaurante", "restaurantes", "janta", "jantar", "almoco", "almoço", "comida", "pizza", "hamburguer", "hambúrguer", "cafe", "café"])
    ? { category: "restaurant" as const, categoryLabel: "restaurantes" }
    : includesAny(normalized, ["hotel", "hoteis", "hotéis", "pousada", "hospedagem"])
        ? { category: "hotel" as const, categoryLabel: "hotéis" }
      : includesAny(normalized, ["farmacia", "farmácia", "drogaria"])
        ? { category: "pharmacy" as const, categoryLabel: "farmácias" }
        : includesAny(normalized, ["hospital", "upa", "ubs", "posto de saude", "posto de saúde"])
          ? { category: "hospital" as const, categoryLabel: "hospitais" }
          : includesAny(normalized, ["mercado", "supermercado"])
            ? { category: "market" as const, categoryLabel: "mercados" }
            : includesAny(normalized, ["posto de gasolina", "combustivel", "combustível"])
              ? { category: "fuel" as const, categoryLabel: "postos de combustível" }
              : includesAny(normalized, ["estacionamento", "parking"])
                ? { category: "parking" as const, categoryLabel: "estacionamentos" }
                : null;
  if (!category) {
    return null;
  }
  if (category.category === "hotel" && !proximityFocusedSignal && !includesAny(normalized, ["maps", "google maps"])) {
    return null;
  }

  const hasLocalDiscoverySignal = includesAny(normalized, [
    "perto de mim",
    "perto daqui",
    "proximo de",
    "próximo de",
    "perto do",
    "perto da",
    "na ",
    "no ",
    "em ",
    "me mostra",
    "mostra",
    "onde tem",
    "quais ",
    "qual ",
    "buscar",
    "busque",
    "procure",
    "encontre",
  ]);
  if (!hasLocalDiscoverySignal) {
    return null;
  }

  const locationMatch = prompt.match(
    /\b(?:perto de|proximo de|próximo de|perto do|perto da|na|no|em)\s+(.+?)(?=(?:\s+(?:aberto|bons?|baratos?|com)\b|[.?!,;:]|$))/i,
  );
  const locationQuery = locationMatch?.[1]?.trim();

  return {
    objective: "place_discovery",
    category: category.category,
    categoryLabel: category.categoryLabel,
    locationQuery:
      locationQuery && !includesAny(normalized, ["perto de mim", "perto daqui", "próximo de mim", "proximo de mim"])
        ? locationQuery
        : undefined,
  };
}

export function extractTravelRequest(prompt: string): TravelRequest | null {
  const normalized = normalize(prompt);
  const hasTravelSignal = includesAny(normalized, [
    "quanto vou gastar",
    "quanto vai gastar",
    "quanto custa ir",
    "custo da viagem",
    "gasto de viagem",
    "rota",
    "distancia",
    "distância",
    "pedagio",
    "pedágio",
    "combustivel",
    "combustível",
    "km",
  ]);
  if (!hasTravelSignal) {
    return null;
  }

  const directRouteMatch = prompt.match(
    /\bde\s+(.+?)\s+(?:ate|até|para)\s+(.+?)(?=(?:\s+com\s+(?:meu|o\s+meu|minha|a\s+minha|gasolina|etanol|diesel|combust[ií]vel)\b|[,.!?]|$))/i,
  );
  const distanceMatch = prompt.match(/\b(\d+(?:[.,]\d+)?)\s*km\b(?!\s*\/\s*l)/i);
  const fuelPriceMatch = prompt.match(/\b(?:gasolina|etanol|diesel|combust[ií]vel)\b.*?(?:r\$?\s*)?(\d+(?:[.,]\d+)?)/i);
  const consumptionMatch = prompt.match(/\b(\d+(?:[.,]\d+)?)\s*(?:km\/l|km por litro)\b/i);
  const vehicleMatch = prompt.match(/\b(?:meu|minha)\s+([a-z0-9][^,.!?]+?)\s*(?=(?:\?|$| com |\s+de\s+.+?(?:ate|até|para)\s+))/i);
  const roundTrip = includesAny(normalized, ["ida e volta", "ir e voltar", "ida/volta", "retorno", "volta tambem", "volta também"]);

  const wantsCost = includesAny(normalized, ["quanto vou gastar", "quanto vai gastar", "custo", "gasto"]);
  const wantsTolls = includesAny(normalized, ["pedagio", "pedágio"]);
  const wantsDistance = includesAny(normalized, ["distancia", "distância", "rota", "quanto da", "quantos km"]);

  return {
    objective: wantsCost ? "travel_cost_estimate" : wantsTolls ? "route_tolls" : "route_distance",
    origin: directRouteMatch?.[1]?.trim(),
    destination: directRouteMatch?.[2]?.trim(),
    distanceKm: parseNumber(distanceMatch?.[1]),
    fuelPricePerLiter: parseNumber(fuelPriceMatch?.[1]),
    consumptionKmPerLiter: parseNumber(consumptionMatch?.[1]),
    vehicle: vehicleMatch?.[1]?.trim(),
    wantsTolls: wantsTolls || (wantsCost && !wantsDistance && includesAny(normalized, ["viagem", "rota"])),
    roundTrip,
  };
}

function buildTravelDirectReply(request: TravelRequest): string | undefined {
  if (
    request.objective !== "travel_cost_estimate"
    || !request.distanceKm
    || !request.fuelPricePerLiter
    || !request.consumptionKmPerLiter
  ) {
    return undefined;
  }

  const litersNeeded = request.distanceKm / request.consumptionKmPerLiter;
  const totalLiters = request.roundTrip ? litersNeeded * 2 : litersNeeded;
  const distanceLabel = request.roundTrip
    ? `${formatNumber(request.distanceKm * 2)} km ida e volta`
    : `${formatNumber(request.distanceKm)} km`;
  const fuelCost = totalLiters * request.fuelPricePerLiter;
  const lines = [
    `Consigo estimar isso com os dados que você passou.`,
    `Para ${distanceLabel}, o consumo estimado fica em ${formatNumber(totalLiters)} L e o gasto com combustível em ${formatMoney(fuelCost)}.`,
  ];
  if (request.wantsTolls) {
    lines.push("Esse valor ainda está sem pedágios.");
  }
  lines.push("Se quiser, eu também separo ida e volta ou monto uma margem de segurança.");
  return lines.join(" ");
}

export class CapabilityPlanner {
  constructor(
    private readonly config: AppConfig,
    private readonly capabilityRegistry: CapabilityRegistry,
    private readonly googleWorkspaces: GoogleWorkspaceAccountsService,
    private readonly googleMaps: GoogleMapsService,
    private readonly externalReasoning: ExternalReasoningClient,
    private readonly logger: Logger,
    private readonly getPlanningContext?: () => CapabilityPlanningContext | undefined,
  ) {}

  isCapabilityInspectionPrompt(prompt: string): boolean {
    return looksLikeCapabilityInspectionPrompt(prompt);
  }

  isPlanningCandidate(prompt: string): boolean {
    return looksLikeCapabilityAwareTravelPrompt(prompt)
      || looksLikeCapabilityAwareWebPrompt(prompt)
      || looksLikeCapabilityAwarePlacePrompt(prompt);
  }

  listCapabilityAvailability(): CapabilityAvailabilityRecord[] {
    return this.capabilityRegistry.listCatalogAvailability((capability) => ({
      availability: this.resolveAvailability(capability).availability,
      reason: this.resolveAvailability(capability).reason,
    }));
  }

  plan(
    prompt: string,
    interpreted?: ConversationInterpreterResult,
    context?: CapabilityPlanningContext,
  ): CapabilityPlan | null {
    const planningContext = {
      ...(this.getPlanningContext?.() ?? {}),
      ...(context ?? {}),
    };
    const goalContext = computeGoalContext(prompt, planningContext);

    const travelRequest = extractTravelRequest(prompt);
    if (travelRequest) {
      const plan = this.planTravelRequest(travelRequest, goalContext);
      this.logger.info("Capability planner produced travel plan", {
        objective: plan.objective,
        suggestedAction: plan.suggestedAction,
        missingRequirements: plan.missingRequirements.map((item) => item.name),
        missingUserData: plan.missingUserData,
        alignedGoals: plan.alignedGoals,
      });
      return plan;
    }

    const nearbyPlaceRequest = extractNearbyPlaceRequest(prompt);
    if (nearbyPlaceRequest) {
      const plan = this.planNearbyPlaceRequest(nearbyPlaceRequest, goalContext);
      this.logger.info("Capability planner produced nearby place plan", {
        objective: plan.objective,
        suggestedAction: plan.suggestedAction,
        missingRequirements: plan.missingRequirements.map((item) => item.name),
        missingUserData: plan.missingUserData,
        alignedGoals: plan.alignedGoals,
      });
      return plan;
    }

    const travelResearchRequest = extractTravelResearchRequest(prompt);
    if (travelResearchRequest) {
      const plan = this.planTravelResearchRequest(travelResearchRequest, goalContext);
      this.logger.info("Capability planner produced travel research plan", {
        objective: plan.objective,
        suggestedAction: plan.suggestedAction,
        missingRequirements: plan.missingRequirements.map((item) => item.name),
        missingUserData: plan.missingUserData,
        webQuery: plan.webQuery,
        researchMode: plan.researchMode,
        alignedGoals: plan.alignedGoals,
      });
      return plan;
    }

    const webResearchRequest = extractWebResearchRequest(prompt);
    if (webResearchRequest) {
      const plan = this.planWebResearchRequest(webResearchRequest, goalContext);
      this.logger.info("Capability planner produced web research plan", {
        objective: plan.objective,
        suggestedAction: plan.suggestedAction,
        missingRequirements: plan.missingRequirements.map((item) => item.name),
        missingUserData: plan.missingUserData,
        webQuery: plan.webQuery,
        researchMode: plan.researchMode,
        alignedGoals: plan.alignedGoals,
      });
      return plan;
    }

    if (interpreted?.intent === "web_search" || interpreted?.skill === "visual_task") {
      return null;
    }

    return null;
  }

  private applyGoalContext(
    plan: CapabilityPlan,
    goalContext: Pick<CapabilityPlan, "alignedGoals" | "activeGoalSummary">,
  ): CapabilityPlan {
    const alignedGoals = goalContext.alignedGoals?.filter((item) => item.trim().length > 0) ?? [];
    return {
      ...plan,
      summary: appendGoalContextSummary(plan.summary, alignedGoals),
      confidence: alignedGoals.length > 0
        ? Math.min(0.97, Number((plan.confidence + 0.02).toFixed(2)))
        : plan.confidence,
      ...(alignedGoals.length > 0 ? { alignedGoals } : {}),
      ...(goalContext.activeGoalSummary ? { activeGoalSummary: goalContext.activeGoalSummary } : {}),
    };
  }

  private planNearbyPlaceRequest(
    request: NearbyPlaceRequest,
    goalContext: Pick<CapabilityPlan, "alignedGoals" | "activeGoalSummary">,
  ): CapabilityPlan {
    const availability = [this.resolveAvailabilityByName("maps.places_search")];
    const placesCapability = availability[0];
    const missingRequirements: CapabilityGapRequirement[] = [];
    if (placesCapability.availability !== "available") {
      missingRequirements.push({
        kind: placesCapability.availability === "needs_configuration" ? "configuration" : "capability",
        name: placesCapability.name,
        label: placesCapability.name,
        detail: placesCapability.reason,
      });
    }

    const missingUserData = request.locationQuery ? [] : ["local de referência"];
    if (missingRequirements.length === 0 && missingUserData.length > 0) {
      return this.applyGoalContext({
        objective: request.objective,
        summary: "O Atlas consegue buscar lugares próximos se você disser só o ponto de referência.",
        confidence: 0.83,
        requiredCapabilities: ["maps.places_search"],
        availability,
        missingRequirements: [],
        missingUserData,
        suggestedAction: "ask_user_data",
      }, goalContext);
    }

    if (missingRequirements.length > 0) {
      return this.applyGoalContext({
        objective: request.objective,
        summary: "O pedido depende de busca de lugares no mapa, que ainda não está pronta neste ambiente.",
        confidence: 0.83,
        requiredCapabilities: ["maps.places_search"],
        availability,
        missingRequirements,
        missingUserData,
        suggestedAction: "handle_gap",
        gapType: "places_search_missing",
        shouldLogGap: true,
      }, goalContext);
    }

    return this.applyGoalContext({
      objective: request.objective,
      summary: "O Atlas consegue buscar lugares próximos com Google Maps.",
      confidence: 0.89,
      requiredCapabilities: ["maps.places_search"],
      availability,
      missingRequirements: [],
      missingUserData: [],
      suggestedAction: "run_maps_places_search",
      placesRequest: {
        query: `${request.categoryLabel} perto de ${request.locationQuery}`,
        category: request.category,
        categoryLabel: request.categoryLabel,
        locationQuery: request.locationQuery as string,
        maxResults: 5,
      },
    }, goalContext);
  }

  private planTravelResearchRequest(
    request: TravelResearchRequest,
    goalContext: Pick<CapabilityPlan, "alignedGoals" | "activeGoalSummary">,
  ): CapabilityPlan {
    const availability = [this.resolveAvailabilityByName("web.search")];
    const missingRequirements: CapabilityGapRequirement[] = [];
    const missingUserData: string[] = [];
    const webSearchCapability = availability[0];

    if (webSearchCapability.availability !== "available") {
      missingRequirements.push({
        kind: webSearchCapability.availability === "needs_configuration" ? "configuration" : "capability",
        name: webSearchCapability.name,
        label: webSearchCapability.name,
        detail: webSearchCapability.reason,
      });
    }

    if (request.objective === "hotel_search") {
      if (!request.city) {
        missingUserData.push("cidade ou região da hospedagem");
      }
      if (!request.periodHint) {
        missingUserData.push("período da viagem");
      }
    } else {
      if (!request.origin) {
        missingUserData.push("origem");
      }
      if (!request.destination) {
        missingUserData.push("destino");
      }
      if (!request.periodHint) {
        missingUserData.push("período da viagem");
      }
    }

    if (missingRequirements.length === 0 && missingUserData.length > 0) {
      return this.applyGoalContext({
        objective: request.objective,
        summary: "O Atlas consegue pesquisar isso se você fechar só os dados mínimos da viagem.",
        confidence: 0.8,
        requiredCapabilities: ["web.search"],
        availability,
        missingRequirements: [],
        missingUserData: [...new Set(missingUserData)],
        suggestedAction: "ask_user_data",
        webQuery: request.query,
        researchMode: request.mode,
      }, goalContext);
    }

    if (missingRequirements.length > 0) {
      return this.applyGoalContext({
        objective: request.objective,
        summary: "O pedido depende de pesquisa externa que ainda não está disponível neste ambiente.",
        confidence: 0.82,
        requiredCapabilities: ["web.search"],
        availability,
        missingRequirements,
        missingUserData,
        suggestedAction: "handle_gap",
        gapType: "travel_search_missing",
        shouldLogGap: true,
        webQuery: request.query,
        researchMode: request.mode,
      }, goalContext);
    }

    return this.applyGoalContext({
      objective: request.objective,
      summary: "O Atlas consegue pesquisar essa opção de viagem na web e sintetizar fontes.",
      confidence: 0.87,
      requiredCapabilities: ["web.search"],
      availability,
      missingRequirements: [],
      missingUserData: [],
      suggestedAction: "run_web_search",
      webQuery: request.query,
      researchMode: request.mode,
    }, goalContext);
  }

  private planWebResearchRequest(
    request: WebResearchRequest,
    goalContext: Pick<CapabilityPlan, "alignedGoals" | "activeGoalSummary">,
  ): CapabilityPlan {
    const availability = [this.resolveAvailabilityByName("web.search")];
    const webSearchCapability = availability[0];
    const missingRequirements: CapabilityGapRequirement[] = [];
    const missingUserData: string[] = [];

    if (isGenericReferentialQuery(request.query)) {
      missingUserData.push("o tema ou termo de busca");
    }

    if (webSearchCapability.availability !== "available") {
      missingRequirements.push({
        kind: webSearchCapability.availability === "needs_configuration" ? "configuration" : "capability",
        name: webSearchCapability.name,
        label: webSearchCapability.name,
        detail: webSearchCapability.reason,
      });
    }

    if (missingRequirements.length === 0 && missingUserData.length > 0) {
      return this.applyGoalContext({
        objective: request.objective,
        summary: "O Atlas consegue pesquisar isso se você disser só o tema exato.",
        confidence: 0.74,
        requiredCapabilities: ["web.search"],
        availability,
        missingRequirements: [],
        missingUserData,
        suggestedAction: "ask_user_data",
        webQuery: request.query,
        researchMode: request.mode,
      }, goalContext);
    }

    if (missingRequirements.length > 0) {
      return this.applyGoalContext({
        objective: request.objective,
        summary: "O pedido depende de busca web que ainda não está disponível neste ambiente.",
        confidence: 0.82,
        requiredCapabilities: ["web.search"],
        availability,
        missingRequirements,
        missingUserData,
        suggestedAction: "handle_gap",
        gapType: "web_search_missing",
        shouldLogGap: true,
        webQuery: request.query,
        researchMode: request.mode,
      }, goalContext);
    }

    return this.applyGoalContext({
      objective: request.objective,
      summary: "Há informação externa ou recente para buscar com fontes.",
      confidence: 0.88,
      requiredCapabilities: ["web.search"],
      availability,
      missingRequirements: [],
      missingUserData: [],
      suggestedAction: "run_web_search",
      webQuery: request.query,
      researchMode: request.mode,
    }, goalContext);
  }

  private planTravelRequest(
    request: TravelRequest,
    goalContext: Pick<CapabilityPlan, "alignedGoals" | "activeGoalSummary">,
  ): CapabilityPlan {
    const requiredCapabilities: string[] = [];
    const availability: CapabilityAvailabilityRecord[] = [];
    const missingRequirements: CapabilityGapRequirement[] = [];
    const missingUserData: string[] = [];

    const needsRouteData = !request.distanceKm;
    if (needsRouteData) {
      requiredCapabilities.push("maps.route", "maps.distance");
      if (request.wantsTolls || request.objective === "travel_cost_estimate") {
        requiredCapabilities.push("maps.tolls");
      }
    }

    for (const capabilityName of requiredCapabilities) {
      const record = this.resolveAvailabilityByName(capabilityName);
      availability.push(record);
      if (record.availability !== "available") {
        missingRequirements.push({
          kind: record.availability === "needs_configuration" ? "configuration" : "capability",
          name: record.name,
          label: record.name,
          detail: record.reason,
        });
      }
    }

    if (request.objective === "travel_cost_estimate") {
      if (!request.distanceKm && (!request.origin || !request.destination)) {
        missingUserData.push("origem", "destino");
      }
      if (!request.distanceKm && request.origin && request.destination) {
        // capability gap already covers route distance
      }
      if (!request.consumptionKmPerLiter) {
        missingUserData.push("consumo médio do carro em km/l");
      }
      if (!request.fuelPricePerLiter) {
        missingUserData.push("preço do combustível por litro");
      }
    } else if (!request.origin || !request.destination) {
      missingUserData.push("origem", "destino");
    }

    const uniqueMissingUserData = [...new Set(missingUserData)];
    const routeCapabilitiesReady =
      requiredCapabilities.length > 0
      && availability.length > 0
      && availability.every((item) => item.availability === "available");

    const directReply = buildTravelDirectReply(request);
    const shouldPreferRouteExecution =
      Boolean(request.origin && request.destination)
      && (
        routeCapabilitiesReady
        || requiredCapabilities.length === 0
      );

    if (directReply && !shouldPreferRouteExecution) {
      return this.applyGoalContext({
        objective: request.objective,
        summary: "Estimar custo de viagem com dados já fornecidos.",
        confidence: 0.93,
        requiredCapabilities: [],
        availability: [],
        missingRequirements: [],
        missingUserData: [],
        suggestedAction: "respond_direct",
        directReply,
      }, goalContext);
    }

    if (request.origin && request.destination && routeCapabilitiesReady) {
      if (request.objective === "travel_cost_estimate" && uniqueMissingUserData.length > 0) {
        return this.applyGoalContext({
          objective: request.objective,
          summary: "O Atlas consegue fechar o custo real se você informar os dados mínimos do veículo e do combustível.",
          confidence: 0.9,
          requiredCapabilities,
          availability,
          missingRequirements: [],
          missingUserData: uniqueMissingUserData,
          suggestedAction: "ask_user_data",
          routeRequest: {
            origin: request.origin,
            destination: request.destination,
            includeTolls: true,
            objective: request.objective,
            roundTrip: request.roundTrip,
            fuelPricePerLiter: request.fuelPricePerLiter,
            consumptionKmPerLiter: request.consumptionKmPerLiter,
            vehicle: request.vehicle,
          },
        }, goalContext);
      }

      return this.applyGoalContext({
        objective: request.objective,
        summary: "O Atlas consegue buscar a rota real e montar a resposta.",
        confidence: 0.91,
        requiredCapabilities,
        availability,
        missingRequirements: [],
        missingUserData: [],
        suggestedAction: "run_maps_route",
        routeRequest: {
          origin: request.origin,
          destination: request.destination,
          includeTolls: request.wantsTolls || request.objective === "travel_cost_estimate",
          objective: request.objective,
          roundTrip: request.roundTrip,
          fuelPricePerLiter: request.fuelPricePerLiter,
          consumptionKmPerLiter: request.consumptionKmPerLiter,
          vehicle: request.vehicle,
        },
      }, goalContext);
    }

    if (missingRequirements.length === 0 && uniqueMissingUserData.length > 0) {
      return this.applyGoalContext({
        objective: request.objective,
        summary: "O Atlas consegue continuar se você informar os dados mínimos que faltam.",
        confidence: 0.86,
        requiredCapabilities,
        availability,
        missingRequirements: [],
        missingUserData: uniqueMissingUserData,
        suggestedAction: "ask_user_data",
      }, goalContext);
    }

    return this.applyGoalContext({
      objective: request.objective,
      summary: "O pedido depende de rota/distância/pedágio que o Atlas ainda não calcula sozinho neste ambiente.",
      confidence: 0.84,
      requiredCapabilities,
      availability,
      missingRequirements,
      missingUserData: uniqueMissingUserData,
      suggestedAction: "handle_gap",
      gapType:
        request.objective === "travel_cost_estimate"
          ? "travel_estimation_missing"
          : "maps_required",
      shouldLogGap: missingRequirements.length > 0,
    }, goalContext);
  }

  private resolveAvailabilityByName(name: string): CapabilityAvailabilityRecord {
    const capability = this.capabilityRegistry.getCapability(name) ?? {
      name,
      domain: "orchestrator",
      description: name,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      risk: "low",
      sideEffects: ["read"],
      requiresApproval: false,
      category: "other",
      declaredOnly: true,
    };
    return this.resolveAvailability(capability);
  }

  private resolveAvailability(capability: CapabilityDefinition): CapabilityAvailabilityRecord {
    const anyGoogleReady = this.googleWorkspaces.getAliases().some((alias) =>
      this.googleWorkspaces.getWorkspace(alias).getStatus().ready
    );
    const anyGoogleWriteReady = this.googleWorkspaces.getAliases().some((alias) =>
      this.googleWorkspaces.getWorkspace(alias).getStatus().writeReady === true
    );
    const mapsStatus = this.googleMaps.getStatus();

    let availability: CapabilityAvailabilityRecord["availability"] = "available";
    let reason = "Capability disponível.";

    switch (capability.name) {
      case "calendar.read":
      case "tasks.read":
        availability = anyGoogleReady ? "available" : "needs_configuration";
        reason = anyGoogleReady
          ? "Há pelo menos uma conta Google pronta para leitura."
          : "Google Workspace ainda não está pronto neste ambiente.";
        break;
      case "calendar.write":
      case "tasks.write":
        availability = anyGoogleWriteReady
          ? "available"
          : anyGoogleReady
            ? "partial"
            : "needs_configuration";
        reason = anyGoogleWriteReady
          ? "Há pelo menos uma conta Google pronta para escrita controlada."
          : anyGoogleReady
            ? "Google está ativo, mas ainda sem escopos de escrita."
            : "Google Workspace ainda não está pronto neste ambiente.";
        break;
      case "weather.lookup":
        availability = "available";
        reason = "Consulta de clima direta disponível.";
        break;
      case "web.search":
        availability = "available";
        reason = "Pesquisa web direta disponível.";
        break;
      case "maps.geocode":
      case "maps.places_search":
        availability = mapsStatus.ready ? "available" : "needs_configuration";
        reason = mapsStatus.ready ? "Google Maps/Places pronto para lookup e busca de lugares." : mapsStatus.message;
        break;
      case "maps.route":
      case "maps.distance":
      case "maps.tolls":
        availability = mapsStatus.ready ? "available" : "needs_configuration";
        reason = mapsStatus.ready
          ? "Google Routes está pronto para rota, distância e pedágio estimado."
          : mapsStatus.message;
        break;
      case "messaging.monitor":
        availability = this.config.whatsapp.sidecarEnabled ? "available" : "needs_configuration";
        reason = this.config.whatsapp.sidecarEnabled
          ? "Monitoramento de WhatsApp institucional ativo."
          : "O monitoramento de WhatsApp depende do sidecar habilitado.";
        break;
      case "messaging.reply_draft":
        availability = this.config.whatsapp.enabled ? "available" : "needs_configuration";
        reason = this.config.whatsapp.enabled
          ? "Rascunho de resposta para WhatsApp está disponível."
          : "WhatsApp ainda não está habilitado neste ambiente.";
        break;
      case "visual.schedule_import":
        availability = this.config.llm.openai?.apiKey || (this.config.llm.provider === "openai" && this.config.llm.apiKey)
          ? "available"
          : "partial";
        reason = availability === "available"
          ? "Importação visual de agenda está pronta."
          : "O fluxo visual existe, mas a extração estruturada depende de OpenAI configurada.";
        break;
      case "visual.profile_analysis":
        availability = "partial";
        reason = "Há fluxo visual guiado, mas a análise de perfil ainda é parcial.";
        break;
      case "travel.flights":
      case "travel.buses":
      case "travel.hotels":
        availability = "partial";
        reason = "Hoje o Atlas pesquisa isso via web search, sem integração dedicada de reserva/marketplace.";
        break;
      case "identity.read":
      case "memory.learned_preferences.read":
      case "memory.learned_preferences.write":
        availability = "available";
        reason = "Memória e identidade operacional estão disponíveis.";
        break;
      default:
        availability = this.capabilityRegistry.hasCapability(capability.name) ? "available" : "unavailable";
        reason = availability === "available"
          ? "Capability executável registrada."
          : "Capability ainda não implementada.";
        break;
    }

    return {
      name: capability.name,
      description: capability.description,
      domain: capability.domain,
      category: capability.category ?? capability.domain,
      availability,
      reason,
      requiresApproval: capability.requiresApproval,
      experimental: capability.experimental === true,
      integrationKey: capability.integrationKey,
      declaredOnly: capability.declaredOnly === true,
    };
  }
}
