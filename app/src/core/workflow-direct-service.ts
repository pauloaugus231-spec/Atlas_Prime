import type { AgentRunResult } from "./agent-core.js";
import type { ConversationMessage } from "../types/llm.js";
import type { Logger } from "../types/logger.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type { UserPreferences } from "../types/user-preferences.js";
import type { WorkflowArtifactRecord, WorkflowPlanRecord, WorkflowStepRecord } from "../types/workflow.js";

interface PlanBuilderLike {
  createPlanFromPrompt: (
    userPrompt: string,
    orchestration: OrchestrationContext,
    requestLogger?: Logger,
  ) => Promise<WorkflowPlanRecord>;
}

interface EntityLinkerLike {
  upsertWorkflowRun: (plan: WorkflowPlanRecord, lastEvent?: string | null) => unknown;
}

interface WorkflowsLike {
  listPlans: (limit?: number) => WorkflowPlanRecord[];
  latestPlan: () => WorkflowPlanRecord | null;
  getPlan: (planId: number) => WorkflowPlanRecord | null;
  listArtifacts: (planId: number, stepNumber?: number) => WorkflowArtifactRecord[];
  saveArtifact: (input: {
    planId: number;
    stepNumber?: number | null;
    artifactType: "status_update" | "execution_brief" | "deliverable" | "note";
    title: string;
    summary: string;
    content: string;
    filePath?: string | null;
  }) => WorkflowArtifactRecord;
}

interface WorkflowRuntimeLike {
  startStep: (planId: number, stepNumber?: number) => {
    plan: WorkflowPlanRecord;
    step: WorkflowStepRecord;
  };
  completeStep: (planId: number, stepNumber: number, notes?: string | null) => {
    plan: WorkflowPlanRecord;
    step: WorkflowStepRecord;
  };
  blockStep: (planId: number, stepNumber: number, reason: string) => {
    plan: WorkflowPlanRecord;
    step: WorkflowStepRecord;
  };
  failStep: (planId: number, stepNumber: number, reason: string) => {
    plan: WorkflowPlanRecord;
    step: WorkflowStepRecord;
  };
  markWaitingApproval: (planId: number, stepNumber: number, message: string) => {
    plan: WorkflowPlanRecord;
    step: WorkflowStepRecord;
  };
  resetStepToPending: (planId: number, stepNumber: number, reason?: string) => {
    plan: WorkflowPlanRecord;
    step: WorkflowStepRecord;
  };
  resumeStep: (planId: number, stepNumber: number, reason?: string) => {
    plan: WorkflowPlanRecord;
    step: WorkflowStepRecord;
  };
}

interface WorkflowExecutionBrief {
  summary: string;
  immediateActions: string[];
  risks: string[];
  outputs: string[];
  suggestedTools: string[];
  followUp: string;
}

interface WorkflowDirectHelpers {
  isWorkflowPlanningPrompt: (prompt: string) => boolean;
  isWorkflowShowPrompt: (prompt: string) => boolean;
  buildWorkflowPlanReply: (plan: WorkflowPlanRecord) => string;
  isWorkflowListPrompt: (prompt: string) => boolean;
  buildWorkflowListReply: (plans: WorkflowPlanRecord[]) => string;
  isWorkflowArtifactListPrompt: (prompt: string) => boolean;
  extractWorkflowPlanId: (prompt: string) => number | undefined;
  extractWorkflowStepNumber: (prompt: string) => number | undefined;
  buildWorkflowArtifactsReply: (
    plan: WorkflowPlanRecord,
    artifacts: WorkflowArtifactRecord[],
    stepNumber?: number,
  ) => string;
  isWorkflowExecutionPrompt: (prompt: string) => boolean;
  shouldAutoExecuteWorkflowDeliverable: (prompt: string) => boolean;
  buildWorkflowExecutionReply: (input: {
    plan: WorkflowPlanRecord;
    step: WorkflowStepRecord;
    artifact: WorkflowArtifactRecord;
    deliverableArtifact?: WorkflowArtifactRecord;
    deliverableSummary?: string;
    brief: WorkflowExecutionBrief;
  }) => string;
  isWorkflowStepUpdatePrompt: (prompt: string) => boolean;
  extractWorkflowStepStatus: (prompt: string) =>
    | "pending"
    | "in_progress"
    | "waiting_approval"
    | "blocked"
    | "completed"
    | "failed"
    | undefined;
  buildWorkflowStepUpdateReply: (plan: WorkflowPlanRecord, stepNumber: number) => string;
}

