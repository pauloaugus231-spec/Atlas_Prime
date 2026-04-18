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
    personal_profile?: {
      display_name: string;
      primary_role: string;
      timezone: string;
      preferred_channels: string[];
      preferred_alert_channel?: string;
      priority_areas: string[];
      routine_summary: string[];
      response_style: string;
      briefing_preference: string;
      detail_level: string;
      tone_preference: string;
      default_operational_mode: string;
      default_agenda_scope: string;
      mobility_preferences: string[];
      autonomy_preferences: string[];
      carry_items: string[];
    };
    operational_state?: {
      mode: string;
      mode_reason?: string;
      focus: string[];
      weekly_priorities: string[];
      pending_alerts: string[];
      critical_tasks: string[];
      upcoming_commitments: Array<{
        summary: string;
        start?: string;
        account?: string;
        location?: string;
      }>;
      primary_risk?: string;
      briefing: {
        lastGeneratedAt?: string;
        nextAction?: string;
        overloadLevel?: string;
      };
      recent_context: string[];
      active_channel?: string;
      preferred_alert_channel?: string;
      pending_approvals: number;
    };
    learned_preferences?: Array<{
      type: string;
      description: string;
      value: string;
      confidence: number;
      confirmations: number;
    }>;
    operational_mode?: "field";
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
