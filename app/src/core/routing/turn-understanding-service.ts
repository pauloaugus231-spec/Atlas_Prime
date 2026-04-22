import type {
  TurnFrame,
  TurnPrimaryIntent,
  TurnRequestedObject,
  TurnRequestedOperation,
  TurnSource,
} from "../../types/turn-frame.js";
import {
  collectLegacyRoutingHintIds,
  isLegacyRoutingHintAmbiguous,
} from "./legacy-trigger-compat.js";
import {
  extractDestinationLabel,
  extractProviderEntity,
  extractTimeRange,
  extractTurnAudience,
  includesAnyTurnToken,
  normalizeTurnText,
} from "./turn-entities.js";
import {
  computeTurnExplicitness,
  ROUTING_AMBIGUOUS_TERMS,
} from "./turn-resolution-policy.js";

export interface TurnUnderstandingInput {
  text: string;
  source?: TurnSource;
  recentMessages?: string[];
}

interface TurnIntentDecision {
  primaryIntent: TurnPrimaryIntent;
  requestedObject: TurnRequestedObject;
  requestedOperation: TurnRequestedOperation;
  confidence: number;
  signals: string[];
  ambiguities: string[];
  entities: Record<string, unknown>;
}

function hasRequestVerb(normalized: string): boolean {
  return includesAnyTurnToken(normalized, [
    "mostra",
    "mostrar",
    "me mostra",
    "quero",
    "preciso",
    "ajusta",
    "ajuste",
    "muda",
    "mudar",
    "troca",
    "coloca",
    "coloque",
    "cadastre",
    "cadastra",
    "conectar",
    "conecta",
    "desconectar",
    "desconecta",
    "remover",
    "remove",
    "liste",
    "listar",
    "me da",
    "me de",
    "envie",
    "manda",
    "gere",
    "gera",
    "apague",
    "exclua",
  ]);
}

function inferTurnIntent(normalized: string): TurnIntentDecision {
  const entities: Record<string, unknown> = {};
  const provider = extractProviderEntity(normalized);
  if (provider) {
    entities.provider = provider;
  }
  const audience = extractTurnAudience(normalized);
  if (audience) {
    entities.audience = audience;
  }
  const destinationLabel = extractDestinationLabel(normalized);
  if (destinationLabel) {
    entities.destinationLabel = destinationLabel;
  }
  const timeRange = extractTimeRange(normalized);
  if (timeRange) {
    entities.timeRange = timeRange;
  }

  if (includesAnyTurnToken(normalized, ["briefing compartilhavel", "briefing compartilhável", "compartilhavel da equipe", "compartilhável da equipe"])) {
    return {
      primaryIntent: "briefing.shared_preview",
      requestedObject: "briefing",
      requestedOperation: "preview",
      confidence: 0.96,
      signals: ["briefing_shared_preview"],
      ambiguities: [],
      entities,
    };
  }

  if (includesAnyTurnToken(normalized, ["painel", "como esta minha operacao", "como está minha operação", "o que está pegando agora", "o que esta pegando agora", "minha operacao agora", "minha operação agora"])) {
    return {
      primaryIntent: "command_center.show",
      requestedObject: "command_center",
      requestedOperation: "show",
      confidence: 0.95,
      signals: ["command_center"],
      ambiguities: [],
      entities,
    };
  }

  if (includesAnyTurnToken(normalized, ["minhas permissoes", "minhas permissões", "ver permissoes", "ver permissões", "quais conexoes", "quais conexões", "conexoes ativas", "conexões ativas"])) {
    return {
      primaryIntent: "connection.overview",
      requestedObject: "connection",
      requestedOperation: "show",
      confidence: 0.94,
      signals: ["connection_overview"],
      ambiguities: [],
      entities,
    };
  }

  if (includesAnyTurnToken(normalized, ["conectar google", "conecta google", "ligar google", "autorizar google"])) {
    return {
      primaryIntent: "connection.start",
      requestedObject: "connection",
      requestedOperation: "connect",
      confidence: 0.97,
      signals: ["connection_start"],
      ambiguities: [],
      entities: {
        ...entities,
        provider: provider ?? "google",
      },
    };
  }

  if (includesAnyTurnToken(normalized, ["desconectar google", "revogar google", "remover google", "desligar google"])) {
    return {
      primaryIntent: "connection.revoke",
      requestedObject: "connection",
      requestedOperation: "revoke",
      confidence: 0.97,
      signals: ["connection_revoke"],
      ambiguities: [],
      entities: {
        ...entities,
        provider: provider ?? "google",
      },
    };
  }

  if (includesAnyTurnToken(normalized, ["quais destinos", "meus destinos", "destinos cadastrados", "listar destinos", "mostra destinos"])) {
    return {
      primaryIntent: "destination.list",
      requestedObject: "destination",
      requestedOperation: "list",
      confidence: 0.95,
      signals: ["destination_list"],
      ambiguities: [],
      entities,
    };
  }

  if (includesAnyTurnToken(normalized, ["cadastre", "cadastra", "salve destino", "registre destino"]) && includesAnyTurnToken(normalized, ["telegram", "whatsapp", "email", "equipe", "grupo", "canal"])) {
    return {
      primaryIntent: "destination.save",
      requestedObject: "destination",
      requestedOperation: "create",
      confidence: 0.9,
      signals: ["destination_save"],
      ambiguities: [],
      entities,
    };
  }

  if (includesAnyTurnToken(normalized, ["mostre meu perfil", "meu perfil", "mostrar perfil operacional", "perfil operacional"])) {
    return {
      primaryIntent: "profile.show",
      requestedObject: "profile",
      requestedOperation: "show",
      confidence: 0.9,
      signals: ["profile_show"],
      ambiguities: [],
      entities,
    };
  }

  if (includesAnyTurnToken(normalized, ["remova do meu perfil", "remove do meu perfil", "apague do meu perfil", "exclua do meu perfil"])) {
    return {
      primaryIntent: "profile.delete",
      requestedObject: "profile",
      requestedOperation: "delete",
      confidence: 0.86,
      signals: ["profile_delete"],
      ambiguities: [],
      entities,
    };
  }

  if (includesAnyTurnToken(normalized, ["estado operacional", "como está meu estado operacional", "mostre meu estado operacional"])) {
    return {
      primaryIntent: "operational_state.show",
      requestedObject: "operational_state",
      requestedOperation: "show",
      confidence: 0.9,
      signals: ["operational_state_show"],
      ambiguities: [],
      entities,
    };
  }

  const hasBriefingToken = normalized.includes("briefing");
  const hasBriefingChange = hasBriefingToken && (
    includesAnyTurnToken(normalized, [
      "muda",
      "ajusta",
      "troca",
      "passa",
      "quero outro",
      "crie outro",
      "horario",
      "horário",
      "mais cedo",
      "mais tarde",
      "compartilhavel",
      "compartilhável",
    ])
    || Boolean(timeRange?.start)
  );
  if (hasBriefingChange) {
    return {
      primaryIntent: "briefing.update",
      requestedObject: "briefing",
      requestedOperation: "update",
      confidence: 0.92,
      signals: ["briefing_update"],
      ambiguities: [],
      entities,
    };
  }

  if (hasBriefingToken && includesAnyTurnToken(normalized, ["mostra", "mostrar", "gere", "gera", "me da", "me de", "quero ver", "traz"])) {
    return {
      primaryIntent: "briefing.show",
      requestedObject: "briefing",
      requestedOperation: "show",
      confidence: 0.9,
      signals: ["briefing_show"],
      ambiguities: [],
      entities,
    };
  }

  if (hasBriefingToken) {
    return {
      primaryIntent: "briefing.show",
      requestedObject: "briefing",
      requestedOperation: "show",
      confidence: 0.72,
      signals: ["briefing_generic"],
      ambiguities: ["briefing_target"],
      entities,
    };
  }

  if (normalized.includes("resumo") || normalized.includes("resuma")) {
    const ambiguities = ["summary_target"];
    if (normalized.includes("email")) {
      return {
        primaryIntent: "email.summarize",
        requestedObject: "email",
        requestedOperation: "summarize",
        confidence: 0.82,
        signals: ["email_summary"],
        ambiguities: [],
        entities,
      };
    }
    if (includesAnyTurnToken(normalized, ["pesquisa", "estudo", "fontes"])) {
      return {
        primaryIntent: "research.summarize",
        requestedObject: "research",
        requestedOperation: "summarize",
        confidence: 0.8,
        signals: ["research_summary"],
        ambiguities: [],
        entities,
      };
    }
    return {
      primaryIntent: "unknown",
      requestedObject: "unknown",
      requestedOperation: "unknown",
      confidence: 0.42,
      signals: ["summary_ambiguous"],
      ambiguities,
      entities,
    };
  }

  return {
    primaryIntent: "unknown",
    requestedObject: "unknown",
    requestedOperation: "unknown",
    confidence: 0.2,
    signals: [],
    ambiguities: [],
    entities,
  };
}