export interface WorkflowDirectServiceDependencies {
  logger: Logger;
  planBuilder: PlanBuilderLike;
  entityLinker: EntityLinkerLike;
  workflows: WorkflowsLike;
  workflowRuntime: WorkflowRuntimeLike;
  buildWorkflowExecutionBrief: (
    plan: WorkflowPlanRecord,
    step: WorkflowStepRecord,
    requestLogger: Logger,
  ) => Promise<WorkflowExecutionBrief>;
  saveWorkflowExecutionArtifact: (
    plan: WorkflowPlanRecord,
    step: WorkflowStepRecord,
    brief: WorkflowExecutionBrief,
  ) => WorkflowArtifactRecord;
  generateWorkflowDomainDeliverable: (
    plan: WorkflowPlanRecord,
    step: WorkflowStepRecord,
    brief: WorkflowExecutionBrief,
    requestLogger: Logger,
  ) => Promise<{ artifact: WorkflowArtifactRecord; summary: string }>;
  buildBaseMessages: (
    userPrompt: string,
    orchestration: OrchestrationContext,
    preferences?: UserPreferences,
  ) => ConversationMessage[];
  helpers: WorkflowDirectHelpers;
}

interface WorkflowDirectInput {
  userPrompt: string;
  requestId: string;
  orchestration: OrchestrationContext;
  preferences?: UserPreferences;
  requestLogger?: Logger;
}

export class WorkflowDirectService {
  constructor(private readonly deps: WorkflowDirectServiceDependencies) {}

  async tryRunWorkflowPlanning(input: WorkflowDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isWorkflowPlanningPrompt(input.userPrompt) || this.deps.helpers.isWorkflowShowPrompt(input.userPrompt)) {
      return null;
    }

    const logger = input.requestLogger ?? this.deps.logger;
    logger.info("Using direct workflow planning route", {
      domain: input.orchestration.route.primaryDomain,
      actionMode: input.orchestration.route.actionMode,
    });

