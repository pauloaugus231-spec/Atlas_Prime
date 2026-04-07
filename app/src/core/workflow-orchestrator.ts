import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../types/logger.js";
import type {
  CreateWorkflowPlanInput,
  SaveWorkflowArtifactInput,
  WorkflowArtifactRecord,
  WorkflowArtifactType,
  UpdateWorkflowStepInput,
  WorkflowPlanRecord,
  WorkflowStatus,
  WorkflowStepRecord,
  WorkflowStepStatus,
} from "../types/workflow.js";
import type { AgentDomain } from "../types/orchestration.js";
import type { WorkflowRuntimeEventRecord, WorkflowRuntimeEventType } from "../types/workflow-events.js";

type SqlValue = string | number | null;

function sleepSync(milliseconds: number): void {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, milliseconds);
}

function isRetryableSqliteOpenError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("disk i/o error")
    || message.includes("database is locked")
    || message.includes("busy");
}

function parseJsonArray<T>(value: unknown): T[] {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function normalizeText(value: string | null | undefined, fallback = ""): string {
  const normalized = value?.trim();
  return normalized || fallback;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeWorkflowStatus(value: string | null | undefined): WorkflowStatus {
  return value === "active"
    || value === "paused"
    || value === "waiting_approval"
    || value === "blocked"
    || value === "completed"
    || value === "failed"
    ? value
    : "draft";
}

function normalizeStepStatus(value: string | null | undefined): WorkflowStepStatus {
  return value === "in_progress"
    || value === "waiting_approval"
    || value === "blocked"
    || value === "completed"
    || value === "failed"
    || value === "skipped"
    ? value
    : "pending";
}

function mapStep(row: Record<string, unknown>): WorkflowStepRecord {
  return {
    planId: Number(row.plan_id),
    stepNumber: Number(row.step_number),
    title: String(row.title),
    ownerDomain: String(row.owner_domain) as AgentDomain,
    taskType: String(row.task_type),
    objective: String(row.objective),
    deliverable: String(row.deliverable),
    successCriteria: String(row.success_criteria),
    dependsOn: parseJsonArray<number>(row.depends_on_json),
    suggestedTools: parseJsonArray<string>(row.suggested_tools_json),
    status: normalizeStepStatus(row.status == null ? undefined : String(row.status)),
    notes: row.notes == null ? null : String(row.notes),
  };
}

function mapPlan(
  row: Record<string, unknown>,
  steps: WorkflowStepRecord[],
): WorkflowPlanRecord {
  return {
    id: Number(row.id),
    title: String(row.title),
    objective: String(row.objective),
    executiveSummary: String(row.executive_summary),
    status: normalizeWorkflowStatus(row.status == null ? undefined : String(row.status)),
    primaryDomain: String(row.primary_domain) as AgentDomain,
    secondaryDomains: parseJsonArray<AgentDomain>(row.secondary_domains_json),
    deliverables: parseJsonArray<string>(row.deliverables_json),
    nextAction: row.next_action == null ? null : String(row.next_action),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    steps,
  };
}

function mapArtifact(row: Record<string, unknown>): WorkflowArtifactRecord {
  return {
    id: Number(row.id),
    planId: Number(row.plan_id),
    stepNumber: row.step_number == null ? null : Number(row.step_number),
    artifactType: String(row.artifact_type) as WorkflowArtifactType,
    title: String(row.title),
    summary: String(row.summary),
    content: String(row.content),
    filePath: row.file_path == null ? null : String(row.file_path),
    createdAt: String(row.created_at),
  };
}

function mapEvent(row: Record<string, unknown>): WorkflowRuntimeEventRecord {
  return {
    id: Number(row.id),
    planId: Number(row.plan_id),
    stepNumber: row.step_number == null ? null : Number(row.step_number),
    eventType: String(row.event_type) as WorkflowRuntimeEventType,
    message: String(row.message),
    createdAt: String(row.created_at),
  };
}

export class WorkflowOrchestratorStore {
  private readonly db!: DatabaseSync;

  constructor(
    private readonly dbPath: string,
    private readonly logger: Logger,
  ) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        this.db = new DatabaseSync(dbPath);
        this.db.exec(`
          PRAGMA journal_mode = WAL;
          PRAGMA synchronous = NORMAL;
          PRAGMA busy_timeout = 5000;
        `);
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS workflow_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            objective TEXT NOT NULL,
            executive_summary TEXT NOT NULL,
            status TEXT NOT NULL,
            primary_domain TEXT NOT NULL,
            secondary_domains_json TEXT NOT NULL,
            deliverables_json TEXT NOT NULL,
            next_action TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS workflow_steps (
            plan_id INTEGER NOT NULL,
            step_number INTEGER NOT NULL,
            title TEXT NOT NULL,
            owner_domain TEXT NOT NULL,
            task_type TEXT NOT NULL,
            objective TEXT NOT NULL,
            deliverable TEXT NOT NULL,
            success_criteria TEXT NOT NULL,
            depends_on_json TEXT NOT NULL,
            suggested_tools_json TEXT NOT NULL,
            status TEXT NOT NULL,
            notes TEXT,
            PRIMARY KEY (plan_id, step_number),
            FOREIGN KEY (plan_id) REFERENCES workflow_plans(id) ON DELETE CASCADE
          );

          CREATE TABLE IF NOT EXISTS workflow_artifacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plan_id INTEGER NOT NULL,
            step_number INTEGER,
            artifact_type TEXT NOT NULL,
            title TEXT NOT NULL,
            summary TEXT NOT NULL,
            content TEXT NOT NULL,
            file_path TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (plan_id) REFERENCES workflow_plans(id) ON DELETE CASCADE
          );

          CREATE TABLE IF NOT EXISTS workflow_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plan_id INTEGER NOT NULL,
            step_number INTEGER,
            event_type TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (plan_id) REFERENCES workflow_plans(id) ON DELETE CASCADE
          );
        `);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (attempt === 3 || !isRetryableSqliteOpenError(error)) {
          throw error;
        }
        this.logger.warn("Retrying workflow orchestrator SQLite open", {
          dbPath,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
        sleepSync(150 * attempt);
      }
    }
    if (lastError) {
      throw lastError;
    }
    this.logger.info("Workflow orchestrator ready", { dbPath });
  }

  createPlan(input: CreateWorkflowPlanInput): WorkflowPlanRecord {
    if (input.steps.length === 0) {
      throw new Error("Workflow plan requires at least one step.");
    }

    const now = new Date().toISOString();
    let planId = 0;
    try {
      this.db.exec("BEGIN");
      const insertedPlan = this.db.prepare(`
        INSERT INTO workflow_plans (
          title, objective, executive_summary, status, primary_domain,
          secondary_domains_json, deliverables_json, next_action, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *
      `).get(
        normalizeText(input.title),
        normalizeText(input.objective),
        normalizeText(input.executiveSummary),
        input.status ?? "draft",
        input.primaryDomain,
        JSON.stringify(input.secondaryDomains ?? []),
        JSON.stringify(input.deliverables ?? []),
        normalizeNullableText(input.nextAction),
        now,
        now,
      ) as Record<string, unknown>;

      planId = Number(insertedPlan.id);
      const insertStep = this.db.prepare(`
        INSERT INTO workflow_steps (
          plan_id, step_number, title, owner_domain, task_type, objective,
          deliverable, success_criteria, depends_on_json, suggested_tools_json, status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      input.steps.forEach((step, index) => {
        insertStep.run(
          planId,
          index + 1,
          normalizeText(step.title),
          step.ownerDomain,
          normalizeText(step.taskType, "execution"),
          normalizeText(step.objective),
          normalizeText(step.deliverable),
          normalizeText(step.successCriteria),
          JSON.stringify(step.dependsOn ?? []),
          JSON.stringify(step.suggestedTools ?? []),
          step.status ?? "pending",
          normalizeNullableText(step.notes),
        );
      });
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // ignore rollback error
      }
      throw error;
    }

    const created = this.getPlan(planId);
    if (!created) {
      throw new Error(`Failed to load created workflow plan ${planId}`);
    }
    return created;
  }

  getPlan(planId: number): WorkflowPlanRecord | null {
    const planRow = this.db
      .prepare("SELECT * FROM workflow_plans WHERE id = ?")
      .get(planId) as Record<string, unknown> | undefined;
    if (!planRow) {
      return null;
    }

    const steps = this.db
      .prepare("SELECT * FROM workflow_steps WHERE plan_id = ? ORDER BY step_number ASC")
      .all(planId) as Array<Record<string, unknown>>;

    return mapPlan(planRow, steps.map((step) => mapStep(step)));
  }

  listPlans(limit = 10): WorkflowPlanRecord[] {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const rows = this.db
      .prepare("SELECT * FROM workflow_plans ORDER BY updated_at DESC, id DESC LIMIT ?")
      .all(safeLimit) as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const steps = this.db
        .prepare("SELECT * FROM workflow_steps WHERE plan_id = ? ORDER BY step_number ASC")
        .all(Number(row.id)) as Array<Record<string, unknown>>;
      return mapPlan(row, steps.map((step) => mapStep(step)));
    });
  }

  updateStep(input: UpdateWorkflowStepInput): WorkflowStepRecord {
    const assignments: string[] = [];
    const params: SqlValue[] = [];

    if (input.status) {
      assignments.push("status = ?");
      params.push(input.status);
    }
    if (input.notes !== undefined) {
      assignments.push("notes = ?");
      params.push(normalizeNullableText(input.notes));
    }
    if (assignments.length === 0) {
      throw new Error("No workflow step fields provided for update.");
    }

    params.push(input.planId, input.stepNumber);
    const row = this.db.prepare(`
      UPDATE workflow_steps
      SET ${assignments.join(", ")}
      WHERE plan_id = ? AND step_number = ?
      RETURNING *
    `).get(...params) as Record<string, unknown> | undefined;

    if (!row) {
      throw new Error(`Workflow step not found: plan=${input.planId}, step=${input.stepNumber}`);
    }

    this.db
      .prepare("UPDATE workflow_plans SET updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), input.planId);
    this.refreshPlanStatus(input.planId);

    return mapStep(row);
  }

  setPlanStatus(planId: number, status: WorkflowStatus): WorkflowPlanRecord {
    const row = this.db.prepare(`
      UPDATE workflow_plans
      SET status = ?, updated_at = ?
      WHERE id = ?
      RETURNING *
    `).get(
      status,
      new Date().toISOString(),
      planId,
    ) as Record<string, unknown> | undefined;

    if (!row) {
      throw new Error(`Workflow plan not found: ${planId}`);
    }

    const plan = this.getPlan(planId);
    if (!plan) {
      throw new Error(`Workflow plan not found after status update: ${planId}`);
    }
    return plan;
  }

  getStep(planId: number, stepNumber: number): WorkflowStepRecord | null {
    const row = this.db
      .prepare("SELECT * FROM workflow_steps WHERE plan_id = ? AND step_number = ?")
      .get(planId, stepNumber) as Record<string, unknown> | undefined;
    return row ? mapStep(row) : null;
  }

  getActiveStep(planId: number): WorkflowStepRecord | null {
    const row = this.db
      .prepare("SELECT * FROM workflow_steps WHERE plan_id = ? AND status = 'in_progress' ORDER BY step_number ASC LIMIT 1")
      .get(planId) as Record<string, unknown> | undefined;
    return row ? mapStep(row) : null;
  }

  getNextActionableStep(planId: number): WorkflowStepRecord | null {
    const plan = this.getPlan(planId);
    if (!plan) {
      return null;
    }
    for (const step of plan.steps) {
      if (step.status !== "pending") {
        continue;
      }
      const dependenciesCompleted = step.dependsOn.every((dependency) => {
        const dependencyStep = plan.steps.find((candidate) => candidate.stepNumber === dependency);
        return dependencyStep?.status === "completed";
      });
      if (dependenciesCompleted) {
        return step;
      }
    }
    return null;
  }

  activateStep(planId: number, stepNumber?: number): { plan: WorkflowPlanRecord; step: WorkflowStepRecord } {
    const plan = this.getPlan(planId);
    if (!plan) {
      throw new Error(`Workflow plan not found: ${planId}`);
    }

    const activeStep = plan.steps.find((step) => step.status === "in_progress");
    if (!stepNumber && activeStep) {
      const updatedPlan = this.setPlanStatus(planId, "active");
      return {
        plan: updatedPlan,
        step: updatedPlan.steps.find((step) => step.stepNumber === activeStep.stepNumber) ?? activeStep,
      };
    }

    const targetStep = stepNumber
      ? plan.steps.find((step) => step.stepNumber === stepNumber) ?? null
      : this.getNextActionableStep(planId);
    if (!targetStep) {
      if (plan.steps.every((step) => step.status === "completed")) {
        this.setPlanStatus(planId, "completed");
        throw new Error(`Workflow #${planId} já está concluído.`);
      }
      throw new Error(`Não encontrei uma etapa acionável no workflow #${planId}.`);
    }

    if (targetStep.status === "completed") {
      throw new Error(`A etapa ${targetStep.stepNumber} do workflow #${planId} já está concluída.`);
    }

    const dependenciesCompleted = targetStep.dependsOn.every((dependency) => {
      const dependencyStep = plan.steps.find((candidate) => candidate.stepNumber === dependency);
      return dependencyStep?.status === "completed";
    });
    if (!dependenciesCompleted) {
      throw new Error(`A etapa ${targetStep.stepNumber} ainda depende de outras etapas concluídas.`);
    }

    if (activeStep && activeStep.stepNumber !== targetStep.stepNumber) {
      throw new Error(`Já existe uma etapa em andamento no workflow #${planId}: etapa ${activeStep.stepNumber}.`);
    }

    if (targetStep.status !== "in_progress") {
      this.updateStep({
        planId,
        stepNumber: targetStep.stepNumber,
        status: "in_progress",
      });
    } else {
      this.setPlanStatus(planId, "active");
    }

    const updatedPlan = this.getPlan(planId);
    if (!updatedPlan) {
      throw new Error(`Workflow plan not found after activation: ${planId}`);
    }
    const updatedStep = updatedPlan.steps.find((step) => step.stepNumber === targetStep.stepNumber);
    if (!updatedStep) {
      throw new Error(`Workflow step not found after activation: plan=${planId}, step=${targetStep.stepNumber}`);
    }
    return {
      plan: updatedPlan,
      step: updatedStep,
    };
  }

  saveArtifact(input: SaveWorkflowArtifactInput): WorkflowArtifactRecord {
    const row = this.db.prepare(`
      INSERT INTO workflow_artifacts (
        plan_id, step_number, artifact_type, title, summary, content, file_path, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      input.planId,
      input.stepNumber ?? null,
      input.artifactType,
      normalizeText(input.title),
      normalizeText(input.summary),
      normalizeText(input.content),
      normalizeNullableText(input.filePath),
      new Date().toISOString(),
    ) as Record<string, unknown> | undefined;

    if (!row) {
      throw new Error(`Failed to save artifact for workflow #${input.planId}`);
    }

    this.db
      .prepare("UPDATE workflow_plans SET updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), input.planId);

    return mapArtifact(row);
  }

  listArtifacts(planId: number, stepNumber?: number): WorkflowArtifactRecord[] {
    const rows = stepNumber
      ? this.db.prepare(`
          SELECT * FROM workflow_artifacts
          WHERE plan_id = ? AND step_number = ?
          ORDER BY created_at DESC, id DESC
        `).all(planId, stepNumber)
      : this.db.prepare(`
          SELECT * FROM workflow_artifacts
          WHERE plan_id = ?
          ORDER BY created_at DESC, id DESC
        `).all(planId);

    return (rows as Array<Record<string, unknown>>).map((row) => mapArtifact(row));
  }

  appendEvent(input: {
    planId: number;
    stepNumber?: number | null;
    eventType: WorkflowRuntimeEventType;
    message: string;
  }): WorkflowRuntimeEventRecord {
    const row = this.db.prepare(`
      INSERT INTO workflow_events (
        plan_id, step_number, event_type, message, created_at
      ) VALUES (?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      input.planId,
      input.stepNumber ?? null,
      input.eventType,
      normalizeText(input.message),
      new Date().toISOString(),
    ) as Record<string, unknown> | undefined;

    if (!row) {
      throw new Error(`Failed to append event for workflow #${input.planId}`);
    }

    this.db
      .prepare("UPDATE workflow_plans SET updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), input.planId);

    return mapEvent(row);
  }

  listEvents(planId: number, stepNumber?: number, limit = 20): WorkflowRuntimeEventRecord[] {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const rows = stepNumber
      ? this.db.prepare(`
          SELECT * FROM workflow_events
          WHERE plan_id = ? AND step_number = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `).all(planId, stepNumber, safeLimit)
      : this.db.prepare(`
          SELECT * FROM workflow_events
          WHERE plan_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `).all(planId, safeLimit);

    return (rows as Array<Record<string, unknown>>).map((row) => mapEvent(row));
  }

  latestPlan(): WorkflowPlanRecord | null {
    const row = this.db
      .prepare("SELECT id FROM workflow_plans ORDER BY updated_at DESC, id DESC LIMIT 1")
      .get() as { id?: number } | undefined;
    return row?.id ? this.getPlan(Number(row.id)) : null;
  }

  private refreshPlanStatus(planId: number): void {
    const plan = this.getPlan(planId);
    if (!plan) {
      return;
    }

    let nextStatus: WorkflowStatus = plan.status;
    if (plan.steps.length > 0 && plan.steps.every((step) => step.status === "completed" || step.status === "skipped")) {
      nextStatus = "completed";
    } else if (plan.steps.some((step) => step.status === "failed")) {
      nextStatus = "failed";
    } else if (plan.steps.some((step) => step.status === "waiting_approval")) {
      nextStatus = "waiting_approval";
    } else if (plan.steps.some((step) => step.status === "blocked")) {
      nextStatus = "blocked";
    } else if (plan.steps.some((step) => step.status === "in_progress" || step.status === "completed")) {
      nextStatus = "active";
    } else {
      nextStatus = "draft";
    }

    if (nextStatus !== plan.status) {
      this.db
        .prepare("UPDATE workflow_plans SET status = ?, updated_at = ? WHERE id = ?")
        .run(nextStatus, new Date().toISOString(), planId);
    }
  }
}
