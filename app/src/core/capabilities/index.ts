import type { ApprovalEngine } from "../approval-engine.js";
import type { IntentRouter } from "../intent-router.js";
import type { MemoryEntityStore } from "../memory-entity-store.js";
import type { PersonalOSService } from "../personal-os.js";
import type { WorkflowExecutionRuntime } from "../execution-runtime.js";
import type { CapabilityDefinition } from "../../types/capability.js";
import type { Logger } from "../../types/logger.js";
import type { MemoryEntityKind } from "../../types/memory-entities.js";
import type { ToolPluginResult } from "../../types/plugin.js";

export interface BuiltInCapabilityExecutionContext {
  requestId: string;
  logger: Logger;
  personalOs: PersonalOSService;
  approvalEngine: ApprovalEngine;
  workflowRuntime: WorkflowExecutionRuntime;
  memoryEntities: MemoryEntityStore;
  intentRouter: IntentRouter;
}

export interface BuiltInCapabilityDefinition extends CapabilityDefinition {
  execute(
    input: Record<string, unknown>,
    context: BuiltInCapabilityExecutionContext,
  ): Promise<ToolPluginResult> | ToolPluginResult;
}

export function createBuiltInCapabilities(): BuiltInCapabilityDefinition[] {
  return [
    {
      name: "personal.brief.generate",
      domain: "secretario_operacional",
      description: "Gera o briefing executivo da manhã com agenda, tarefas, inbox, aprovações, workflows e founder brief.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
      },
      risk: "low",
      sideEffects: ["read"],
      requiresApproval: false,
      idempotent: true,
      async execute(_input, context) {
        const brief = await context.personalOs.getExecutiveMorningBrief();
        return JSON.parse(JSON.stringify(brief)) as Record<string, unknown>;
      },
    },
    {
      name: "memory.entities.list",
      domain: "orchestrator",
      description: "Lista entidades recentes da memória estruturada do Atlas.",
      inputSchema: {
        type: "object",
        properties: {
          kind: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "array",
      },
      risk: "low",
      sideEffects: ["read"],
      requiresApproval: false,
      idempotent: true,
      execute(input, context) {
        return context.memoryEntities.list(
          typeof input.limit === "number" ? Number(input.limit) : 20,
          typeof input.kind === "string" ? input.kind as MemoryEntityKind : undefined,
        );
      },
    },
    {
      name: "memory.entities.search",
      domain: "orchestrator",
      description: "Busca entidades estruturadas na memória do Atlas por texto e tipo.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          kind: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
        required: ["query"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "array",
      },
      risk: "low",
      sideEffects: ["read"],
      requiresApproval: false,
      idempotent: true,
      execute(input, context) {
        return context.memoryEntities.search(
          String(input.query),
          typeof input.limit === "number" ? Number(input.limit) : 20,
          typeof input.kind === "string" ? input.kind as MemoryEntityKind : undefined,
        );
      },
    },
    {
      name: "intent.resolve",
      domain: "orchestrator",
      description: "Resolve a intenção operacional, domínios citados e sinais compostos de um prompt.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
      },
      risk: "low",
      sideEffects: ["read"],
      requiresApproval: false,
      idempotent: true,
      execute(input, context) {
        const resolution = context.intentRouter.resolve(String(input.prompt));
        return JSON.parse(JSON.stringify(resolution)) as Record<string, unknown>;
      },
    },
    {
      name: "workflow.step.start",
      domain: "orchestrator",
      description: "Inicia ou retoma a próxima etapa acionável de um workflow.",
      inputSchema: {
        type: "object",
        properties: {
          planId: { type: "integer" },
          stepNumber: { type: "integer" },
        },
        required: ["planId"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
      },
      risk: "medium",
      sideEffects: ["write"],
      requiresApproval: false,
      async execute(input, context) {
        return context.workflowRuntime.startStep(
          Number(input.planId),
          typeof input.stepNumber === "number" ? Number(input.stepNumber) : undefined,
        );
      },
    },
    {
      name: "workflow.step.complete",
      domain: "orchestrator",
      description: "Conclui uma etapa de workflow e registra evento operacional.",
      inputSchema: {
        type: "object",
        properties: {
          planId: { type: "integer" },
          stepNumber: { type: "integer" },
          notes: { type: "string" },
        },
        required: ["planId", "stepNumber"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
      },
      risk: "medium",
      sideEffects: ["write"],
      requiresApproval: false,
      async execute(input, context) {
        return context.workflowRuntime.completeStep(
          Number(input.planId),
          Number(input.stepNumber),
          typeof input.notes === "string" ? input.notes : undefined,
        );
      },
    },
    {
      name: "workflow.events.list",
      domain: "orchestrator",
      description: "Lista os eventos recentes de execução de um workflow.",
      inputSchema: {
        type: "object",
        properties: {
          planId: { type: "integer" },
          stepNumber: { type: "integer" },
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
        required: ["planId"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "array",
      },
      risk: "low",
      sideEffects: ["read"],
      requiresApproval: false,
      idempotent: true,
      execute(input, context) {
        return context.workflowRuntime.listEvents(
          Number(input.planId),
          typeof input.stepNumber === "number" ? Number(input.stepNumber) : undefined,
          typeof input.limit === "number" ? Number(input.limit) : 20,
        );
      },
    },
    {
      name: "approval.pending.list",
      domain: "secretario_operacional",
      description: "Lista aprovações pendentes do Atlas.",
      inputSchema: {
        type: "object",
        properties: {
          chatId: { type: "integer" },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "array",
      },
      risk: "low",
      sideEffects: ["read"],
      requiresApproval: false,
      idempotent: true,
      execute(input, context) {
        const limit = typeof input.limit === "number" ? Number(input.limit) : 10;
        return typeof input.chatId === "number"
          ? context.approvalEngine.listPending(Number(input.chatId), limit)
          : context.approvalEngine.listPendingAll(limit);
      },
    },
  ];
}
