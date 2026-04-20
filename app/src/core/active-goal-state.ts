export type TravelPlanningObjective =
  | "travel_cost_estimate"
  | "route_distance"
  | "route_tolls";

export type PlaceDiscoveryObjective = "place_discovery";
export type PlaceDiscoveryCategory =
  | "restaurant"
  | "hotel"
  | "pharmacy"
  | "hospital"
  | "market"
  | "fuel"
  | "parking"
  | "other";

export interface TravelPlanningGoal {
  kind: "travel_planning";
  objective: TravelPlanningObjective;
  origin?: string;
  destination?: string;
  distanceKm?: number;
  fuelPricePerLiter?: number;
  consumptionKmPerLiter?: number;
  vehicle?: string;
  includeTolls: boolean;
  roundTrip: boolean;
  createdAt: string;
  updatedAt: string;
  lastPrompt: string;
}

export interface PlaceDiscoveryGoal {
  kind: "place_discovery";
  objective: PlaceDiscoveryObjective;
  category: PlaceDiscoveryCategory;
  categoryLabel: string;
  locationQuery?: string;
  createdAt: string;
  updatedAt: string;
  lastPrompt: string;
}

export interface TravelPlanningGoalMergeResult {
  goal: TravelPlanningGoal;
  changedKeys: string[];
  hasMeaningfulUpdate: boolean;
}

export interface PlaceDiscoveryGoalMergeResult {
  goal: PlaceDiscoveryGoal;
  changedKeys: string[];
  hasMeaningfulUpdate: boolean;
}

export type ActivePlanningGoal = TravelPlanningGoal | PlaceDiscoveryGoal;

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const normalized = value.replace(/\./g, "").replace(",", ".").trim();
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function hasAny(source: string, tokens: string[]): boolean {
  return tokens.some((token) => source.includes(token));
}

function cleanLocationValue(value: string | undefined): string | undefined {
  const cleaned = value
    ?.replace(/^(?:em|na|no|perto de|proximo de|próximo de|perto do|perto da)\s+/i, "")
    .replace(/[.?!,;:]+$/g, "")
    .trim();
  return cleaned ? cleaned : undefined;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 1,
  }).format(value);
}

function looksLikeTravelPrompt(text: string): boolean {
  const normalized = normalize(text);
  return hasAny(normalized, [
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
    "gasolina",
    "etanol",
    "diesel",
    "km/l",
  ]);
}

function detectPlaceDiscoveryCategory(normalized: string): {
  category: PlaceDiscoveryCategory;
  label: string;
} | null {
  if (hasAny(normalized, ["restaurante", "restaurantes", "janta", "jantar", "almoco", "almoço", "comida", "pizza", "hamburguer", "hambúrguer", "cafe", "café"])) {
    return { category: "restaurant", label: "restaurantes" };
  }
  if (hasAny(normalized, ["hotel", "hoteis", "hotéis", "pousada", "hospedagem"])) {
    return { category: "hotel", label: "hotéis" };
  }
  if (hasAny(normalized, ["farmacia", "farmácia", "drogaria"])) {
    return { category: "pharmacy", label: "farmácias" };
  }
  if (hasAny(normalized, ["hospital", "upa", "ubs", "posto de saude", "posto de saúde"])) {
    return { category: "hospital", label: "hospitais" };
  }
  if (hasAny(normalized, ["mercado", "supermercado"])) {
    return { category: "market", label: "mercados" };
  }
  if (hasAny(normalized, ["posto de gasolina", "posto", "combustivel", "combustível"])) {
    return { category: "fuel", label: "postos de combustível" };
  }
  if (hasAny(normalized, ["estacionamento", "parking"])) {
    return { category: "parking", label: "estacionamentos" };
  }
  return null;
}

function looksLikePlaceDiscoveryPrompt(text: string): boolean {
  const normalized = normalize(text);
  const category = detectPlaceDiscoveryCategory(normalized);
  if (!category) {
    return false;
  }
  return hasAny(normalized, [
    "perto de mim",
    "perto daqui",
    "proximo de",
    "próximo de",
    "perto do",
    "perto da",
    "na ",
    "no ",
    "em ",
    "onde tem",
    "me mostra",
    "mostra",
    "quais ",
    "qual ",
    "buscar",
    "procure",
    "encontre",
  ]);
}

