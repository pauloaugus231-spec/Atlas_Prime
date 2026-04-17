import type { AssistantDecision } from "./assistant-decision.js";
import type { AgentActionMode, AgentDomain } from "./orchestration.js";
import type { ResponseLengthPreference, ResponseStyle } from "./user-preferences.js";

export interface ExternalReasoningRequest {
  user_message: string;
  chat_id?: string;
  intent: {
    primary_domain: AgentDomain;
    secondary_domains: AgentDomain[];
    mentioned_domains: AgentDomain[];
    action_mode: AgentActionMode;
    confidence: number;
    compound: boolean;
  };
  context: {
    signals: string[];
    calendar?: {
      timezone: string;
      events: Array<{
        summary: string;
        start: string;
        location?: string;
        account?: string;
      }>;
    };
    tasks?: {
      lists: Array<{
        account: string;
        id: string;
        title: string;
      }>;
      items: Array<{
        account: string;
        task_id: string;
        task_list_id: string;
        task_list_title: string;
        title: string;
        status: string;
        due?: string;
      }>;
      recent_focus?: string[];
      guidance: string[];
    };
    memory?: string[];
    personal?: string[];
    preferences: {
      response_style: ResponseStyle;
      response_length: ResponseLengthPreference;
      proactive_next_step: boolean;
    };
    recent_messages: string[];
  };
}

export interface ExternalReasoningTextResponse {
  kind: "text";
  content: string;
}

export interface ExternalReasoningDecisionResponse {
  kind: "assistant_decision";
  content: string;
  decision: AssistantDecision;
}

export type ExternalReasoningResponse =
  | ExternalReasoningTextResponse
  | ExternalReasoningDecisionResponse;
