import process from "node:process";
import { AgentCore } from "../src/core/agent-core.js";
import type { Logger } from "../src/types/logger.js";
import type { UserPreferences } from "../src/types/user-preferences.js";
import type { WorkflowArtifactRecord, WorkflowPlanRecord, WorkflowStepRecord } from "../src/types/workflow.js";

type EvalResult = {
  name: string;
  passed: boolean;
  detail?: string;
};

function assert(name: string, passed: boolean, detail?: string): EvalResult {
  return { name, passed, detail };
}

function makeLogger(): Logger {
  const logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => logger,
  } as unknown as Logger;
  return logger;
}

function buildOrchestration(): any {
  return {
    route: {
      primaryDomain: "secretario_operacional",
      secondaryDomains: ["orchestrator"],
      confidence: 0.9,
      actionMode: "assist",
      reasons: ["eval"],
    },
    policy: {
      riskLevel: "medium",
      autonomyLevel: "draft_with_confirmation",
      guardrails: [],
      requiresApprovalFor: [],
      capabilities: {
        canReadSensitiveChannels: true,
        canDraftExternalReplies: true,
        canSendExternalReplies: false,
        canWriteWorkspace: false,
        canPersistMemory: true,
        canRunProjectTools: true,
        canModifyCalendar: true,
        canPublishContent: false,
      },
    },
  };
}

function buildPreferences(): UserPreferences {
  return {
    responseStyle: "executive",
    responseLength: "medium",
    proactiveNextStep: false,
    autoSourceFallback: false,
    preferredAgentName: "Atlas",
  };
}

function buildPlan(): WorkflowPlanRecord {
  return {
    id: 11,
    title: "Workflow de teste",
    objective: "organizar entrega",
    executiveSummary: "Resumo teste",
    status: "draft",
    primaryDomain: "secretario_operacional",
    secondaryDomains: ["orchestrator"],
    deliverables: ["brief"],
    nextAction: "iniciar etapa 1",
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
    steps: [
      {
        planId: 11,
        stepNumber: 1,
        title: "Mapear contexto",
        ownerDomain: "secretario_operacional",
        taskType: "research",
        objective: "entender situação",
        deliverable: "brief inicial",
        successCriteria: "contexto definido",
        dependsOn: [],
        suggestedTools: ["web_search"],
        status: "pending",
        notes: null,
      },
    ],
  };
}

function buildCoreStub() {
  const core = Object.create(AgentCore.prototype) as AgentCore;
  const logger = makeLogger();
  const plan = buildPlan();
  const artifact: WorkflowArtifactRecord = {
    id: 21,
    planId: 11,
    stepNumber: 1,
    artifactType: "execution_brief",
    title: "Brief da etapa 1",
    summary: "Resumo da etapa",
    content: "conteúdo",
    filePath: "/tmp/workflow-brief.md",
    createdAt: "2026-04-20T00:00:00.000Z",
  };
  const deliverableArtifact: WorkflowArtifactRecord = {
    id: 22,
    planId: 11,
    stepNumber: 1,
    artifactType: "deliverable",
    title: "Entregável da etapa 1",
    summary: "entregável pronto",
    content: "conteúdo final",
    filePath: "/tmp/workflow-deliverable.md",
    createdAt: "2026-04-20T00:00:00.000Z",
  };
  const planningCalls: string[] = [];
  const linkedPlans: Array<{ id: number; event?: string | null }> = [];
  const briefCalls: number[] = [];
  const artifactCalls: number[] = [];
  const deliverableCalls: number[] = [];
  const savedArtifacts: Array<Record<string, unknown>> = [];
  const runtimeTransitions: string[] = [];

  (core as any).logger = logger;
  (core as any).planBuilder = {
    createPlanFromPrompt: async (prompt: string) => {
      planningCalls.push(prompt);
      return plan;
    },
  };
  (core as any).entityLinker = {
    upsertWorkflowRun: (storedPlan: WorkflowPlanRecord, event?: string | null) => {
      linkedPlans.push({ id: storedPlan.id, event });
      return undefined;
    },
  };
  (core as any).workflows = {
    listPlans: () => [plan],
    latestPlan: () => plan,
    getPlan: () => plan,
    listArtifacts: () => [artifact],
    saveArtifact: (input: Record<string, unknown>) => {
      savedArtifacts.push(input);
      return {
        ...artifact,
        id: 23,
        artifactType: "status_update",
        title: String(input.title),
        summary: String(input.summary),
        content: String(input.content),
        filePath: null,
      } satisfies WorkflowArtifactRecord;
    },
  };
  (core as any).workflowRuntime = {
    startStep: () => {
      runtimeTransitions.push("start");
      return { plan, step: plan.steps[0] as WorkflowStepRecord };
    },
    completeStep: () => {
      runtimeTransitions.push("completed");
      return { plan, step: { ...plan.steps[0], status: "completed" as const } };
    },
    blockStep: () => {
      runtimeTransitions.push("blocked");
      return { plan, step: { ...plan.steps[0], status: "blocked" as const } };
    },
    failStep: () => {
      runtimeTransitions.push("failed");
      return { plan, step: { ...plan.steps[0], status: "failed" as const } };
    },
    markWaitingApproval: () => {
      runtimeTransitions.push("waiting_approval");
      return { plan, step: { ...plan.steps[0], status: "waiting_approval" as const } };
    },
    resetStepToPending: () => {
      runtimeTransitions.push("pending");
      return { plan, step: { ...plan.steps[0], status: "pending" as const } };
    },
    resumeStep: () => {
      runtimeTransitions.push("in_progress");
      return { plan, step: { ...plan.steps[0], status: "in_progress" as const } };
    },
  };
  (core as any).buildWorkflowExecutionBrief = async (_plan: WorkflowPlanRecord, step: WorkflowStepRecord) => {
    briefCalls.push(step.stepNumber);
    return {
      summary: "Brief objetivo",
      immediateActions: ["primeiro passo"],
      risks: ["risco"],
      outputs: ["saída"],
      suggestedTools: ["web_search"],
      followUp: "seguir para a execução",
    };
  };
  (core as any).saveWorkflowExecutionArtifact = (_plan: WorkflowPlanRecord, step: WorkflowStepRecord) => {
    artifactCalls.push(step.stepNumber);
    return artifact;
  };
  (core as any).generateWorkflowDomainDeliverable = async (_plan: WorkflowPlanRecord, step: WorkflowStepRecord) => {
    deliverableCalls.push(step.stepNumber);
    return {
      artifact: deliverableArtifact,
      summary: "entregável pronto",
    };
  };

  return {
    core,
    planningCalls,
    linkedPlans,
    briefCalls,
    artifactCalls,
    deliverableCalls,
    savedArtifacts,
    runtimeTransitions,
  };
}

