import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import type { Logger } from "../types/logger.js";
import type {
  CapabilityAvailabilityRecord,
  CapabilityDefinition,
  RiskLevel,
  SideEffect,
} from "../types/capability.js";
import type { ToolExecutionContext, ToolPluginResult } from "../types/plugin.js";
import { ToolPluginRegistry } from "./plugin-registry.js";
import type { ApprovalEngine } from "./approval-engine.js";
import type { ContextMemoryService } from "./context-memory.js";
import type { IntentRouter } from "./intent-router.js";
import type { MemoryEntityStore } from "./memory-entity-store.js";
import type { PersonalOSService } from "./personal-os.js";
import type { WorkflowExecutionRuntime } from "./execution-runtime.js";
import type { BuiltInCapabilityDefinition } from "./capabilities/index.js";

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) {
    return "Unknown validation error";
  }

  return errors
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`.trim())
    .join("; ");
}

function coerceArguments(argumentsValue: unknown): Record<string, unknown> {
  if (argumentsValue == null) {
    return {};
  }

  if (typeof argumentsValue === "string") {
    const parsed = JSON.parse(argumentsValue) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Capability arguments must decode into an object");
    }
    return parsed as Record<string, unknown>;
  }

  if (typeof argumentsValue !== "object" || Array.isArray(argumentsValue)) {
    throw new Error("Capability arguments must be an object");
  }

  return argumentsValue as Record<string, unknown>;
}

export interface CapabilityExecutionContext {
  requestId: string;
  logger: Logger;
  personalOs: PersonalOSService;
  approvalEngine: ApprovalEngine;
  workflowRuntime: WorkflowExecutionRuntime;
  memoryEntities: MemoryEntityStore;
  contextMemory: ContextMemoryService;
  intentRouter: IntentRouter;
  toolContext?: ToolExecutionContext;
}

type CapabilityHandler = {
  definition: CapabilityDefinition;
  source: "builtin" | "plugin";
  execute: (input: Record<string, unknown>, context: CapabilityExecutionContext) => Promise<ToolPluginResult> | ToolPluginResult;
};

function inferPluginRisk(toolName: string): RiskLevel {
  const normalized = toolName.toLowerCase();
  if (normalized.includes("publish") || normalized.includes("delete") || normalized.includes("send")) {
    return "high";
  }
  if (normalized.includes("create") || normalized.includes("update") || normalized.includes("exec")) {
    return "medium";
  }
  return "low";
}

function inferPluginSideEffects(toolName: string): SideEffect[] {
  const normalized = toolName.toLowerCase();
  if (normalized.includes("publish")) {
    return ["publish"];
  }
  if (normalized.includes("send") || normalized.includes("reply")) {
    return ["send"];
  }
  if (normalized.includes("schedule")) {
    return ["schedule"];
  }
  if (normalized.includes("exec")) {
    return ["exec"];
  }
  if (normalized.includes("create") || normalized.includes("update") || normalized.includes("delete")) {
    return ["write"];
  }
  return ["read"];
}

function inferPluginRequiresApproval(toolName: string): boolean {
  return inferPluginRisk(toolName) !== "low" || inferPluginSideEffects(toolName)[0] !== "read";
}

function inferPluginAutonomyLevel(toolName: string): CapabilityDefinition["autonomyLevel"] {
  const sideEffects = inferPluginSideEffects(toolName);
  if (sideEffects.includes("send") || sideEffects.includes("publish")) {
    return "L5";
  }
  if (sideEffects.includes("write") || sideEffects.includes("schedule") || sideEffects.includes("exec")) {
    return "L4";
  }
  return "L1";
}

export class CapabilityRegistry {
  private readonly validators = new Map<string, ValidateFunction<Record<string, unknown>>>();
  private readonly handlers = new Map<string, CapabilityHandler>();
  private readonly catalog = new Map<string, CapabilityDefinition>();

  constructor(
    private readonly toolRegistry: ToolPluginRegistry,
    builtIns: BuiltInCapabilityDefinition[],
    declaredCapabilities: CapabilityDefinition[],
    private readonly logger: Logger,
  ) {
    const ajv = new Ajv({ allErrors: true, strict: false });

    for (const capability of declaredCapabilities) {
      this.catalog.set(capability.name, capability);
    }

    for (const capability of builtIns) {
      this.catalog.set(capability.name, capability);
      this.handlers.set(capability.name, {
        definition: capability,
        source: "builtin",
        execute: capability.execute,
      });
      this.validators.set(capability.name, ajv.compile<Record<string, unknown>>(capability.inputSchema));
    }

    for (const loaded of this.toolRegistry.listPlugins()) {
      const definition: CapabilityDefinition = {
        name: loaded.plugin.name,
        domain: "orchestrator",
        category: "plugin",
        description: loaded.plugin.description,
        inputSchema: loaded.plugin.parameters,
        risk: inferPluginRisk(loaded.plugin.name),
        sideEffects: inferPluginSideEffects(loaded.plugin.name),
        requiresApproval: inferPluginRequiresApproval(loaded.plugin.name),
        autonomyLevel: inferPluginAutonomyLevel(loaded.plugin.name),
        reversible: inferPluginSideEffects(loaded.plugin.name).every((item) => item === "read"),
        writesExternalSystem: inferPluginSideEffects(loaded.plugin.name).some((item) =>
          item === "write" || item === "schedule" || item === "publish" || item === "exec"
        ),
        sendsToExternalRecipient: inferPluginSideEffects(loaded.plugin.name).includes("send"),
        auditRequired: inferPluginSideEffects(loaded.plugin.name).some((item) => item !== "read"),
        exposeToModel: loaded.plugin.exposeToModel,
      };
      this.catalog.set(definition.name, definition);
      this.handlers.set(definition.name, {
        definition,
        source: "plugin",
        execute: async (input, context) => {
          if (!context.toolContext) {
            throw new Error(`Capability ${definition.name} requires tool execution context.`);
          }
          const result = await this.toolRegistry.execute(definition.name, input, context.toolContext);
          return result.rawResult;
        },
      });
      this.validators.set(definition.name, ajv.compile<Record<string, unknown>>(definition.inputSchema));
    }
  }

  listCapabilities(): CapabilityDefinition[] {
    return [...this.handlers.values()].map((entry) => entry.definition);
  }

  listCatalogCapabilities(): CapabilityDefinition[] {
    return [...this.catalog.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  listCatalogAvailability(
    resolveAvailability?: (capability: CapabilityDefinition) => Omit<CapabilityAvailabilityRecord, "name" | "description" | "domain" | "requiresApproval" | "experimental" | "integrationKey" | "declaredOnly" | "category">,
  ): CapabilityAvailabilityRecord[] {
    return this.listCatalogCapabilities().map((capability) => {
      const availability = resolveAvailability?.(capability);
      return {
        name: capability.name,
        description: capability.description,
        domain: capability.domain,
        category: capability.category ?? capability.domain,
        availability: availability?.availability ?? (this.handlers.has(capability.name) ? "available" : "unavailable"),
        reason: availability?.reason ?? (this.handlers.has(capability.name) ? "Capability executável registrada." : "Capability declarada, sem implementação executável."),
        requiresApproval: capability.requiresApproval,
        experimental: capability.experimental === true,
        integrationKey: capability.integrationKey,
        declaredOnly: capability.declaredOnly === true,
      };
    });
  }

  listByDomain(domain: CapabilityDefinition["domain"]): CapabilityDefinition[] {
    return this.listCapabilities().filter((capability) => capability.domain === domain);
  }

  hasCapability(name: string): boolean {
    return this.handlers.has(name);
  }

  getCapability(name: string): CapabilityDefinition | null {
    return this.catalog.get(name) ?? this.handlers.get(name)?.definition ?? null;
  }

  async execute(
    name: string,
    rawArguments: unknown,
    context: CapabilityExecutionContext,
  ): Promise<ToolPluginResult> {
    const handler = this.handlers.get(name);
    if (!handler) {
      throw new Error(`Unknown capability requested: ${name}`);
    }

    const validator = this.validators.get(name);
    if (!validator) {
      throw new Error(`No validator registered for capability: ${name}`);
    }

    const parameters = coerceArguments(rawArguments);
    const valid = validator(parameters);
    if (!valid) {
      throw new Error(`Invalid arguments for ${name}: ${formatAjvErrors(validator.errors)}`);
    }

    this.logger.info("Executing capability", {
      capability: name,
      source: handler.source,
      requestId: context.requestId,
    });

    return handler.execute(parameters, context);
  }
}
