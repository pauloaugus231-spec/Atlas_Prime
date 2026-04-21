import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AppConfig } from "../types/config.js";
import type { Logger } from "../types/logger.js";
import type { LlmClient } from "../types/llm.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type {
  CreateWorkflowPlanInput,
  WorkflowArtifactRecord,
  WorkflowPlanRecord,
  WorkflowStepRecord,
} from "../types/workflow.js";
import type { WorkflowOrchestratorStore } from "./workflow-orchestrator.js";
import { slugifySegment, stripCodeFences } from "./agent-core-helpers.js";

export interface WorkflowSupportServiceDependencies {
  config: AppConfig;
  client: LlmClient;
  workflows: WorkflowOrchestratorStore;
}

export interface WorkflowExecutionBriefPayload {
  summary: string;
  immediateActions: string[];
  risks: string[];
  outputs: string[];
  suggestedTools: string[];
  followUp: string;
}

export class WorkflowSupportService {
  constructor(private readonly deps: WorkflowSupportServiceDependencies) {}

  async createWorkflowPlanFromPrompt(
    userPrompt: string,
    orchestration: OrchestrationContext,
    requestLogger: Logger,
  ): Promise<WorkflowPlanRecord> {
    const fallbackInput = this.buildFallbackWorkflowPlanInput(userPrompt, orchestration);

    try {
      const response = await this.deps.client.chat({
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
      return this.deps.workflows.createPlan(input);
    } catch (error) {
      requestLogger.warn("Workflow plan generation fell back to deterministic plan", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.deps.workflows.createPlan(fallbackInput);
    }
  }

  async buildWorkflowExecutionBrief(
    plan: WorkflowPlanRecord,
    step: WorkflowStepRecord,
    requestLogger: Logger,
  ): Promise<{
    summary: string;
    immediateActions: string[];
    risks: string[];
    outputs: string[];
    suggestedTools: string[];
    followUp: string;
  }> {
    const completedSteps = plan.steps
      .filter((item) => item.status === "completed")
      .map((item) => `${item.stepNumber}. ${item.title}`)
      .slice(0, 8);

    const fallback = {
      summary: `Iniciar a etapa ${step.stepNumber} com foco em ${step.objective}.`,
      immediateActions: [
        `Validar o objetivo da etapa: ${step.objective}`,
        `Produzir o entregável esperado: ${step.deliverable}`,
        "Registrar decisões, lacunas e próximos passos no artefato da etapa.",
      ],
      risks: [
        "Escopo da etapa ficar aberto demais.",
        "Faltar dado ou contexto para concluir a entrega com qualidade.",
      ],
      outputs: [
        step.deliverable,
        "Checklist do que foi validado e do que ainda está pendente.",
      ],
      suggestedTools: step.suggestedTools,
      followUp: `Executar a etapa ${step.stepNumber}, registrar o resultado e marcar como concluída quando o critério de sucesso for atendido.`,
    };

    try {
      const response = await this.deps.client.chat({
        messages: [
          {
            role: "system",
            content: [
              "Você é o coordenador operacional do Atlas Prime.",
              "Gere um brief curto e executável para iniciar ou retomar uma etapa de workflow.",
              "Responda somente JSON válido.",
              "Formato: summary, immediateActions, risks, outputs, suggestedTools, followUp.",
              "Use linguagem pragmática e operacional.",
              "Limite immediateActions a 5 itens, risks a 4, outputs a 5.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Workflow: ${plan.title}`,
              `Resumo do workflow: ${plan.executiveSummary}`,
              `Etapa: ${step.stepNumber}. ${step.title}`,
              `Domínio dono: ${step.ownerDomain}`,
              `Objetivo da etapa: ${step.objective}`,
              `Entregável: ${step.deliverable}`,
              `Critério de sucesso: ${step.successCriteria}`,
              `Dependências: ${step.dependsOn.length ? step.dependsOn.join(", ") : "nenhuma"}`,
              `Etapas concluídas: ${completedSteps.join(" | ") || "nenhuma"}`,
              `Tools sugeridas: ${step.suggestedTools.join(", ") || "nenhuma"}`,
            ].join("\n"),
          },
        ],
      });

      const parsed = JSON.parse(stripCodeFences(response.message.content ?? "")) as Record<string, unknown>;
      return {
        summary: typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : fallback.summary,
        immediateActions: Array.isArray(parsed.immediateActions)
          ? parsed.immediateActions.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 5)
          : fallback.immediateActions,
        risks: Array.isArray(parsed.risks)
          ? parsed.risks.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 4)
          : fallback.risks,
        outputs: Array.isArray(parsed.outputs)
          ? parsed.outputs.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 5)
          : fallback.outputs,
        suggestedTools: Array.isArray(parsed.suggestedTools)
          ? parsed.suggestedTools.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 6)
          : fallback.suggestedTools,
        followUp: typeof parsed.followUp === "string" && parsed.followUp.trim() ? parsed.followUp.trim() : fallback.followUp,
      };
    } catch (error) {
      requestLogger.warn("Workflow execution brief fell back to deterministic brief", {
        planId: plan.id,
        stepNumber: step.stepNumber,
        error: error instanceof Error ? error.message : String(error),
      });
      return fallback;
    }
  }

  saveWorkflowExecutionArtifact(
    plan: WorkflowPlanRecord,
    step: WorkflowStepRecord,
    brief: {
      summary: string;
      immediateActions: string[];
      risks: string[];
      outputs: string[];
      suggestedTools: string[];
      followUp: string;
    },
  ): WorkflowArtifactRecord {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const workflowDir = path.join(
      this.deps.config.paths.workspaceDir,
      "reports",
      "workflows",
      `workflow-${plan.id}`,
    );
    mkdirSync(workflowDir, { recursive: true });

    const filename = `step-${step.stepNumber}-${slugifySegment(step.title)}-${timestamp}.md`;
    const filePath = path.join(workflowDir, filename);
    const content = [
      `# Workflow #${plan.id} - Etapa ${step.stepNumber}`,
      "",
      `## Título`,
      step.title,
      "",
      `## Domínio dono`,
      step.ownerDomain,
      "",
      `## Objetivo`,
      step.objective,
      "",
      `## Entregável esperado`,
      step.deliverable,
      "",
      `## Critério de sucesso`,
      step.successCriteria,
      "",
      `## Resumo operacional`,
      brief.summary,
      "",
      `## Ações imediatas`,
      ...brief.immediateActions.map((item) => `- ${item}`),
      "",
      `## Riscos`,
      ...brief.risks.map((item) => `- ${item}`),
      "",
      `## Saídas esperadas`,
      ...brief.outputs.map((item) => `- ${item}`),
      "",
      `## Tools sugeridas`,
      ...(brief.suggestedTools.length > 0 ? brief.suggestedTools : step.suggestedTools).map((item) => `- ${item}`),
      "",
      `## Próxima ação`,
      brief.followUp,
      "",
      `## Registrado em`,
      new Date().toISOString(),
      "",
    ].join("\n");

    writeFileSync(filePath, content, "utf8");
    return this.deps.workflows.saveArtifact({
      planId: plan.id,
      stepNumber: step.stepNumber,
      artifactType: "execution_brief",
      title: `Brief da etapa ${step.stepNumber}: ${step.title}`,
      summary: brief.summary,
      content,
      filePath,
    });
  }

  async generateWorkflowDomainDeliverable(
    plan: WorkflowPlanRecord,
    step: WorkflowStepRecord,
    brief: {
      summary: string;
      immediateActions: string[];
      risks: string[];
      outputs: string[];
      suggestedTools: string[];
      followUp: string;
    },
    requestLogger: Logger,
  ): Promise<{ artifact: WorkflowArtifactRecord; summary: string }> {
    const domainSpecs: Record<WorkflowStepRecord["ownerDomain"], { sections: string[]; guidance: string }> = {
      orchestrator: {
        sections: ["Resumo executivo", "Dependências", "Plano integrado", "Riscos", "Próximos passos"],
        guidance: "Produza um entregável de coordenação cross-functional, com plano integrado, checkpoints e handoffs claros.",
      },
      analista_negocios_growth: {
        sections: ["Mercado", "Hipóteses", "Concorrentes", "Experimentos", "KPIs", "Recomendação prática"],
        guidance: "Produza um artefato analítico de growth com hipóteses, sinais de demanda, concorrentes, experimentos e KPIs acionáveis.",
      },
      social_media: {
        sections: ["Mensagem central", "Pilares de conteúdo", "Campanha", "Peças", "CTAs", "Próximos passos"],
        guidance: "Produza um pacote de conteúdo e campanha pronto para execução, com mensagens, criativos e CTAs.",
      },
      dev_full_stack: {
        sections: ["Escopo técnico", "Arquitetura", "Backlog", "Plano de implementação", "Validação", "Riscos"],
        guidance: "Produza um entregável técnico executável: backlog, arquitetura, milestones e validações objetivas.",
      },
      secretario_operacional: {
        sections: ["Resumo operacional", "Compromissos", "Follow-ups", "Checklist", "Próximos passos"],
        guidance: "Produza um plano operacional de agenda, follow-up e execução administrativa com clareza de dono e prazo.",
      },
      assistente_social: {
        sections: ["Resumo do caso", "Encaminhamentos", "Documentos", "Cuidados", "Próximos passos"],
        guidance: "Produza um material formal e cuidadoso, sem extrapolar fatos, com foco em encaminhamento e registro responsável.",
      },
    };

    const spec = domainSpecs[step.ownerDomain] ?? domainSpecs.orchestrator;
    const fallbackTitle = `Entregável da etapa ${step.stepNumber}: ${step.title}`;
    const fallbackSummary = `Primeira versão do entregável da etapa ${step.stepNumber} pronta para revisão.`;
    const fallbackContent = [
      `# ${fallbackTitle}`,
      "",
      `## Resumo executivo`,
      brief.summary,
      "",
      `## Objetivo da etapa`,
      step.objective,
      "",
      `## Entregável esperado`,
      step.deliverable,
      "",
      `## Ações imediatas`,
      ...brief.immediateActions.map((item) => `- ${item}`),
      "",
      `## Riscos`,
      ...brief.risks.map((item) => `- ${item}`),
      "",
      `## Saídas esperadas`,
      ...brief.outputs.map((item) => `- ${item}`),
      "",
      `## Próximos passos`,
      brief.followUp,
      "",
    ].join("\n");

    let title = fallbackTitle;
    let summary = fallbackSummary;
    let content = fallbackContent;

    try {
      const response = await this.deps.client.chat({
        messages: [
          {
            role: "system",
            content: [
              "Você é um executor especialista do Atlas Prime.",
              "Gere um entregável real e útil para a etapa do workflow.",
              "Responda somente JSON válido.",
              "Formato: title, summary, content.",
              "O campo content deve ser Markdown pronto para uso.",
              spec.guidance,
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Workflow: ${plan.title}`,
              `Resumo do workflow: ${plan.executiveSummary}`,
              `Etapa: ${step.stepNumber}. ${step.title}`,
              `Domínio dono: ${step.ownerDomain}`,
              `Objetivo: ${step.objective}`,
              `Entregável esperado: ${step.deliverable}`,
              `Critério de sucesso: ${step.successCriteria}`,
              `Resumo operacional: ${brief.summary}`,
              `Ações imediatas: ${brief.immediateActions.join(" | ")}`,
              `Riscos: ${brief.risks.join(" | ")}`,
              `Saídas esperadas: ${brief.outputs.join(" | ")}`,
              `Seções obrigatórias: ${spec.sections.join(" | ")}`,
            ].join("\n"),
          },
        ],
      });

      const parsed = JSON.parse(stripCodeFences(response.message.content ?? "")) as Record<string, unknown>;
      title = typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : fallbackTitle;
      summary = typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : fallbackSummary;
      content = typeof parsed.content === "string" && parsed.content.trim() ? parsed.content.trim() : fallbackContent;
    } catch (error) {
      requestLogger.warn("Workflow deliverable generation fell back to deterministic artifact", {
        planId: plan.id,
        stepNumber: step.stepNumber,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const workflowDir = path.join(
      this.deps.config.paths.workspaceDir,
      "reports",
      "workflows",
      `workflow-${plan.id}`,
    );
    mkdirSync(workflowDir, { recursive: true });
    const filename = `step-${step.stepNumber}-deliverable-${slugifySegment(step.title)}-${timestamp}.md`;
    const filePath = path.join(workflowDir, filename);
    writeFileSync(filePath, content, "utf8");

    const artifact = this.deps.workflows.saveArtifact({
      planId: plan.id,
      stepNumber: step.stepNumber,
      artifactType: "deliverable",
      title,
      summary,
      content,
      filePath,
    });

    return {
      artifact,
      summary,
    };
  }

  private normalizeWorkflowPlanInput(
    parsed: Record<string, unknown>,
    userPrompt: string,
    orchestration: OrchestrationContext,
    fallback: CreateWorkflowPlanInput,
  ): CreateWorkflowPlanInput {
    const allowedDomains = new Set([
      "orchestrator",
      "assistente_social",
      "secretario_operacional",
      "social_media",
      "dev_full_stack",
      "analista_negocios_growth",
    ]);

    const normalizeDomain = (value: unknown, backup: CreateWorkflowPlanInput["primaryDomain"]) =>
      typeof value === "string" && allowedDomains.has(value) ? (value as CreateWorkflowPlanInput["primaryDomain"]) : backup;

    const secondaryDomains: CreateWorkflowPlanInput["secondaryDomains"] = Array.isArray(parsed.secondaryDomains)
      ? parsed.secondaryDomains
          .filter((item): item is string => typeof item === "string" && allowedDomains.has(item))
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
          ownerDomain: normalizeDomain(record.ownerDomain, fallback.steps[Math.min(index, fallback.steps.length - 1)]?.ownerDomain ?? fallback.primaryDomain),
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
