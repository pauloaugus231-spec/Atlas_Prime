import { normalizeEmailAnalysisText } from "../integrations/email/email-analysis.js";
import type { GooglePlaceLookupResult, GoogleRouteLookupResult } from "../integrations/google/google-maps.js";
import type { UserPreferences } from "../types/user-preferences.js";
import type {
  PersonalOperationalMemoryItem,
  PersonalOperationalMemoryItemKind,
  PersonalOperationalProfile,
} from "../types/personal-operational-memory.js";
import type { OperationalState } from "../types/operational-state.js";
import type { LearnedPreference } from "../types/learned-preferences.js";
import type { ProductGapRecord } from "../types/product-gaps.js";
import type { CapabilityAvailabilityRecord } from "../types/capability.js";
import type { CapabilityPlan } from "./capability-planner.js";
import type {
  ContactPersona,
  ContactProfileRecord,
  ContactRelationship,
  UpsertContactProfileInput,
} from "../types/contact-intelligence.js";
import type { MemoryEntityKind, MemoryEntityRecord } from "../types/memory-entities.js";
import { labelAgendaScope, truncateBriefText } from "./calendar-email-brief-helpers.js";

function includesAny(source: string, tokens: string[]): boolean {
  return tokens.some((token) => source.includes(token));
}

export function buildPlaceLookupReply(result: GooglePlaceLookupResult): string {
  const lines = [
    `Local encontrado: ${result.name ?? result.formattedAddress}.`,
    `Endereço: ${result.formattedAddress}.`,
  ];
  if (result.mapsUrl) {
    lines.push(`Maps: ${result.mapsUrl}`);
  }
  lines.push("Se quiser, eu adiciono isso ao seu calendário ou salvo como referência.");
  return lines.join("\n");
}

export function buildPlaceDiscoveryReply(input: {
  categoryLabel: string;
  locationQuery: string;
  results: GooglePlaceLookupResult[];
}): string {
  if (input.results.length === 0) {
    return `Não encontrei ${input.categoryLabel} com segurança perto de ${input.locationQuery}. Se quiser, me diga outro ponto de referência ou bairro.`;
  }

  return [
    `Encontrei ${input.results.length} opção(ões) de ${input.categoryLabel} perto de ${input.locationQuery}.`,
    ...input.results.slice(0, 4).map((item, index) => {
      const label = item.name ?? item.shortFormattedAddress ?? item.formattedAddress;
      const address = item.shortFormattedAddress ?? item.formattedAddress;
      return `${index + 1}. ${label} — ${address}${item.mapsUrl ? ` | Maps: ${item.mapsUrl}` : ""}`;
    }),
    "Se quiser, eu comparo melhor essas opções ou uso uma delas no teu calendário/roteiro.",
  ].join("\n");
}

export function buildUserPreferencesReply(preferences: UserPreferences): string {
  return [
    "Preferências ativas:",
    `- Estilo: ${preferences.responseStyle}`,
    `- Tamanho: ${preferences.responseLength}`,
    `- Próxima ação sugerida: ${preferences.proactiveNextStep ? "sim" : "não"}`,
    `- Fallback automático de fontes: ${preferences.autoSourceFallback ? "sim" : "não"}`,
    `- Nome do agente: ${preferences.preferredAgentName}`,
  ].join("\n");
}