export class TurnUnderstandingService {
  understand(input: TurnUnderstandingInput): TurnFrame {
    const normalized = normalizeTurnText(input.text);
    const decision = inferTurnIntent(normalized);
    const hasStrongVerb = hasRequestVerb(normalized);
    const legacyHintIds = collectLegacyRoutingHintIds(input.text);
    const ambiguities = [...new Set([
      ...decision.ambiguities,
      ...(ROUTING_AMBIGUOUS_TERMS.filter((term) => normalized.includes(term) && decision.primaryIntent === "unknown").map((term) => `token:${term}`)),
      ...(isLegacyRoutingHintAmbiguous(input.text) ? ["legacy_ambiguity"] : []),
    ])];

    return {
      rawText: input.text,
      normalizedText: normalized,
      source: input.source ?? "unknown",
      primaryIntent: decision.primaryIntent,
      requestedObject: decision.requestedObject,
      requestedOperation: decision.requestedOperation,
      ...(typeof decision.entities.audience === "string" ? { audience: decision.entities.audience as TurnFrame["audience"] } : {}),
      ...(typeof decision.entities.destinationLabel === "string" ? { targetScope: decision.entities.destinationLabel } : {}),
      ...(decision.entities.timeRange ? { timeRange: decision.entities.timeRange as TurnFrame["timeRange"] } : {}),
      ...(input.recentMessages?.length ? { conversationAnchor: input.recentMessages.at(-1) } : {}),
      explicitness: computeTurnExplicitness({
        hasStrongVerb,
        ambiguityCount: ambiguities.length,
        primaryIntent: decision.primaryIntent,
      }),
      ambiguities,
      confidence: decision.confidence,
      signals: [...decision.signals, ...(hasStrongVerb ? ["request_verb"] : [])],
      legacyHintIds,
      entities: decision.entities,
    };
  }
}

const defaultTurnUnderstandingService = new TurnUnderstandingService();

export function buildTurnFrame(input: TurnUnderstandingInput): TurnFrame {
  return defaultTurnUnderstandingService.understand(input);
}
