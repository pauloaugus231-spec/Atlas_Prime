import type { OperationalState } from "../types/operational-state.js";
import { defineToolPlugin } from "../types/plugin.js";

interface UpdateOperationalStateParameters {
  mode?: OperationalState["mode"];
  modeReason?: string;
  focus?: string[];
  weeklyPriorities?: string[];
  pendingAlerts?: string[];
  criticalTasks?: string[];
  primaryRisk?: string;
  recentContext?: string[];
  signals?: Array<{
    key: string;
    source: "calendar" | "tasks" | "mode" | "focus" | "pending_alert" | "monitored_whatsapp" | "context";
    kind: "possible_event" | "possible_task" | "reply_needed" | "deadline" | "attention" | "focus_hint" | "other";
    summary: string;
    priority: "low" | "medium" | "high";
    active: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  activeChannel?: string;
  preferredAlertChannel?: string;
  pendingApprovals?: number;
  upcomingCommitments?: Array<{
    summary: string;
    start?: string;
    account?: string;
    location?: string;
  }>;
  briefing?: {
    lastGeneratedAt?: string;
    nextAction?: string;
    overloadLevel?: "leve" | "moderado" | "pesado";
  };
}

export default defineToolPlugin<UpdateOperationalStateParameters>({
  name: "update_operational_state",
  description: "Updates the current operational state snapshot for the operator.",
  exposeToModel: false,
  parameters: {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["normal", "field"] },
      modeReason: { type: "string" },
      focus: { type: "array", items: { type: "string" } },
      weeklyPriorities: { type: "array", items: { type: "string" } },
      pendingAlerts: { type: "array", items: { type: "string" } },
      criticalTasks: { type: "array", items: { type: "string" } },
      primaryRisk: { type: "string" },
      recentContext: { type: "array", items: { type: "string" } },
      signals: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string" },
            source: {
              type: "string",
              enum: ["calendar", "tasks", "mode", "focus", "pending_alert", "monitored_whatsapp", "context"],
            },
            kind: {
              type: "string",
              enum: ["possible_event", "possible_task", "reply_needed", "deadline", "attention", "focus_hint", "other"],
            },
            summary: { type: "string" },
            priority: { type: "string", enum: ["low", "medium", "high"] },
            active: { type: "boolean" },
            createdAt: { type: "string" },
            updatedAt: { type: "string" },
          },
          required: ["key", "source", "kind", "summary", "priority", "active", "createdAt", "updatedAt"],
          additionalProperties: false,
        },
      },
      activeChannel: { type: "string" },
      preferredAlertChannel: { type: "string" },
      pendingApprovals: { type: "integer", minimum: 0 },
      upcomingCommitments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            summary: { type: "string" },
            start: { type: "string" },
            account: { type: "string" },
            location: { type: "string" },
          },
          required: ["summary"],
          additionalProperties: false,
        },
      },
      briefing: {
        type: "object",
        properties: {
          lastGeneratedAt: { type: "string" },
          nextAction: { type: "string" },
          overloadLevel: { type: "string", enum: ["leve", "moderado", "pesado"] },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
  execute(parameters, context) {
    return {
      ok: true,
      state: context.personalMemory.updateOperationalState(parameters),
    };
  },
});
