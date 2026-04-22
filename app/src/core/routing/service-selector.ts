import type { TurnFrame } from "../../types/turn-frame.js";
import type { DirectRouteDefinition } from "../direct-route-runner.js";
import type { ServiceSelectionCandidate } from "./service-manifest.js";

function scoreRoute(turnFrame: TurnFrame, route: DirectRouteDefinition): ServiceSelectionCandidate | null {
  const manifest = route.manifest;
  if (!manifest || manifest.intents.length === 0) {
    return null;
  }

  let score = manifest.priority ?? 0;
  const reasons: string[] = [];

  if (manifest.intents.includes(turnFrame.primaryIntent)) {
    score += 100;
    reasons.push(`intent:${turnFrame.primaryIntent}`);
  } else {
    return null;
  }

  if (manifest.objects?.length) {
    if (manifest.objects.includes(turnFrame.requestedObject)) {
      score += 20;
      reasons.push(`object:${turnFrame.requestedObject}`);
    } else if (turnFrame.requestedObject !== "unknown") {
      score -= 10;
    }
  }

  if (manifest.operations?.length) {
    if (manifest.operations.includes(turnFrame.requestedOperation)) {
      score += 15;
      reasons.push(`operation:${turnFrame.requestedOperation}`);
    } else if (turnFrame.requestedOperation !== "unknown") {
      score -= 10;
    }
  }

  if (manifest.audiences?.length && turnFrame.audience) {
    if (manifest.audiences.includes(turnFrame.audience)) {
      score += 10;
      reasons.push(`audience:${turnFrame.audience}`);
    } else {
      score -= 10;
    }
  }

  const blockedAmbiguity = manifest.blockedByAmbiguities?.find((item) => turnFrame.ambiguities.includes(item));
  if (blockedAmbiguity) {
    return null;
  }

  if (turnFrame.explicitness === "explicit") {
    score += 5;
  }
  score += Math.round(turnFrame.confidence * 10);

  return {
    route,
    score,
    reasons,
  };
}

export class ServiceSelector {
  rank(turnFrame: TurnFrame, routes: DirectRouteDefinition[]): ServiceSelectionCandidate[] {
    return routes
      .map((route) => scoreRoute(turnFrame, route))
      .filter((item): item is ServiceSelectionCandidate => Boolean(item))
      .sort((left, right) => right.score - left.score || left.route.key.localeCompare(right.route.key));
  }

  select(turnFrame: TurnFrame, routes: DirectRouteDefinition[]): ServiceSelectionCandidate | null {
    return this.rank(turnFrame, routes)[0] ?? null;
  }
}
