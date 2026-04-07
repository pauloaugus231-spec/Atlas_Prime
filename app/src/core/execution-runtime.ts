import type { Logger } from "../types/logger.js";
import type { WorkflowArtifactRecord, WorkflowPlanRecord, WorkflowStepRecord } from "../types/workflow.js";
import type { WorkflowRuntimeEventRecord } from "../types/workflow-events.js";
import type { EntityLinker } from "./entity-linker.js";
import { WorkflowOrchestratorStore } from "./workflow-orchestrator.js";

export class WorkflowExecutionRuntime {
  constructor(
    private readonly store: WorkflowOrchestratorStore,
    private readonly logger: Logger,
    private readonly entityLinker?: EntityLinker,
  ) {}

  startStep(planId: number, stepNumber?: number): {
    plan: WorkflowPlanRecord;
    step: WorkflowStepRecord;
    events: WorkflowRuntimeEventRecord[];
  } {
    const planBefore = this.store.getPlan(planId);
    if (!planBefore) {
      throw new Error(`Workflow plan not found: ${planId}`);
    }

    const { plan, step } = this.store.activateStep(planId, stepNumber);
    const events: WorkflowRuntimeEventRecord[] = [];

    if (planBefore.status === "draft") {
      events.push(this.store.appendEvent({
        planId,
        eventType: "workflow_started",
        message: `Workflow #${plan.id} iniciado.`,
      }));
    }

    events.push(this.store.appendEvent({
      planId,
      stepNumber: step.stepNumber,
      eventType: "step_started",
      message: `Etapa ${step.stepNumber} iniciada: ${step.title}.`,
    }));

    this.logger.info("Workflow step started", {
      planId,
      stepNumber: step.stepNumber,
      status: step.status,
    });
    this.entityLinker?.upsertWorkflowRun(plan, events[events.length - 1]?.message ?? null);

    return { plan, step, events };
  }

  markWaitingApproval(planId: number, stepNumber: number, message: string): {
    plan: WorkflowPlanRecord;
    step: WorkflowStepRecord;
    event: WorkflowRuntimeEventRecord;
  } {
    this.store.updateStep({
      planId,
      stepNumber,
      status: "waiting_approval",
      notes: message,
    });
    this.store.setPlanStatus(planId, "waiting_approval");
    const event = this.store.appendEvent({
      planId,
      stepNumber,
      eventType: "step_waiting_approval",
      message,
    });
    const plan = this.store.getPlan(planId);
    const step = this.store.getStep(planId, stepNumber);
    if (!plan || !step) {
      throw new Error(`Workflow state unavailable after waiting approval transition: plan=${planId}, step=${stepNumber}`);
    }
    this.entityLinker?.upsertWorkflowRun(plan, event.message);
    return { plan, step, event };
  }

  completeStep(planId: number, stepNumber: number, notes?: string | null): {
    plan: WorkflowPlanRecord;
    step: WorkflowStepRecord;
    event: WorkflowRuntimeEventRecord;
  } {
    this.store.updateStep({
      planId,
      stepNumber,
      status: "completed",
      notes: notes ?? undefined,
    });
    const step = this.store.getStep(planId, stepNumber);
    const plan = this.store.getPlan(planId);
    if (!plan || !step) {
      throw new Error(`Workflow state unavailable after completion: plan=${planId}, step=${stepNumber}`);
    }

    const event = this.store.appendEvent({
      planId,
      stepNumber,
      eventType: plan.status === "completed" ? "workflow_completed" : "step_completed",
      message: plan.status === "completed"
        ? `Workflow #${plan.id} concluído.`
        : `Etapa ${step.stepNumber} concluída: ${step.title}.`,
    });

    this.entityLinker?.upsertWorkflowRun(plan, event.message);
    return { plan, step, event };
  }

  failStep(planId: number, stepNumber: number, reason: string): {
    plan: WorkflowPlanRecord;
    step: WorkflowStepRecord;
    event: WorkflowRuntimeEventRecord;
  } {
    this.store.updateStep({
      planId,
      stepNumber,
      status: "failed",
      notes: reason,
    });
    this.store.setPlanStatus(planId, "failed");
    const event = this.store.appendEvent({
      planId,
      stepNumber,
      eventType: "step_failed",
      message: reason,
    });
    const plan = this.store.getPlan(planId);
    const step = this.store.getStep(planId, stepNumber);
    if (!plan || !step) {
      throw new Error(`Workflow state unavailable after failure: plan=${planId}, step=${stepNumber}`);
    }
    this.entityLinker?.upsertWorkflowRun(plan, event.message);
    return { plan, step, event };
  }