export function buildPersonalOperationalProfileReply(profile: PersonalOperationalProfile): string {
  return [
    "Perfil operacional base:",
    `- Nome: ${profile.displayName}`,
    `- Papel principal: ${profile.primaryRole}`,
    `- Fuso: ${profile.timezone}`,
    `- Canais preferidos: ${profile.preferredChannels.join(" | ")}`,
    `- Canal preferido de alerta: ${profile.preferredAlertChannel ?? "não definido"}`,
    `- Endereço base: ${profile.homeAddress ? `${profile.homeLocationLabel ?? "casa"} salvo` : "não definido"}`,
    `- Veículo padrão: ${profile.defaultVehicle?.name ?? "não definido"}${profile.defaultVehicle?.consumptionKmPerLiter ? ` | ${profile.defaultVehicle.consumptionKmPerLiter.toFixed(1).replace(".", ",")} km/l` : ""}${profile.defaultVehicle?.fuelType ? ` | ${profile.defaultVehicle.fuelType}` : ""}`,
    `- Preço combustível padrão: ${profile.defaultFuelPricePerLiter ? `R$ ${profile.defaultFuelPricePerLiter.toFixed(2).replace(".", ",")}/l` : "não definido"}`,
    `- Estilo de resposta: ${profile.responseStyle}`,
    `- Briefing da manhã: ${profile.briefingPreference}`,
    `- Nível de detalhe: ${profile.detailLevel}`,
    `- Tom: ${profile.tonePreference}`,
    `- Modo padrão: ${profile.defaultOperationalMode === "field" ? "plantão/rua" : "normal"}`,
    `- Escopo padrão de agenda: ${labelAgendaScope(profile.defaultAgendaScope)}`,
    `- Áreas prioritárias: ${profile.priorityAreas.length > 0 ? profile.priorityAreas.slice(0, 3).join(" | ") : "não definidas"}`,
    `- Rotina principal: ${profile.routineSummary.length > 0 ? profile.routineSummary.slice(0, 3).join(" | ") : "não definida"}`,
    `- Deslocamento: ${profile.mobilityPreferences.length > 0 ? profile.mobilityPreferences.slice(0, 3).join(" | ") : "nenhuma preferência extra"}`,
    `- Itens físicos: ${profile.attire.carryItems.join(" | ")}`,
    `- Regras fixas: ${profile.operationalRules.slice(0, 3).join(" | ")}`,
    `- Autonomia: ${profile.autonomyPreferences.slice(0, 3).join(" | ")}`,
  ].join("\n");
}

export function buildPersonalOperationalProfileUpdatedReply(
  profile: PersonalOperationalProfile,
  changeLabels: string[],
): string {
  return [
    "Perfil operacional atualizado.",
    ...changeLabels.slice(0, 6).map((item) => `- ${item}`),
    "",
    buildPersonalOperationalProfileReply(profile),
  ].join("\n");
}

export function buildPersonalOperationalProfileRemovedReply(
  profile: PersonalOperationalProfile,
  removedLabels: string[],
): string {
  return [
    "Perfil operacional ajustado.",
    ...removedLabels.map((item) => `- Removido: ${item}`),
    "",
    buildPersonalOperationalProfileReply(profile),
  ].join("\n");
}

export function buildOperationalStateReply(state: OperationalState): string {
  const formatStateCommitment = (item: OperationalState["upcomingCommitments"][number]) =>
    item.start
      ? `${truncateBriefText(item.summary, 70)} (${stateDateTimeLabel(item.start) ?? item.start})`
      : truncateBriefText(item.summary, 70);
  const activeSignals = state.signals.filter((item) => item.active);

  return [
    "Estado operacional atual:",
    `- Modo: ${state.mode === "field" ? "plantão/rua" : "normal"}${state.modeReason ? ` | motivo: ${state.modeReason}` : ""}`,
    `- Foco atual: ${state.focus.length > 0 ? state.focus.slice(0, 3).join(" | ") : "nenhum foco explícito"}`,
    `- Prioridades da semana: ${state.weeklyPriorities.length > 0 ? state.weeklyPriorities.slice(0, 3).join(" | ") : "não definidas"}`,
    `- Alertas pendentes: ${state.pendingAlerts.length > 0 ? state.pendingAlerts.slice(0, 3).join(" | ") : "nenhum alerta pendente"}`,
    `- Tarefas críticas: ${state.criticalTasks.length > 0 ? state.criticalTasks.slice(0, 3).join(" | ") : "nenhuma tarefa crítica"}`,
    `- Próximos compromissos: ${state.upcomingCommitments.length > 0 ? state.upcomingCommitments.slice(0, 3).map((item) => formatStateCommitment(item)).join(" | ") : "nenhum compromisso marcado"}`,
    `- Risco principal: ${state.primaryRisk ?? "nenhum risco destacado"}`,
    `- Sinais operacionais: ${activeSignals.length > 0 ? activeSignals.slice(0, 3).map((item) => `${item.summary} (${item.priority})`).join(" | ") : "nenhum sinal ativo"}`,
    `- Briefing: ${state.briefing.nextAction ?? "sem próxima ação"}${state.briefing.overloadLevel ? ` | carga ${state.briefing.overloadLevel}` : ""}`,
    `- Canal atual: ${state.activeChannel ?? "não registrado"}`,
    `- Canal preferido de alerta: ${state.preferredAlertChannel ?? "não registrado"}`,
    `- Aprovações pendentes: ${state.pendingApprovals}`,
    `- Atualizado em: ${state.updatedAt}`,
  ].join("\n");
}

