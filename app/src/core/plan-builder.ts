import type { LlmClient } from "../types/llm.js";
import type { Logger } from "../types/logger.js";
import type { OrchestrationContext, AgentDomain } from "../types/orchestration.js";
import type { CreateWorkflowPlanInput, WorkflowPlanRecord } from "../types/workflow.js";
import { WorkflowOrchestratorStore } from "./workflow-orchestrator.js";

function stripCodeFences(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export class WorkflowPlanBuilderService {
  constructor(
    private readonly client: LlmClient,
    private readonly workflows: WorkflowOrchestratorStore,
    private readonly logger: Logger,
  ) {}

  async createPlanFromPrompt(
    userPrompt: string,
    orchestration: OrchestrationContext,
    requestLogger?: Logger,
  ): Promise<WorkflowPlanRecord> {
    const fallbackInput = this.buildFallbackWorkflowPlanInput(userPrompt, orchestration);

    try {
      const response = await this.client.chat({
        messages: [
          {
            role: "system",
            content: [
              "Você é o orquestrador do Atlas Prime.",
              "Sua função é transformar um objetivo em um workflow executável multi-etapas.",
              "Responda somente JSON válido.",
              "Use estes domínios permitidos: orchestrator, assistente_social, secretario_operacional, social_media, dev_full_stack, analista_negocios_growth.",
              "Crie um plano pragmático com entre 4 e 8 etapas.",
              "Cada etapa deve ter: title, ownerDomain, taskType, objective, deliverable, successCriteria, dependsOn, suggestedTools.",
              "O plano deve ter: title, executiveSummary, primaryDomain, secondaryDomains, deliverables, nextAction, steps.",
              "Não inclua texto fora do JSON.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Objetivo: ${userPrompt}`,
              `Domínio principal atual: ${orchestration.route.primaryDomain}`,
              `Domínios secundários: ${orchestration.route.secondaryDomains.join(", ") || "nenhum"}`,
              `Modo de ação: ${orchestration.route.actionMode}`,
            ].join("\n"),
          },
        ],
      });

      const parsed = JSON.parse(stripCodeFences(response.message.content ?? "")) as Record<string, unknown>;
      const input = this.normalizeWorkflowPlanInput(parsed, userPrompt, orchestration, fallbackInput);
      return this.workflows.createPlan(input);
    } catch (error) {
      (requestLogger ?? this.logger).warn("Workflow plan generation fell back to deterministic plan", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.workflows.createPlan(fallbackInput);
    }
  }

  private normalizeWorkflowPlanInput(
    parsed: Record<string, unknown>,
    userPrompt: string,
    orchestration: OrchestrationContext,
    fallback: CreateWorkflowPlanInput,
  ): CreateWorkflowPlanInput {
    const allowedDomains = new Set<AgentDomain>([
      "orchestrator",
      "assistente_social",
      "secretario_operacional",
      "social_media",
      "dev_full_stack",
      "analista_negocios_growth",
    ]);

    const normalizeDomain = (value: unknown, backup: CreateWorkflowPlanInput["primaryDomain"]) =>
      typeof value === "string" && allowedDomains.has(value as AgentDomain)
        ? (value as CreateWorkflowPlanInput["primaryDomain"])
        : backup;

    const secondaryDomains: CreateWorkflowPlanInput["secondaryDomains"] = Array.isArray(parsed.secondaryDomains)
      ? parsed.secondaryDomains
          .filter((item): item is string => typeof item === "string" && allowedDomains.has(item as AgentDomain))
          .map((item) => item as CreateWorkflowPlanInput["primaryDomain"])
      : fallback.secondaryDomains ?? [];

    const rawSteps = Array.isArray(parsed.steps) ? parsed.steps : [];
    const steps: CreateWorkflowPlanInput["steps"] = [];
    rawSteps.forEach((item, index) => {
      if (!item || typeof item !== "object") {
        return;
      }
      const record = item as Record<string, unknown>;
      steps.push({
        title: typeof record.title === "string" ? record.title.trim() : `Etapa ${index + 1}`,
        ownerDomain: normalizeDomain(
          record.ownerDomain,
          fallback.steps[Math.min(index, fallback.steps.length - 1)]?.ownerDomain ?? fallback.primaryDomain,
        ),
        taskType: typeof record.taskType === "string" ? record.taskType.trim() : "execution",
        objective: typeof record.objective === "string" ? record.objective.trim() : `Avançar o objetivo: ${userPrompt}`,
        deliverable: typeof record.deliverable === "string" ? record.deliverable.trim() : "Entregável definido",
        successCriteria:
          typeof record.successCriteria === "string" ? record.successCriteria.trim() : "Etapa concluída com saída verificável",
        dependsOn: Array.isArray(record.dependsOn)
          ? record.dependsOn.map((value) => Number.parseInt(String(value), 10)).filter((value) => Number.isFinite(value))
          : [],
        suggestedTools: Array.isArray(record.suggestedTools)
          ? record.suggestedTools.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          : [],
        status: "pending" as const,
      });
    });
    const normalizedSteps = steps.slice(0, 8);

    return {
      title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : fallback.title,
      objective: userPrompt,
      executiveSummary:
        typeof parsed.executiveSummary === "string" && parsed.executiveSummary.trim()
          ? parsed.executiveSummary.trim()
          : fallback.executiveSummary,
      status: "draft",
      primaryDomain: normalizeDomain(parsed.primaryDomain, fallback.primaryDomain),
      secondaryDomains,
      deliverables: Array.isArray(parsed.deliverables)
        ? parsed.deliverables.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 8)
        : fallback.deliverables,
      nextAction:
        typeof parsed.nextAction === "string" && parsed.nextAction.trim()
          ? parsed.nextAction.trim()
          : fallback.nextAction,
      steps: normalizedSteps.length > 0 ? normalizedSteps : fallback.steps,
    };
  }

  private buildFallbackWorkflowPlanInput(
    userPrompt: string,
    orchestration: OrchestrationContext,
  ): CreateWorkflowPlanInput {
    const primary = orchestration.route.primaryDomain === "orchestrator"
      ? "analista_negocios_growth"
      : orchestration.route.primaryDomain;
    const secondary = orchestration.route.secondaryDomains;

    return {
      title: `Workflow Atlas Prime: ${userPrompt.slice(0, 72).trim()}`,
      objective: userPrompt,
      executiveSummary:
        "Plano orquestrado para decompor o objetivo em pesquisa, análise, execução, revisão e entrega com responsáveis claros.",
      status: "draft",
      primaryDomain: primary,
      secondaryDomains: secondary,
      deliverables: [
        "brief executivo",
        "backlog priorizado",
        "artefatos principais do objetivo",
      ],
      nextAction: "Validar o workflow, iniciar a etapa 1 e marcar o que já está pronto.",
      steps: [
        {
          title: "Descoberta e contexto",
          ownerDomain: "analista_negocios_growth",
          taskType: "research",
          objective: "Levantar contexto, restrições, público e sinais de valor.",
          deliverable: "brief de contexto",
          successCriteria: "Contexto e metas organizados com lacunas identificadas.",
          suggestedTools: ["web_search", "list_memory_items", "list_recent_emails"],
        },
        {
          title: "Plano operacional",
          ownerDomain: "orchestrator",
          taskType: "planning",
          objective: "Quebrar o objetivo em frentes, dependências e critérios de conclusão.",
          deliverable: "plano operacional por etapas",
          successCriteria: "Etapas, responsáveis e ordem definidos.",
          dependsOn: [1],
          suggestedTools: ["get_memory_summary"],
        },
        {
          title: "Execução da frente principal",
          ownerDomain: primary,
          taskType: "execution",
          objective: "Executar a frente principal do objetivo com base no plano.",
          deliverable: "entregável principal",
          successCriteria: "Entrega principal pronta para revisão.",
          dependsOn: [2],
          suggestedTools: ["safe_exec", "scan_project", "write_workspace_file"],
        },
        {
          title: "Distribuição e comunicação",
          ownerDomain: "social_media",
          taskType: "communication",
          objective: "Preparar mensagens, conteúdos e materiais de divulgação quando necessário.",
          deliverable: "copys, posts ou comunicações",
          successCriteria: "Materiais de comunicação alinhados ao objetivo.",
          dependsOn: [3],
          suggestedTools: ["export_content_calendar", "write_workspace_file"],
        },
        {
          title: "Fechamento e próximos passos",
          ownerDomain: "secretario_operacional",
          taskType: "coordination",
          objective: "Registrar entregas, pendências, follow-ups e compromissos derivados.",
          deliverable: "resumo final e próximos passos",
          successCriteria: "Nada crítico fica sem dono ou data.",
          dependsOn: [3, 4],
          suggestedTools: ["save_memory_item", "create_google_task", "create_calendar_event"],
        },
      ],
    };
  }
}