  blockStep(planId: number, stepNumber: number, reason: string): {
    plan: WorkflowPlanRecord;
    step: WorkflowStepRecord;
    event: WorkflowRuntimeEventRecord;
  } {
    this.store.updateStep({
      planId,
      stepNumber,
      status: "blocked",
      notes: reason,
    });
    this.store.setPlanStatus(planId, "blocked");
    const event = this.store.appendEvent({
      planId,
      stepNumber,
      eventType: "step_blocked",
      message: reason,
    });
    const plan = this.store.getPlan(planId);
    const step = this.store.getStep(planId, stepNumber);
    if (!plan || !step) {
      throw new Error(`Workflow state unavailable after blocking: plan=${planId}, step=${stepNumber}`);
    }
    this.entityLinker?.upsertWorkflowRun(plan, event.message);
    return { plan, step, event };
  }

  resumeStep(planId: number, stepNumber: number, reason?: string): {
    plan: WorkflowPlanRecord;
    step: WorkflowStepRecord;
    event: WorkflowRuntimeEventRecord;
  } {
    const current = this.store.getStep(planId, stepNumber);
    if (!current) {
      throw new Error(`Workflow step not found: plan=${planId}, step=${stepNumber}`);
    }
    if (current.status === "completed") {
      throw new Error(`A etapa ${stepNumber} do workflow #${planId} já está concluída.`);
    }

    this.store.updateStep({
      planId,
      stepNumber,
      status: "in_progress",
      notes: reason ?? current.notes ?? undefined,
    });
    this.store.setPlanStatus(planId, "active");
    const event = this.store.appendEvent({
      planId,
      stepNumber,
      eventType: "step_resumed",
      message: reason?.trim() || `Etapa ${stepNumber} retomada.`,
    });
    const plan = this.store.getPlan(planId);
    const step = this.store.getStep(planId, stepNumber);
    if (!plan || !step) {
      throw new Error(`Workflow state unavailable after resume: plan=${planId}, step=${stepNumber}`);
    }
    this.entityLinker?.upsertWorkflowRun(plan, event.message);
    return { plan, step, event };
  }

  resetStepToPending(planId: number, stepNumber: number, reason?: string): {
    plan: WorkflowPlanRecord;
    step: WorkflowStepRecord;
    event: WorkflowRuntimeEventRecord;
  } {
    const current = this.store.getStep(planId, stepNumber);
    if (!current) {
      throw new Error(`Workflow step not found: plan=${planId}, step=${stepNumber}`);
    }
    if (current.status === "completed") {
      throw new Error(`A etapa ${stepNumber} do workflow #${planId} já está concluída.`);
    }

    this.store.updateStep({
      planId,
      stepNumber,
      status: "pending",
      notes: reason ?? current.notes ?? undefined,
    });
    const event = this.store.appendEvent({
      planId,
      stepNumber,
      eventType: "step_resumed",
      message: reason?.trim() || `Etapa ${stepNumber} voltou para pendente.`,
    });
    const plan = this.store.getPlan(planId);
    const step = this.store.getStep(planId, stepNumber);
    if (!plan || !step) {
      throw new Error(`Workflow state unavailable after pending reset: plan=${planId}, step=${stepNumber}`);
    }
    this.entityLinker?.upsertWorkflowRun(plan, event.message);
    return { plan, step, event };
  }

  appendArtifactEvent(artifact: WorkflowArtifactRecord): WorkflowRuntimeEventRecord {
    return this.store.appendEvent({
      planId: artifact.planId,
      stepNumber: artifact.stepNumber,
      eventType: "step_completed",
      message: `Artefato registrado: ${artifact.title}.`,
    });
  }

  listEvents(planId: number, stepNumber?: number, limit = 20): WorkflowRuntimeEventRecord[] {
    return this.store.listEvents(planId, stepNumber, limit);
  }
}