export function stateDateTimeLabel(value: string): string | undefined {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatLearnedPreferenceTypeLabel(type: LearnedPreference["type"]): string {
  switch (type) {
    case "schedule_import_mode":
      return "Importação de agenda";
    case "agenda_scope":
      return "Escopo de agenda";
    case "response_style":
      return "Estilo de resposta";
    case "channel_preference":
      return "Canal";
    case "calendar_interpretation":
      return "Interpretação de agenda";
    case "visual_task":
      return "Tarefa visual";
    case "alert_action":
      return "Ação de alerta";
    case "other":
    default:
      return "Aprendizado";
  }
}

export function buildLearnedPreferencesReply(items: LearnedPreference[]): string {
  if (items.length === 0) {
    return "Ainda não encontrei aprendizados operacionais ativos sobre você.";
  }

  return [
    `Aprendizados operacionais ativos: ${items.length}.`,
    ...items.slice(0, 10).map((item) =>
      `- #${item.id} | ${formatLearnedPreferenceTypeLabel(item.type)} | ${item.description} => ${item.value} | confiança ${Math.round(item.confidence * 100)}% | confirmações ${item.confirmations}`,
    ),
  ].join("\n");
}

export function buildLearnedPreferenceDeactivatedReply(item: LearnedPreference): string {
  return [
    "Preferência aprendida desativada.",
    `- #${item.id} | ${formatLearnedPreferenceTypeLabel(item.type)} | ${item.description} => ${item.value}`,
  ].join("\n");
}

export function buildCapabilityGapSignature(plan: CapabilityPlan): string {
  const missingCapabilities = [...new Set(plan.missingRequirements
    .filter((item) => item.kind !== "user_data")
    .map((item) => item.name))]
    .sort();
  const missingUserData = [...new Set(plan.missingUserData)].sort();

  return [
    plan.objective,
    missingCapabilities.join("|") || "no_capability_gap",
    missingUserData.join("|") || "no_user_data_gap",
  ].join("::");
}

export function formatCapabilityObjectiveLabel(objective: CapabilityPlan["objective"]): string {
  switch (objective) {
    case "travel_cost_estimate":
      return "estimar o custo da viagem";
    case "route_distance":
      return "calcular a distância da rota";
    case "route_tolls":
      return "estimar pedágios da rota";
    case "place_discovery":
      return "buscar lugares próximos";
    case "flight_search":
      return "pesquisar passagens aéreas";
    case "bus_search":
      return "pesquisar passagens de ônibus";
    case "hotel_search":
      return "pesquisar hospedagem";
    case "recent_information_lookup":
      return "buscar informação recente na web";
    case "web_comparison":
      return "comparar isso com fontes na web";
    case "source_validation":
      return "validar isso em fontes externas";
    default:
      return objective.replace(/_/g, " ");
  }
}

export function formatDurationMinutes(seconds: number): string {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) {
    return `${hours}h${String(minutes).padStart(2, "0")}`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${minutes} min`;
}

export function formatKilometers(distanceMeters: number): string {
  const km = distanceMeters / 1000;
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: km >= 100 ? 0 : 1,
    maximumFractionDigits: km >= 100 ? 0 : 1,
  }).format(km);
}

export function formatMoneyAmount(currencyCode: string, amount: number): string {
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currencyCode}`;
  }
}

