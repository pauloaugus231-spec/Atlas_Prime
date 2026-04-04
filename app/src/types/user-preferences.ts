export type ResponseStyle = "executive" | "detailed" | "investigative" | "secretary";
export type ResponseLengthPreference = "short" | "medium";

export interface UserPreferences {
  responseStyle: ResponseStyle;
  responseLength: ResponseLengthPreference;
  proactiveNextStep: boolean;
  autoSourceFallback: boolean;
  preferredAgentName: string;
}

export interface UpdateUserPreferencesInput {
  responseStyle?: ResponseStyle;
  responseLength?: ResponseLengthPreference;
  proactiveNextStep?: boolean;
  autoSourceFallback?: boolean;
  preferredAgentName?: string;
}