function extractPlaceDiscoveryLocation(prompt: string): string | undefined {
  const rejectPronouns = (value: string | undefined): string | undefined => {
    const cleaned = cleanLocationValue(value);
    if (!cleaned) {
      return undefined;
    }
    const normalized = normalize(cleaned);
    if (["mim", "aqui", "daqui"].includes(normalized)) {
      return undefined;
    }
    return cleaned;
  };

  const proximityMatch = prompt.match(
    /\b(?:perto de|proximo de|próximo de|perto do|perto da|na|no|em)\s+(.+?)(?=(?:\s+(?:aberto|bons?|baratos?|com|para|que)\b|[.?!,;:]|$))/i,
  );
  if (proximityMatch?.[1]?.trim()) {
    return rejectPronouns(proximityMatch[1]);
  }

  const bareLocationMatch = prompt.match(
    /^(?:na|no|em|perto de|proximo de|próximo de|perto do|perto da)\s+(.+)$/i,
  );
  if (bareLocationMatch?.[1]?.trim()) {
    return rejectPronouns(bareLocationMatch[1]);
  }

  return undefined;
}

function extractTravelObjective(normalized: string): TravelPlanningObjective {
  if (hasAny(normalized, ["pedagio", "pedágio"])) {
    return "route_tolls";
  }
  if (hasAny(normalized, ["quanto vou gastar", "quanto vai gastar", "custo", "gasto", "combustivel", "combustível"])) {
    return "travel_cost_estimate";
  }
  return "route_distance";
}

function extractDirectRoutePair(prompt: string): { origin?: string; destination?: string } {
  const match = prompt.match(
    /\bde\s+(.+?)\s+(?:ate|até|para)\s+(.+?)(?=(?:\s+com\s+(?:meu|o\s+meu|minha|a\s+minha|gasolina|etanol|diesel|combust[ií]vel)\b|[,.!?]|$))/i,
  );
  return {
    origin: match?.[1]?.trim() || undefined,
    destination: match?.[2]?.trim() || undefined,
  };
}

function extractBareRoutePair(prompt: string): { origin?: string; destination?: string } {
  const trimmed = prompt.trim().replace(/[.?!]+$/g, "").trim();
  if (!trimmed || /\d/.test(trimmed)) {
    return {};
  }

  const normalized = normalize(trimmed);
  if (
    looksLikeTravelPrompt(trimmed)
    || hasAny(normalized, ["gasolina", "etanol", "diesel", "km/l", "ida e volta", "rota", "pedagio", "pedágio"])
  ) {
    return {};
  }

  const pairMatch = trimmed.match(/^(.+?)\s+(?:e|até|ate|para)\s+(.+)$/i);
  const origin = pairMatch?.[1]?.trim();
  const destination = pairMatch?.[2]?.trim();
  if (!origin || !destination) {
    return {};
  }

  if (origin.length < 2 || destination.length < 2) {
    return {};
  }

  return { origin, destination };
}

function extractDistanceKm(prompt: string): number | undefined {
  const match = prompt.match(/\b(\d+(?:[.,]\d+)?)\s*km\b(?!\s*\/\s*l)/i);
  return parseNumber(match?.[1]);
}

function extractFuelPricePerLiter(prompt: string): number | undefined {
  const match = prompt.match(/\b(?:gasolina|etanol|diesel|combust[ií]vel)\b.*?(?:r\$?\s*)?(\d+(?:[.,]\d+)?)/i);
  return parseNumber(match?.[1]);
}

function extractConsumptionKmPerLiter(prompt: string): number | undefined {
  const match = prompt.match(/\b(\d+(?:[.,]\d+)?)\s*(?:km\/l|km por litro)\b/i);
  return parseNumber(match?.[1]);
}

function extractVehicle(prompt: string): string | undefined {
  const match = prompt.match(/\b(?:meu|minha)\s+([a-z0-9][^,.!?]+?)\s*(?=(?:\?|$| com |\s+de\s+.+?(?:ate|até|para)\s+))/i);
  return match?.[1]?.trim() || undefined;
}

function extractExplicitRoundTrip(normalized: string): boolean | undefined {
  if (hasAny(normalized, ["ida e volta", "ir e voltar", "ida/volta", "ida volta", "volta tambem", "volta também", "retorno"])) {
    return true;
  }
  if (hasAny(normalized, ["so ida", "só ida", "apenas ida"])) {
    return false;
  }
  return undefined;
}

function extractExplicitTolls(normalized: string): boolean | undefined {
  if (hasAny(normalized, ["sem pedagio", "sem pedágio", "evitar pedagio", "evitar pedágio"])) {
    return false;
  }
  if (hasAny(normalized, ["pedagio", "pedágio"])) {
    return true;
  }
  return undefined;
}

function coalesceString(current: string | undefined, next: string | undefined): string | undefined {
  return next?.trim() ? next.trim() : current;
}

