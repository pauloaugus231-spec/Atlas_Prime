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

export type CapabilityPlannerAction =
  | "continue_normal_flow"
  | "ask_user_data"
  | "handle_gap"
  | "respond_direct"
  | "run_web_search"
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
}

interface TravelRequest {
  objective: "travel_cost_estimate" | "route_distance" | "route_tolls";
  origin?: string;
  destination?: string;
  distanceKm?: number;
  fuelPricePerLiter?: number;
  consumptionKmPerLiter?: number;
  vehicle?: string;
  wantsTolls: boolean;
}

interface WebResearchRequest {
  objective: "recent_information_lookup" | "web_comparison" | "source_validation";
  query: string;
  mode: WebResearchMode;
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
  return extractWebResearchRequest(prompt) !== null;
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

function extractTravelRequest(prompt: string): TravelRequest | null {
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

  const directRouteMatch = prompt.match(/\bde\s+(.+?)\s+(?:ate|até|para)\s+(.+?)(?=(?:\s+com\s+meu|\s+com\s+o\s+meu|\?|$))/i);
  const distanceMatch = prompt.match(/\b(\d+(?:[.,]\d+)?)\s*km\b/i);
  const fuelPriceMatch = prompt.match(/\b(?:gasolina|etanol|diesel|combust[ií]vel)\b.*?(?:r\$?\s*)?(\d+(?:[.,]\d+)?)/i);
  const consumptionMatch = prompt.match(/\b(\d+(?:[.,]\d+)?)\s*(?:km\/l|km por litro)\b/i);
  const vehicleMatch = prompt.match(/\b(?:meu|minha)\s+([a-z0-9][^,.!?]+?)\s*(?=(?:\?|$| com |\s+de\s+.+?(?:ate|até|para)\s+))/i);

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
  const fuelCost = litersNeeded * request.fuelPricePerLiter;
  const lines = [
    `Consigo estimar isso com os dados que você passou.`,
    `Para ${formatNumber(request.distanceKm)} km, o consumo estimado fica em ${formatNumber(litersNeeded)} L e o gasto com combustível em ${formatMoney(fuelCost)}.`,
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
  ) {}

  isCapabilityInspectionPrompt(prompt: string): boolean {
    return looksLikeCapabilityInspectionPrompt(prompt);
  }

  isPlanningCandidate(prompt: string): boolean {
    return looksLikeCapabilityAwareTravelPrompt(prompt) || looksLikeCapabilityAwareWebPrompt(prompt);
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
  ): CapabilityPlan | null {
    const travelRequest = extractTravelRequest(prompt);
    if (travelRequest) {
      const plan = this.planTravelRequest(travelRequest);
      this.logger.info("Capability planner produced travel plan", {
        objective: plan.objective,
        suggestedAction: plan.suggestedAction,
        missingRequirements: plan.missingRequirements.map((item) => item.name),
        missingUserData: plan.missingUserData,
      });
      return plan;
    }

    const webResearchRequest = extractWebResearchRequest(prompt);
    if (webResearchRequest) {
      const plan = this.planWebResearchRequest(webResearchRequest);
      this.logger.info("Capability planner produced web research plan", {
        objective: plan.objective,
        suggestedAction: plan.suggestedAction,
        missingRequirements: plan.missingRequirements.map((item) => item.name),
        missingUserData: plan.missingUserData,
        webQuery: plan.webQuery,
        researchMode: plan.researchMode,
      });
      return plan;
    }

    if (interpreted?.intent === "web_search" || interpreted?.skill === "visual_task") {
      return null;
    }

    return null;
  }

  private planWebResearchRequest(request: WebResearchRequest): CapabilityPlan {
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
      return {
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
      };
    }

    if (missingRequirements.length > 0) {
      return {
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
      };
    }

    return {
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
    };
  }

  private planTravelRequest(request: TravelRequest): CapabilityPlan {
    const requiredCapabilities: string[] = [];
    const availability: CapabilityAvailabilityRecord[] = [];
    const missingRequirements: CapabilityGapRequirement[] = [];
    const missingUserData: string[] = [];

    const directReply = buildTravelDirectReply(request);
    if (directReply) {
      return {
        objective: request.objective,
        summary: "Estimar custo de viagem com dados já fornecidos.",
        confidence: 0.93,
        requiredCapabilities: [],
        availability: [],
        missingRequirements: [],
        missingUserData: [],
        suggestedAction: "respond_direct",
        directReply,
      };
    }

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
    if (missingRequirements.length === 0 && uniqueMissingUserData.length > 0) {
      return {
        objective: request.objective,
        summary: "O Atlas consegue continuar se você informar os dados mínimos que faltam.",
        confidence: 0.86,
        requiredCapabilities,
        availability,
        missingRequirements: [],
        missingUserData: uniqueMissingUserData,
        suggestedAction: "ask_user_data",
      };
    }

    return {
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
    };
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
        availability = mapsStatus.ready ? "available" : "needs_configuration";
        reason = mapsStatus.ready ? "Google Maps/Places pronto para lookup de locais." : mapsStatus.message;
        break;
      case "maps.route":
      case "maps.distance":
      case "maps.tolls":
        availability = "unavailable";
        reason = "A camada de rota/distância/pedágio ainda não foi implementada no Atlas.";
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
