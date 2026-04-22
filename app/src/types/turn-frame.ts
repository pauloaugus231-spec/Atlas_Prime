export type TurnSource = "telegram" | "whatsapp" | "web" | "cli" | "audio" | "unknown";

export type TurnPrimaryIntent =
  | "briefing.show"
  | "briefing.update"
  | "briefing.shared_preview"
  | "command_center.show"
  | "connection.overview"
  | "connection.start"
  | "connection.revoke"
  | "destination.list"
  | "destination.save"
  | "profile.show"
  | "profile.update"
  | "profile.delete"
  | "operational_state.show"
  | "goal.list"
  | "goal.create"
  | "goal.update_progress"
  | "goal.delete"
  | "calendar.create"
  | "calendar.update"
  | "calendar.list"
  | "email.summarize"
  | "content.generate"
  | "research.summarize"
  | "unknown";

export type TurnRequestedObject =
  | "briefing"
  | "command_center"
  | "connection"
  | "destination"
  | "profile"
  | "operational_state"
  | "goal"
  | "calendar"
  | "email"
  | "content"
  | "research"
  | "unknown";

export type TurnRequestedOperation =
  | "show"
  | "create"
  | "update"
  | "delete"
  | "list"
  | "preview"
  | "connect"
  | "revoke"
  | "summarize"
  | "unknown";

export type TurnExplicitness = "explicit" | "implicit" | "ambiguous";
export type TurnAudience = "self" | "team" | "external";

export interface TurnTimeRange {
  start?: string;
  end?: string;
  reference?: "today" | "tomorrow" | "next_week" | "explicit_date" | "unknown";
}

export interface TurnFrame {
  rawText: string;
  normalizedText: string;
  source: TurnSource;
  primaryIntent: TurnPrimaryIntent;
  requestedObject: TurnRequestedObject;
  requestedOperation: TurnRequestedOperation;
  targetScope?: string;
  audience?: TurnAudience;
  timeRange?: TurnTimeRange;
  conversationAnchor?: string;
  explicitness: TurnExplicitness;
  ambiguities: string[];
  confidence: number;
  signals: string[];
  legacyHintIds: string[];
  entities: Record<string, unknown>;
}