function coalesceNumber(current: number | undefined, next: number | undefined): number | undefined {
  return typeof next === "number" ? next : current;
}

export function isTravelGoalCancellationPrompt(prompt: string): boolean {
  const normalized = normalize(prompt);
  return [
    "deixa isso",
    "deixa",
    "cancela",
    "cancelar",
    "ignora isso",
    "ignora",
    "nao precisa",
    "não precisa",
    "esquece isso",
  ].includes(normalized);
}

export function isActiveGoalCancellationPrompt(prompt: string): boolean {
  return isTravelGoalCancellationPrompt(prompt);
}

export function buildTravelPlanningGoalFromPrompt(
  prompt: string,
  input?: {
    now?: Date;
  },
): TravelPlanningGoal | null {
  if (!looksLikeTravelPrompt(prompt)) {
    return null;
  }

  const normalized = normalize(prompt);
  const directPair = extractDirectRoutePair(prompt);
  const distanceKm = extractDistanceKm(prompt);
  const fuelPricePerLiter = extractFuelPricePerLiter(prompt);
  const consumptionKmPerLiter = extractConsumptionKmPerLiter(prompt);
  const vehicle = extractVehicle(prompt);
  const now = input?.now ?? new Date();
  const timestamp = now.toISOString();

  return {
    kind: "travel_planning",
    objective: extractTravelObjective(normalized),
    origin: directPair.origin,
    destination: directPair.destination,
    distanceKm,
    fuelPricePerLiter,
    consumptionKmPerLiter,
    vehicle,
    includeTolls: extractExplicitTolls(normalized) ?? extractTravelObjective(normalized) === "travel_cost_estimate",
    roundTrip: extractExplicitRoundTrip(normalized) ?? false,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastPrompt: prompt.trim(),
  };
}

export function buildPlaceDiscoveryGoalFromPrompt(
  prompt: string,
  input?: {
    now?: Date;
  },
): PlaceDiscoveryGoal | null {
  if (!looksLikePlaceDiscoveryPrompt(prompt)) {
    return null;
  }

  const normalized = normalize(prompt);
  const category = detectPlaceDiscoveryCategory(normalized);
  if (!category) {
    return null;
  }

  const timestamp = (input?.now ?? new Date()).toISOString();
  const locationQuery = extractPlaceDiscoveryLocation(prompt);

  return {
    kind: "place_discovery",
    objective: "place_discovery",
    category: category.category,
    categoryLabel: category.label,
    locationQuery,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastPrompt: prompt.trim(),
  };
}

export function mergeTravelPlanningGoal(goal: TravelPlanningGoal, prompt: string, input?: {
  now?: Date;
}): TravelPlanningGoalMergeResult {
  const normalized = normalize(prompt);
  const directPair = extractDirectRoutePair(prompt);
  const barePair = !directPair.origin && !directPair.destination ? extractBareRoutePair(prompt) : {};
  const nextOrigin = directPair.origin ?? barePair.origin;
  const nextDestination = directPair.destination ?? barePair.destination;
  const nextDistanceKm = extractDistanceKm(prompt);
  const nextFuelPricePerLiter = extractFuelPricePerLiter(prompt);
  const nextConsumptionKmPerLiter = extractConsumptionKmPerLiter(prompt);
  const nextVehicle = extractVehicle(prompt);
  const nextRoundTrip = extractExplicitRoundTrip(normalized);
  const nextTolls = extractExplicitTolls(normalized);

  const merged: TravelPlanningGoal = {
    ...goal,
    origin: coalesceString(goal.origin, nextOrigin),
    destination: coalesceString(goal.destination, nextDestination),
    distanceKm: coalesceNumber(goal.distanceKm, nextDistanceKm),
    fuelPricePerLiter: coalesceNumber(goal.fuelPricePerLiter, nextFuelPricePerLiter),
    consumptionKmPerLiter: coalesceNumber(goal.consumptionKmPerLiter, nextConsumptionKmPerLiter),
    vehicle: coalesceString(goal.vehicle, nextVehicle),
    includeTolls: typeof nextTolls === "boolean" ? nextTolls : goal.includeTolls,
    roundTrip: typeof nextRoundTrip === "boolean" ? nextRoundTrip : goal.roundTrip,
    updatedAt: (input?.now ?? new Date()).toISOString(),
    lastPrompt: prompt.trim(),
  };

  const changedKeys = [
    merged.origin !== goal.origin ? "origin" : null,
    merged.destination !== goal.destination ? "destination" : null,
    merged.distanceKm !== goal.distanceKm ? "distanceKm" : null,
    merged.fuelPricePerLiter !== goal.fuelPricePerLiter ? "fuelPricePerLiter" : null,
    merged.consumptionKmPerLiter !== goal.consumptionKmPerLiter ? "consumptionKmPerLiter" : null,
    merged.vehicle !== goal.vehicle ? "vehicle" : null,
    merged.includeTolls !== goal.includeTolls ? "includeTolls" : null,
    merged.roundTrip !== goal.roundTrip ? "roundTrip" : null,
  ].filter((item): item is string => Boolean(item));

  const hasMeaningfulUpdate = changedKeys.length > 0;
  return {
    goal: merged,
    changedKeys,
    hasMeaningfulUpdate,
  };
}

