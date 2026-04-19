import type { AgentDomain } from "./orchestration.js";
import type { JsonSchema } from "./json-schema.js";

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type SideEffect = "read" | "write" | "send" | "schedule" | "publish" | "exec";
export type CapabilityAvailabilityStatus = "available" | "partial" | "unavailable" | "needs_configuration";
export type CapabilityGapKind = "capability" | "configuration" | "user_data" | "permission" | "external_dependency";

export interface CapabilityDefinition {
  name: string;
  domain: AgentDomain;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  risk: RiskLevel;
  sideEffects: SideEffect[];
  requiresApproval: boolean;
  timeoutMs?: number;
  idempotent?: boolean;
  exposeToModel?: boolean;
  category?: string;
  experimental?: boolean;
  integrationKey?: string;
  declaredOnly?: boolean;
}

export interface CapabilityAvailabilityRecord {
  name: string;
  description: string;
  domain: AgentDomain;
  category: string;
  availability: CapabilityAvailabilityStatus;
  reason: string;
  requiresApproval: boolean;
  experimental: boolean;
  integrationKey?: string;
  declaredOnly: boolean;
}

export interface CapabilityGapRequirement {
  kind: CapabilityGapKind;
  name: string;
  label: string;
  detail: string;
}