export function buildCapabilityAvailabilityReply(items: CapabilityAvailabilityRecord[]): string {
  const relevant = items
    .filter((item) => item.availability !== "available")
    .slice(0, 12);

  if (relevant.length === 0) {
    return "Hoje eu não tenho lacunas abertas de capability que valham destaque. O que já está ligado no Atlas está disponível.";
  }

  return [
    "Hoje estas capabilities ainda estão faltando ou parciais no Atlas:",
    ...relevant.map((item) =>
      `- ${item.name} | ${item.availability} | ${item.reason}`,
    ),
  ].join("\n");
}

export function buildProductGapsReply(items: ProductGapRecord[]): string {
  if (items.length === 0) {
    return "Não encontrei gaps de capability recentes registrados pelo uso.";
  }

  return [
    `Gaps recentes identificados pelo uso: ${items.length}.`,
    ...items.slice(0, 10).map((item) => {
      const missing = item.missingCapabilities.length > 0
        ? item.missingCapabilities.join(" | ")
        : "sem capability nomeada";
      return `- #${item.id} | ${item.inferredObjective} | faltou: ${missing} | recorrência ${item.recurrence} | status ${item.status}`;
    }),
  ].join("\n");
}

export function buildCapabilityPlanUserDataReply(plan: CapabilityPlan): string {
  const fields = plan.missingUserData.join(" e ");
  const goalLine = plan.alignedGoals?.[0]
    ? ` Isso conversa com teu objetivo ativo: ${plan.alignedGoals[0]}.`
    : "";
  switch (plan.objective) {
    case "travel_cost_estimate":
      return `Consigo seguir com essa estimativa. Me passe só ${fields}.${goalLine}`;
    case "route_distance":
    case "route_tolls":
      return `Consigo calcular isso. Só preciso de ${fields}.${goalLine}`;
    case "place_discovery":
      return `Consigo buscar isso no mapa. Me passe só ${fields}.${goalLine}`;
    case "flight_search":
    case "bus_search":
    case "hotel_search":
      return `Consigo pesquisar isso. Me passe só ${fields}.${goalLine}`;
    default:
      return `Consigo seguir com isso. Me passe só ${fields}.${goalLine}`;
  }
}

export function buildCapabilityGapReply(plan: CapabilityPlan, gap?: ProductGapRecord): string {
  const missingCapabilities = [...new Set(plan.missingRequirements
    .filter((item) => item.kind !== "user_data")
    .map((item) => item.label))];
  const missingData = [...new Set(plan.missingUserData)];
  const lines = [
    `Entendi que você quer ${formatCapabilityObjectiveLabel(plan.objective)}.`,
  ];

  if (plan.alignedGoals?.[0]) {
    lines.push(`Isso impacta diretamente o objetivo ativo: ${plan.alignedGoals[0]}.`);
  }

  if (missingCapabilities.length > 0) {
    lines.push(
      `Hoje eu ainda não consigo fechar isso sozinho no Atlas porque me faltam ${missingCapabilities.join(", ")}.`,
    );
  }

  if (missingData.length > 0) {
    lines.push(
      `Se você quiser seguir agora mesmo, me passe só: ${missingData.join(" e ")}.`,
    );
  } else {
    lines.push("Se quiser, eu sigo com o melhor caminho alternativo com os dados que você tiver.");
  }

  if (gap) {
    lines.push(`Deixei isso registrado como lacuna real do Atlas (#${gap.id}) para priorizar depois.`);
  }

  return lines.join(" ");
}

