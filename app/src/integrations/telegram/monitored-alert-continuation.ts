import { interpretConversationTurn } from "../../core/conversation-interpreter.js";

export type MonitoredAlertTurnBehavior = "continue" | "interrupt" | "unclear";

export function resolveMonitoredAlertTurnBehavior(text: string): MonitoredAlertTurnBehavior {
  const interpreted = interpretConversationTurn({
    text,
    pendingFlow: {
      kind: "monitored_alert",
    },
  });

  if (interpreted.isFollowUp || interpreted.isCancellation || interpreted.isShortConfirmation) {
    return "continue";
  }

  if (interpreted.isTopicShift && interpreted.isTopLevelRequest) {
    return "interrupt";
  }

  return interpreted.needsClarification ? "unclear" : "interrupt";
}
