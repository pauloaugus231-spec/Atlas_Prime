import type { AgentDomain } from "./orchestration.js";
import type { JsonSchema } from "./json-schema.js";

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type SideEffect = "read" | "write" | "send" | "schedule" | "publish" | "exec";

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
}