export function buildProductGapDetailReply(item: ProductGapRecord): string {
  const missing = item.missingCapabilities.length > 0
    ? item.missingCapabilities.join(", ")
    : "uma capability ainda não implementada";
  const lines = [
    `No caso mais recente, eu não consegui fechar isso sozinho porque me faltaram ${missing}.`,
    `Objetivo que eu inferi: ${item.inferredObjective}.`,
  ];

  if (item.contextSummary) {
    lines.push(item.contextSummary);
  }

  if (item.recurrence > 1) {
    lines.push(`Isso já apareceu ${item.recurrence} vezes no uso real.`);
  }

  return lines.join(" ");
}

export function buildMapsRouteReply(input: {
  objective: CapabilityPlan["objective"];
  route: GoogleRouteLookupResult;
  roundTrip?: boolean;
  fuelPricePerLiter?: number;
  consumptionKmPerLiter?: number;
  alignedGoal?: string;
}): string {
  const lines: string[] = [];
  const multiplier = input.roundTrip ? 2 : 1;
  const baseDistanceKm = input.route.distanceMeters / 1000;
  const effectiveDistanceMeters = input.route.distanceMeters * multiplier;
  const effectiveDurationSeconds = input.route.durationSeconds * multiplier;
  const distanceLabel = input.roundTrip
    ? `${formatKilometers(effectiveDistanceMeters)} km ida e volta`
    : input.route.localizedDistanceText?.trim() || `${formatKilometers(input.route.distanceMeters)} km`;
  const durationLabel = input.roundTrip
    ? `${formatDurationMinutes(effectiveDurationSeconds)} no total`
    : input.route.localizedDurationText?.trim() || formatDurationMinutes(input.route.durationSeconds);
  const routeLabel = input.roundTrip ? "ida" : "rota";

  if (input.objective === "route_distance") {
    lines.push(
      `A ${routeLabel} entre ${input.route.origin.formattedAddress} e ${input.route.destination.formattedAddress} fica em ${distanceLabel} e leva perto de ${durationLabel}.`,
    );
  } else if (input.objective === "route_tolls") {
    if (!input.route.hasTolls) {
      lines.push(
        `Na ${routeLabel} entre ${input.route.origin.formattedAddress} e ${input.route.destination.formattedAddress}, não encontrei pedágios esperados.`,
      );
    } else if (input.route.tollPriceKnown && input.route.tolls && input.route.tolls.length > 0) {
      const tollSummary = input.route.tolls
        .map((item) => formatMoneyAmount(item.currencyCode, item.amount * multiplier))
        .join(" | ");
      lines.push(
        `Na ${routeLabel} entre ${input.route.origin.formattedAddress} e ${input.route.destination.formattedAddress}, o pedágio estimado fica em ${tollSummary}.`,
      );
    } else {
      lines.push(
        `A ${routeLabel} entre ${input.route.origin.formattedAddress} e ${input.route.destination.formattedAddress} parece ter pedágio, mas o valor estimado não veio dessa consulta.`,
      );
    }
    lines.push(`Distância: ${distanceLabel}. Tempo estimado: ${durationLabel}.`);
  } else {
    lines.push(
      `A ${routeLabel} entre ${input.route.origin.formattedAddress} e ${input.route.destination.formattedAddress} fica em ${distanceLabel} e leva perto de ${durationLabel}.`,
    );

    if (
      typeof input.fuelPricePerLiter === "number"
      && typeof input.consumptionKmPerLiter === "number"
      && input.consumptionKmPerLiter > 0
    ) {
      const distanceKm = baseDistanceKm * multiplier;
      const litersNeeded = distanceKm / input.consumptionKmPerLiter;
      const fuelCost = litersNeeded * input.fuelPricePerLiter;
      lines.push(
        `Com consumo médio de ${input.consumptionKmPerLiter.toFixed(1).replace(".", ",")} km/l e combustível a ${formatMoneyAmount("BRL", input.fuelPricePerLiter)}, o gasto estimado com combustível fica em ${formatMoneyAmount("BRL", fuelCost)}.`,
      );

      if (input.route.hasTolls) {
        if (input.route.tollPriceKnown && input.route.tolls && input.route.tolls.length > 0) {
          const brlToll = input.route.tolls.find((item) => item.currencyCode === "BRL") ?? input.route.tolls[0];
          if (brlToll.currencyCode === "BRL") {
            const totalCost = fuelCost + (brlToll.amount * multiplier);
            lines.push(
              `Com pedágio, o total estimado fica em ${formatMoneyAmount(brlToll.currencyCode, totalCost)}.`,
            );
          } else {
            lines.push(
              `Pedágio estimado: ${formatMoneyAmount(brlToll.currencyCode, brlToll.amount * multiplier)}.`,
            );
          }
        } else {
          lines.push("A rota parece ter pedágio, mas o valor não veio estimado nesta resposta.");
        }
      }
    }
  }

  if (input.route.warnings.length > 0) {
    lines.push(`Atenção: ${input.route.warnings[0]}.`);
  }
  if (input.alignedGoal) {
    lines.push(`Isso ajuda diretamente no objetivo ativo: ${input.alignedGoal}.`);
  }
  lines.push(`Maps: ${input.route.mapsUrl}`);
  return lines.join(" ");
}

