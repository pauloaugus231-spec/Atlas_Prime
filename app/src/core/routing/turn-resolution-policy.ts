import type {
  TurnExplicitness,
  TurnPrimaryIntent,
} from "../../types/turn-frame.js";

export const ROUTING_AMBIGUOUS_TERMS = [
  "resumo",
  "briefing",
  "agenda",
  "manda",
  "ajusta",
  "muda",
  "lista",
];

export const PHASE4_INTENT_FIRST_INTENTS: TurnPrimaryIntent[] = [
  "briefing.show",
  "briefing.update",
  "briefing.shared_preview",
  "command_center.show",
  "connection.overview",
  "connection.start",
  "connection.revoke",
  "destination.list",
  "destination.save",
  "profile.show",
  "profile.update",
  "profile.delete",
];

export function computeTurnExplicitness(input: {
  hasStrongVerb: boolean;
  ambiguityCount: number;
  primaryIntent: TurnPrimaryIntent;
}): TurnExplicitness {
  if (input.primaryIntent === "unknown" || input.ambiguityCount > 0) {
    return input.hasStrongVerb ? "implicit" : "ambiguous";
  }
  return input.hasStrongVerb ? "explicit" : "implicit";
}

export function isPhase4IntentFirstIntent(intent: TurnPrimaryIntent): boolean {
  return PHASE4_INTENT_FIRST_INTENTS.includes(intent);
}