export function mergePlaceDiscoveryGoal(goal: PlaceDiscoveryGoal, prompt: string, input?: {
  now?: Date;
}): PlaceDiscoveryGoalMergeResult {
  const normalized = normalize(prompt);
  const category = detectPlaceDiscoveryCategory(normalized);
  const nextLocation = extractPlaceDiscoveryLocation(prompt);
  const merged: PlaceDiscoveryGoal = {
    ...goal,
    category: category?.category ?? goal.category,
    categoryLabel: category?.label ?? goal.categoryLabel,
    locationQuery: cleanLocationValue(nextLocation) ?? goal.locationQuery,
    updatedAt: (input?.now ?? new Date()).toISOString(),
    lastPrompt: prompt.trim(),
  };

  const changedKeys = [
    merged.category !== goal.category ? "category" : null,
    merged.categoryLabel !== goal.categoryLabel ? "categoryLabel" : null,
    merged.locationQuery !== goal.locationQuery ? "locationQuery" : null,
  ].filter((item): item is string => Boolean(item));

  return {
    goal: merged,
    changedKeys,
    hasMeaningfulUpdate: changedKeys.length > 0,
  };
}

export function buildTravelPlanningPrompt(goal: TravelPlanningGoal): string {
  const distanceClause = typeof goal.distanceKm === "number"
    ? `em ${formatNumber(goal.distanceKm)} km`
    : goal.origin && goal.destination
      ? `de ${goal.origin} até ${goal.destination}`
      : "";
  const roundTripClause = goal.roundTrip ? " ida e volta" : "";
  const vehicleClause = goal.vehicle ? ` com meu ${goal.vehicle}` : "";
  const consumptionClause = typeof goal.consumptionKmPerLiter === "number"
    ? ` fazendo ${formatNumber(goal.consumptionKmPerLiter)} km/l`
    : "";
  const fuelClause = typeof goal.fuelPricePerLiter === "number"
    ? ` e gasolina ${formatNumber(goal.fuelPricePerLiter)}`
    : "";

  switch (goal.objective) {
    case "route_tolls":
      return `qual o pedagio${distanceClause ? ` ${distanceClause}` : ""}${roundTripClause}`;
    case "route_distance":
      return `qual a distancia${distanceClause ? ` ${distanceClause}` : ""}${roundTripClause}`;
    case "travel_cost_estimate":
    default:
      return `quanto vou gastar${distanceClause ? ` ${distanceClause}` : ""}${roundTripClause}${vehicleClause}${consumptionClause}${fuelClause}`.trim();
  }
}

export function buildPlaceDiscoveryPrompt(goal: PlaceDiscoveryGoal): string {
  if (goal.locationQuery) {
    return `${goal.categoryLabel} perto de ${goal.locationQuery}`;
  }
  return `${goal.categoryLabel} por perto`;
}

export function describeTravelPlanningGoal(goal: TravelPlanningGoal): string[] {
  const parts: string[] = [];
  if (goal.origin && goal.destination) {
    parts.push(`rota ${goal.origin} → ${goal.destination}`);
  } else if (typeof goal.distanceKm === "number") {
    parts.push(`${formatNumber(goal.distanceKm)} km`);
  }
  if (typeof goal.consumptionKmPerLiter === "number") {
    parts.push(`${formatNumber(goal.consumptionKmPerLiter)} km/l`);
  }
  if (typeof goal.fuelPricePerLiter === "number") {
    parts.push(`combustível ${formatNumber(goal.fuelPricePerLiter)}`);
  }
  if (goal.vehicle) {
    parts.push(goal.vehicle);
  }
  if (goal.roundTrip) {
    parts.push("ida e volta");
  }
  return parts;
}

export function describePlaceDiscoveryGoal(goal: PlaceDiscoveryGoal): string[] {
  const parts = [goal.categoryLabel];
  if (goal.locationQuery) {
    parts.push(`perto de ${goal.locationQuery}`);
  }
  return parts;
}