export function formatPersonalMemoryKindLabel(kind: PersonalOperationalMemoryItemKind): string {
  switch (kind) {
    case "preference":
      return "Preferência";
    case "routine":
      return "Rotina";
    case "rule":
      return "Regra";
    case "packing":
      return "Itens";
    case "mobility":
      return "Deslocamento";
    case "context":
      return "Contexto";
    case "focus":
      return "Foco";
    case "note":
    default:
      return "Nota";
  }
}

export function buildPersonalMemoryListReply(input: {
  profile: PersonalOperationalProfile;
  items: PersonalOperationalMemoryItem[];
}): string {
  const lines = [
    "Memória pessoal operacional:",
    `- Estilo de resposta: ${input.profile.responseStyle}`,
    `- Briefing da manhã: ${input.profile.briefingPreference} | detalhe: ${input.profile.detailLevel} | tom: ${input.profile.tonePreference}`,
    `- Modo padrão: ${input.profile.defaultOperationalMode === "field" ? "plantão/rua" : "normal"}`,
    `- Escopo padrão de agenda: ${labelAgendaScope(input.profile.defaultAgendaScope)}`,
    `- Foco salvo: ${input.profile.savedFocus.length > 0 ? input.profile.savedFocus.join(" | ") : "nenhum"}`,
    `- Regras práticas: ${input.profile.operationalRules.slice(0, 3).join(" | ")}`,
    `- Deslocamento: ${input.profile.mobilityPreferences.slice(0, 2).join(" | ") || "sem preferência extra"}`,
    `- Itens de apoio: ${input.profile.attire.carryItems.join(" | ")}`,
  ];

  if (input.items.length === 0) {
    lines.push("", "Nenhum item adicional salvo na memória pessoal.");
    return lines.join("\n");
  }

  lines.push("", "Itens salvos:");
  for (const item of input.items) {
    lines.push(`- #${item.id} | ${formatPersonalMemoryKindLabel(item.kind)} | ${item.title}`);
    lines.push(`  ${item.content}`);
  }

  return lines.join("\n");
}

export function buildPersonalMemorySavedReply(item: PersonalOperationalMemoryItem): string {
  return [
    "Memória pessoal salva.",
    `- #${item.id} | ${formatPersonalMemoryKindLabel(item.kind)} | ${item.title}`,
    `- Conteúdo: ${item.content}`,
  ].join("\n");
}

export function buildPersonalMemoryUpdatedReply(item: PersonalOperationalMemoryItem): string {
  return [
    "Memória pessoal atualizada.",
    `- #${item.id} | ${formatPersonalMemoryKindLabel(item.kind)} | ${item.title}`,
    `- Conteúdo: ${item.content}`,
  ].join("\n");
}