    const plan = await this.deps.planBuilder.createPlanFromPrompt(input.userPrompt, input.orchestration, logger);
    this.deps.entityLinker.upsertWorkflowRun(plan, "Workflow planejado.");
    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildWorkflowPlanReply(plan),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "workflow_plan",
          resultPreview: JSON.stringify(
            {
              id: plan.id,
              title: plan.title,
              steps: plan.steps.length,
              primaryDomain: plan.primaryDomain,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  tryRunWorkflowList(input: WorkflowDirectInput): AgentRunResult | null {
    if (!this.deps.helpers.isWorkflowListPrompt(input.userPrompt)) {
      return null;
    }

    const plans = this.deps.workflows.listPlans(10);
    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildWorkflowListReply(plans),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [],
    };
  }

  tryRunWorkflowShow(input: WorkflowDirectInput): AgentRunResult | null {
    if (!this.deps.helpers.isWorkflowShowPrompt(input.userPrompt)) {
      return null;
    }

    const planId = this.deps.helpers.extractWorkflowPlanId(input.userPrompt);
    if (!planId) {
      return null;
    }

    const plan = this.deps.workflows.getPlan(planId);
    if (!plan) {
      return {
        requestId: input.requestId,
        reply: `Não encontrei o workflow #${planId}.`,
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildWorkflowPlanReply(plan),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [],
    };
  }

  tryRunWorkflowArtifacts(input: WorkflowDirectInput): AgentRunResult | null {
    if (!this.deps.helpers.isWorkflowArtifactListPrompt(input.userPrompt)) {
      return null;
    }

    const planId = this.deps.helpers.extractWorkflowPlanId(input.userPrompt) ?? this.deps.workflows.latestPlan()?.id;
    if (!planId) {
      return {
        requestId: input.requestId,
        reply: "Não encontrei workflow para listar artefatos.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const plan = this.deps.workflows.getPlan(planId);
    if (!plan) {
      return {
        requestId: input.requestId,
        reply: `Não encontrei o workflow #${planId}.`,
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const stepNumber = this.deps.helpers.extractWorkflowStepNumber(input.userPrompt);
    const artifacts = this.deps.workflows.listArtifacts(planId, stepNumber);
    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildWorkflowArtifactsReply(plan, artifacts, stepNumber),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [],
    };
  }

  async tryRunWorkflowExecution(input: WorkflowDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isWorkflowExecutionPrompt(input.userPrompt)) {
      return null;
    }

    const planId = this.deps.helpers.extractWorkflowPlanId(input.userPrompt) ?? this.deps.workflows.latestPlan()?.id;
    if (!planId) {
      return {
        requestId: input.requestId,
        reply: "Não encontrei workflow para iniciar ou retomar.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const stepNumber = this.deps.helpers.extractWorkflowStepNumber(input.userPrompt);
    const logger = input.requestLogger ?? this.deps.logger;
    try {
      const { plan, step } = this.deps.workflowRuntime.startStep(planId, stepNumber);
      const brief = await this.deps.buildWorkflowExecutionBrief(plan, step, logger);
      const artifact = this.deps.saveWorkflowExecutionArtifact(plan, step, brief);
      const autoExecute = this.deps.helpers.shouldAutoExecuteWorkflowDeliverable(input.userPrompt);
      const deliverable = autoExecute
        ? await this.deps.generateWorkflowDomainDeliverable(plan, step, brief, logger)
        : null;
      const refreshedPlan = this.deps.workflows.getPlan(plan.id) ?? plan;
      const refreshedStep = refreshedPlan.steps.find((item) => item.stepNumber === step.stepNumber) ?? step;

      return {
        requestId: input.requestId,
        reply: this.deps.helpers.buildWorkflowExecutionReply({
          plan: refreshedPlan,
          step: refreshedStep,
          artifact,
          deliverableArtifact: deliverable?.artifact,
          deliverableSummary: deliverable?.summary,
          brief,
        }),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [
          {
            toolName: "workflow_execution",
            resultPreview: JSON.stringify(
              {
                planId: refreshedPlan.id,
                stepNumber: refreshedStep.stepNumber,
                artifactId: artifact.id,
                artifactPath: artifact.filePath,
                deliverableArtifactId: deliverable?.artifact.id,
                deliverableArtifactPath: deliverable?.artifact.filePath,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return {
        requestId: input.requestId,
        reply: error instanceof Error ? error.message : String(error),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }
  }

  tryRunWorkflowStepUpdate(input: WorkflowDirectInput): AgentRunResult | null {
    if (!this.deps.helpers.isWorkflowStepUpdatePrompt(input.userPrompt)) {
      return null;
    }

    const planId = this.deps.helpers.extractWorkflowPlanId(input.userPrompt) ?? this.deps.workflows.latestPlan()?.id;
    const stepNumber = this.deps.helpers.extractWorkflowStepNumber(input.userPrompt);
    const status = this.deps.helpers.extractWorkflowStepStatus(input.userPrompt);
    if (!planId || !stepNumber || !status) {
      return null;
    }

    try {
      const transition = status === "completed"
        ? this.deps.workflowRuntime.completeStep(planId, stepNumber)
        : status === "blocked"
          ? this.deps.workflowRuntime.blockStep(planId, stepNumber, `Etapa ${stepNumber} marcada como bloqueada pelo operador.`)
          : status === "failed"
            ? this.deps.workflowRuntime.failStep(planId, stepNumber, `Etapa ${stepNumber} marcada como falha pelo operador.`)
            : status === "waiting_approval"
              ? this.deps.workflowRuntime.markWaitingApproval(planId, stepNumber, `Etapa ${stepNumber} aguardando aprovação.`)
              : status === "pending"
                ? this.deps.workflowRuntime.resetStepToPending(planId, stepNumber, `Etapa ${stepNumber} voltou para pendente.`)
                : this.deps.workflowRuntime.resumeStep(planId, stepNumber, `Etapa ${stepNumber} retomada pelo operador.`);
      const plan = transition.plan;
      const step = plan.steps.find((item) => item.stepNumber === stepNumber);
      if (step) {
        this.deps.workflows.saveArtifact({
          planId,
          stepNumber,
          artifactType: "status_update",
          title: `Atualização da etapa ${stepNumber}`,
          summary: `Etapa ${stepNumber} alterada para ${status}.`,
          content: [
            `Workflow #${planId}`,
            `Etapa ${stepNumber}: ${step.title}`,
            `Novo status: ${status}`,
            `Atualizado em: ${new Date().toISOString()}`,
          ].join("\n"),
        });
      }

      return {
        requestId: input.requestId,
        reply: this.deps.helpers.buildWorkflowStepUpdateReply(plan, stepNumber),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    } catch (error) {
      return {
        requestId: input.requestId,
        reply: error instanceof Error ? error.message : String(error),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }
  }
}
