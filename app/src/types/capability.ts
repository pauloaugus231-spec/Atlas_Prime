import type { AgentDomain } from "./orchestration.js";
import type { JsonSchema } from "./json-schema.js";
import type { SourceTrust } from "./autonomy.js";

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type SideEffect = "read" | "write" | "send" | "schedule" | "publish" | "exec";
export type CapabilityAvailabilityStatus = "available" | "partial" | "unavailable" | "needs_configuration";
export type CapabilityGapKind = "capability" | "configuration" | "user_data" | "permission" | "external_dependency";
export type CapabilityAutonomyLevel = "L0" | "L1" | "L2" | "L3" | "L4" | "L5";
export type CapabilityDataSensitivity = "public" | "personal" | "sensitive" | "credential" | "financial";

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
  autonomyLevel?: CapabilityAutonomyLevel;
  reversible?: boolean;
  dataSensitivity?: CapabilityDataSensitivity;
  allowedSourceTrust?: SourceTrust[];
  writesExternalSystem?: boolean;
  sendsToExternalRecipient?: boolean;
  auditRequired?: boolean;
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