export function buildPersonalMemoryDeletedReply(item: PersonalOperationalMemoryItem): string {
  return [
    "Memória pessoal removida.",
    `- #${item.id} | ${formatPersonalMemoryKindLabel(item.kind)} | ${item.title}`,
  ].join("\n");
}

export function buildPersonalMemoryAmbiguousReply(query: string, items: PersonalOperationalMemoryItem[]): string {
  return [
    `Encontrei mais de um item para "${query}". Diga o id exato para eu seguir.`,
    ...items.slice(0, 5).map((item) => `- #${item.id} | ${formatPersonalMemoryKindLabel(item.kind)} | ${item.title}`),
  ].join("\n");
}

export function isContactListPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "liste meus contatos",
    "listar contatos",
    "contatos inteligentes",
    "base de contatos",
  ]);
}

export function isContactUpsertPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "salve contato",
    "cadastre contato",
    "registre contato",
    "adicione contato",
  ]);
}

export function defaultPersonaForRelationship(relationship: ContactRelationship): ContactPersona {
  switch (relationship) {
    case "partner":
    case "family":
    case "friend":
      return "pessoal_afetivo";
    case "client":
    case "lead":
      return "profissional_comercial";
    case "colleague":
    case "vendor":
      return "profissional_tecnico";
    case "social_case":
      return "social_humanizado";
    case "spam":
    case "unknown":
    default:
      return "operacional_neutro";
  }
}

export function parseContactRelationship(prompt: string): ContactRelationship {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (includesAny(normalized, ["parceira", "parceiro", "esposa", "esposo", "namorada", "namorado"])) {
    return "partner";
  }
  if (includesAny(normalized, ["familia", "familiar", "irma", "irmao", "mae", "pai", "filho", "filha"])) {
    return "family";
  }
  if (includesAny(normalized, ["amigo", "amiga"])) {
    return "friend";
  }
  if (includesAny(normalized, ["cliente"])) {
    return "client";
  }
  if (includesAny(normalized, ["lead", "potencial cliente"])) {
    return "lead";
  }
  if (includesAny(normalized, ["colega", "parceiro tecnico", "parceiro tecnico", "dev"])) {
    return "colleague";
  }
  if (includesAny(normalized, ["caso social", "usuario social", "trabalho social"])) {
    return "social_case";
  }
  if (includesAny(normalized, ["fornecedor", "vendor"])) {
    return "vendor";
  }
  if (includesAny(normalized, ["spam"])) {
    return "spam";
  }
  return "unknown";
}

export function extractLabeledValue(prompt: string, labels: string[], stopLabels: string[]): string | undefined {
  const pattern = new RegExp(
    String.raw`(?:^|\s)(?:${labels.join("|")})\s*[:\-]?\s*(.+?)(?=\s+(?:${stopLabels.join("|")})\b|$)`,
    "i",
  );
  return pattern.exec(prompt)?.[1]?.trim();
}

export function extractContactProfileInput(prompt: string): UpsertContactProfileInput | undefined {
  const relationship = parseContactRelationship(prompt);
  const emailMatch = prompt.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const phoneMatch = prompt.match(/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9?\d{4})-?\d{4}/);
  const telegramMatch = prompt.match(/@\w{3,}/);
  const identifier = emailMatch?.[0] ?? phoneMatch?.[0] ?? telegramMatch?.[0];
  if (!identifier) {
    return undefined;
  }

  const normalized = normalizeEmailAnalysisText(prompt);
  const channel = emailMatch ? "email" : telegramMatch ? "telegram" : normalized.includes("whatsapp") ? "whatsapp" : "generic";
  const stopLabels = [
    "email",
    "telefone",
    "whatsapp",
    "telegram",
    "empresa",
    "negocio",
    "negócio",
    "tom",
    "tone",
    "prioridade",
    "relacao",
    "relação",
  ];
  const displayName =
    extractLabeledValue(prompt, ["nome", "chama(?:-se)?"], stopLabels) ??
    extractLabeledValue(prompt, ["contato"], stopLabels);
  const company = extractLabeledValue(prompt, ["empresa", "negocio", "negócio"], stopLabels);
  const toneMatch = prompt.match(/(?:tom|tone)\s*[:\-]?\s*([A-Za-zÀ-ÿ0-9 _-]{2,40})/i);

  return {
    channel,
    identifier,
    displayName,
    relationship,
    persona: defaultPersonaForRelationship(relationship),
    priority: relationship === "partner" || relationship === "family" || relationship === "client" ? "alta" : "media",
    company,
    preferredTone: toneMatch?.[1]?.trim(),
    source: "manual",
  };
}

