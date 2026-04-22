import type {
  TurnAudience,
  TurnPrimaryIntent,
  TurnRequestedObject,
  TurnRequestedOperation,
} from "../../types/turn-frame.js";
import type { DirectRouteDefinition } from "../direct-route-runner.js";

export interface DirectRouteManifest {
  intents: TurnPrimaryIntent[];
  objects?: TurnRequestedObject[];
  operations?: TurnRequestedOperation[];
  audiences?: TurnAudience[];
  priority?: number;
  blockedByAmbiguities?: string[];
}

export interface ServiceSelectionCandidate {
  route: DirectRouteDefinition;
  score: number;
  reasons: string[];
}