async function run(): Promise<void> {
  const results: EvalResult[] = [];
  const {
    core,
    planningCalls,
    linkedPlans,
    briefCalls,
    artifactCalls,
    deliverableCalls,
    savedArtifacts,
    runtimeTransitions,
  } = buildCoreStub();
  const orchestration = buildOrchestration();
  const preferences = buildPreferences();
  const logger = makeLogger();

  {
    const result = await (core as any).tryRunDirectWorkflowPlanning(
      "planeje um workflow para organizar a entrega",
      "req-phase16-workflow-plan",
      logger,
      orchestration,
      preferences,
    );

    results.push(assert(
      "agent_core_workflow_planning_wrapper_uses_workflow_direct_service",
      Boolean(
        result?.reply?.includes("Plano orquestrado #11") &&
        planningCalls.length === 1 &&
        linkedPlans[0]?.id === 11 &&
        result.toolExecutions[0]?.toolName === "workflow_plan",
      ),
      result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectWorkflowExecution(
      "execute o workflow 11 e gere o entregável",
      "req-phase16-workflow-exec",
      logger,
      orchestration,
      preferences,
    );

    results.push(assert(
      "agent_core_workflow_execution_wrapper_uses_workflow_direct_service",
      Boolean(
        result?.reply?.includes("Workflow #11") &&
        runtimeTransitions.includes("start") &&
        briefCalls.includes(1) &&
        artifactCalls.includes(1) &&
        deliverableCalls.includes(1) &&
        result.toolExecutions[0]?.toolName === "workflow_execution",
      ),
      JSON.stringify({ runtimeTransitions, briefCalls, artifactCalls, deliverableCalls }),
    ));
  }

  {
    const result = await (core as any).tryRunDirectWorkflowArtifacts(
      "liste os artefatos do workflow 11",
      "req-phase16-workflow-artifacts",
      orchestration,
      preferences,
    );

    results.push(assert(
      "agent_core_workflow_artifacts_wrapper_uses_workflow_direct_service",
      Boolean(
        result?.reply?.includes("Artefatos do workflow #11") &&
        result.reply.includes("Brief da etapa 1") &&
        result.toolExecutions.length === 0,
      ),
      result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectWorkflowStepUpdate(
      "marque a etapa 1 do workflow 11 como concluída",
      "req-phase16-workflow-update",
      orchestration,
      preferences,
    );

    results.push(assert(
      "agent_core_workflow_step_update_wrapper_uses_workflow_direct_service",
      Boolean(
        typeof result?.reply === "string" &&
        runtimeTransitions.includes("completed") &&
        savedArtifacts.length === 1 &&
        String(savedArtifacts[0]?.artifactType) === "status_update",
      ),
      JSON.stringify({ runtimeTransitions, savedArtifacts }),
    ));
  }

  const failed = results.filter((item) => !item.passed);
  for (const result of results) {
    const prefix = result.passed ? "PASS" : "FAIL";
    const suffix = result.detail ? ` :: ${result.detail}` : "";
    console.log(`${prefix} ${result.name}${suffix}`);
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("eval-agent-core-phase16 failed", error);
  process.exitCode = 1;
});