export function buildContactSaveReply(contact: ContactProfileRecord): string {
  return [
    "Contato salvo.",
    `- Canal: ${contact.channel}`,
    `- Identificador: ${contact.identifier}`,
    `- Nome: ${contact.displayName ?? "(sem nome)"}`,
    `- Relação: ${contact.relationship}`,
    `- Persona: ${contact.persona}`,
    `- Prioridade: ${contact.priority}`,
    ...(contact.company ? [`- Empresa: ${contact.company}`] : []),
  ].join("\n");
}

export function buildContactListReply(contacts: ContactProfileRecord[]): string {
  if (contacts.length === 0) {
    return "Não encontrei contatos salvos na inteligência de contatos.";
  }

  return [
    `Contatos inteligentes: ${contacts.length}.`,
    ...contacts.map((contact) =>
      `- ${contact.displayName ?? contact.identifier} | ${contact.relationship} | ${contact.persona} | ${contact.channel}`,
    ),
  ].join("\n");
}

export function extractMemoryEntityKindFromPrompt(prompt: string): MemoryEntityKind | undefined {
  const normalized = prompt.toLowerCase();
  if (includesAny(normalized, ["aprova", "approval"])) {
    return "approval";
  }
  if (includesAny(normalized, ["workflow", "fluxo"])) {
    return "workflow_run";
  }
  if (includesAny(normalized, ["contato", "contact"])) {
    return "contact";
  }
  if (includesAny(normalized, ["projeto", "project"])) {
    return "project";
  }
  if (includesAny(normalized, ["lead"])) {
    return "lead";
  }
  if (includesAny(normalized, ["conteudo", "conteúdo", "content"])) {
    return "content_item";
  }
  if (includesAny(normalized, ["pesquisa", "research"])) {
    return "research_session";
  }
  if (includesAny(normalized, ["tarefa", "task"])) {
    return "task";
  }
  return undefined;
}

export function extractMemoryEntitySearchQuery(prompt: string): string | undefined {
  const quoted = prompt.match(/["“](.+?)["”]/);
  if (quoted?.[1]?.trim()) {
    return quoted[1].trim();
  }

  const normalized = prompt
    .replace(/^.*?(busque entidades|buscar entidades|procure entidades)\s*/i, "")
    .replace(/\b(do tipo|tipo)\b.*$/i, "")
    .trim();

  return normalized || undefined;
}

export function buildMemoryEntityListReply(entities: MemoryEntityRecord[], input: {
  kind?: MemoryEntityKind;
  query?: string;
}): string {
  if (entities.length === 0) {
    if (input.query) {
      return `Não encontrei entidades para a busca "${input.query}".`;
    }
    if (input.kind) {
      return `Não encontrei entidades do tipo ${input.kind}.`;
    }
    return "Não encontrei entidades salvas na memória estruturada do Atlas.";
  }

  const header = input.query
    ? `Entidades encontradas para "${input.query}": ${entities.length}.`
    : input.kind
      ? `Entidades do tipo ${input.kind}: ${entities.length}.`
      : `Entidades recentes da memória do Atlas: ${entities.length}.`;

  return [
    header,
    ...entities.slice(0, 10).map((entity) =>
      `- ${entity.kind} | ${entity.title}${entity.tags.length ? ` | tags: ${entity.tags.slice(0, 4).join(", ")}` : ""}`,
    ),
  ].join("\n");
}
