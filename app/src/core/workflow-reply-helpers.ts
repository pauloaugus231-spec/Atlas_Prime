import { normalizeEmailAnalysisText } from "../integrations/email/email-analysis.js";
import type { WorkflowArtifactRecord, WorkflowPlanRecord, WorkflowStepRecord } from "../types/workflow.js";

function includesAny(source: string, tokens: string[]): boolean {
  return tokens.some((token) => source.includes(token));
}

export function isWorkflowPlanningPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (
    isWorkflowListPrompt(prompt) ||
    isWorkflowShowPrompt(prompt) ||
    isWorkflowArtifactListPrompt(prompt) ||
    isWorkflowExecutionPrompt(prompt) ||
    isWorkflowStepUpdatePrompt(prompt)
  ) {
    return false;
  }
  return includesAny(normalized, [
    "plano orquestrado",
    "workflow",
    "orquestre",
    "orquestrar",
    "quebre em etapas",
    "de ponta a ponta",
    "plano de execucao",
    "plano de execução",
    "como sistema",
  ]);
}

export function isWorkflowListPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "liste workflows",
    "listar workflows",
    "meus workflows",
    "planos orquestrados",
    "liste meus planos",
    "mostre meus planos",
  ]);
}

export function isWorkflowShowPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "mostre o workflow",
    "abrir workflow",
    "detalhe do workflow",
    "etapas do workflow",
    "plano do workflow",
  ]) && /\bworkflow\s+\d+\b/i.test(prompt);
}

export function isWorkflowExecutionPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "inicie o workflow",
    "iniciar workflow",
    "retome o workflow",
    "retomar workflow",
    "execute o workflow",
    "executar workflow",
    "avance o workflow",
    "avancar workflow",
    "avançar workflow",
    "proxima etapa do workflow",
    "próxima etapa do workflow",
    "inicie a etapa",
    "retome a etapa",
    "execute a etapa",
    "executar a etapa",
  ]) && includesAny(normalized, ["workflow"]);
}

export function shouldAutoExecuteWorkflowDeliverable(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "execute o workflow",
    "executar workflow",
    "execute a etapa",
    "executar a etapa",
    "gere o entregavel",
    "gere o entregável",
    "produza o entregavel",
    "produza o entregável",
  ]);
}

export function isWorkflowArtifactListPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "artefatos do workflow",
    "artefatos da etapa",
    "liste os artefatos",
    "listar artefatos",
    "mostre os artefatos",
    "mostrar artefatos",
    "brief do workflow",
    "brief da etapa",
  ]) && includesAny(normalized, ["workflow"]);
}

export function isWorkflowStepUpdatePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "conclua a etapa",
    "concluir etapa",
    "marque a etapa",
    "bloqueie a etapa",
    "bloquear etapa",
    "etapa",
  ]) && includesAny(normalized, ["workflow"]) && includesAny(normalized, [
    "conclu",
    "finaliz",
    "done",
    "em andamento",
    "in progress",
    "in_progress",
    "bloquead",
    "bloqueie",
    "pendente",
  ]);
}

export function extractWorkflowPlanId(prompt: string): number | undefined {
  const match = prompt.match(/\bworkflow\s+(\d+)\b/i);
  if (!match) {
    return undefined;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function extractWorkflowStepNumber(prompt: string): number | undefined {
  const match = prompt.match(/\betapa\s+(\d+)\b/i);
  if (!match) {
    return undefined;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function extractWorkflowStepStatus(prompt: string): "pending" | "in_progress" | "waiting_approval" | "blocked" | "completed" | "failed" | undefined {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (includesAny(normalized, [
    "conclua",
    "concluir",
    "concluida",
    "concluída",
    "done",
    "finalize",
    "finalizar",
    "finalizada",
    "finalizado",
  ])) {
    return "completed";
  }
  if (includesAny(normalized, [
    "em andamento",
    "in progress",
    "in_progress",
    "inicie",
    "iniciar",
    "retome",
    "retomar",
  ])) {
    return "in_progress";
  }
  if (includesAny(normalized, [
    "aguardando aprovacao",
    "aguardando aprovação",
    "esperando aprovacao",
    "esperando aprovação",
    "waiting approval",
  ])) {
    return "waiting_approval";
  }
  if (includesAny(normalized, ["bloqueada", "bloqueado", "bloqueie", "bloquear"])) {
    return "blocked";
  }
  if (includesAny(normalized, ["falhou", "falhada", "falhado", "failed", "marque como falha"])) {
    return "failed";
  }
  if (includesAny(normalized, ["pendente", "volte para pendente"])) {
    return "pending";
  }
  return undefined;
}

export function buildWorkflowPlanReply(plan: WorkflowPlanRecord): string {
  const lines = [
    `Plano orquestrado #${plan.id}: ${plan.title}`,
    `- Domínio principal: ${plan.primaryDomain}`,
    `- Domínios secundários: ${plan.secondaryDomains.length ? plan.secondaryDomains.join(", ") : "nenhum"}`,
    `- Status: ${plan.status}`,
    `- Resumo: ${plan.executiveSummary}`,
  ];

  if (plan.deliverables.length > 0) {
    lines.push("- Entregáveis:", ...plan.deliverables.map((item) => `  - ${item}`));
  }

  lines.push("", "Etapas:");
  for (const step of plan.steps) {
    lines.push(
      `${step.stepNumber}. [${step.status}] ${step.title} | dono: ${step.ownerDomain} | entrega: ${step.deliverable}`,
    );
    if (step.dependsOn.length > 0) {
      lines.push(`   depende de: ${step.dependsOn.join(", ")}`);
    }
  }

  if (plan.nextAction) {
    lines.push("", `Próxima ação recomendada: ${plan.nextAction}`);
  }

  return lines.join("\n");
}

export function buildWorkflowListReply(plans: WorkflowPlanRecord[]): string {
  if (plans.length === 0) {
    return "Não encontrei workflows salvos.";
  }

  return [
    `Workflows salvos: ${plans.length}.`,
    ...plans.map((plan) => `- #${plan.id} | ${plan.title} | ${plan.status} | ${plan.primaryDomain}`),
  ].join("\n");
}

export function buildWorkflowStepUpdateReply(plan: WorkflowPlanRecord, stepNumber: number): string {
  const step = plan.steps.find((item) => item.stepNumber === stepNumber);
  if (!step) {
    return `Workflow #${plan.id} atualizado, mas não encontrei a etapa ${stepNumber} no retorno final.`;
  }
  return `Workflow #${plan.id} atualizado. Etapa ${step.stepNumber} agora está como ${step.status}: ${step.title}.`;
}

export function buildWorkflowExecutionReply(input: {
  plan: WorkflowPlanRecord;
  step: WorkflowStepRecord;
  artifact: WorkflowArtifactRecord;
  deliverableArtifact?: WorkflowArtifactRecord;
  deliverableSummary?: string;
  brief: {
    summary: string;
    immediateActions: string[];
    risks: string[];
    outputs: string[];
    suggestedTools: string[];
    followUp: string;
  };
}): string {
  const lines = [
    `Workflow #${input.plan.id} ativo.`,
    `Etapa em foco: ${input.step.stepNumber}. ${input.step.title}`,
    `- Dono: ${input.step.ownerDomain}`,
    `- Status: ${input.step.status}`,
    `- Objetivo: ${input.step.objective}`,
    `- Entregável: ${input.step.deliverable}`,
    `- Resumo operacional: ${input.brief.summary}`,
  ];

  if (input.brief.immediateActions.length > 0) {
    lines.push("- Ações imediatas:", ...input.brief.immediateActions.slice(0, 5).map((item) => `  - ${item}`));
  }
  if (input.brief.outputs.length > 0) {
    lines.push("- Saídas esperadas:", ...input.brief.outputs.slice(0, 5).map((item) => `  - ${item}`));
  }
  if (input.brief.risks.length > 0) {
    lines.push("- Riscos:", ...input.brief.risks.slice(0, 4).map((item) => `  - ${item}`));
  }
  if (input.brief.suggestedTools.length > 0) {
    lines.push(`- Tools sugeridas: ${input.brief.suggestedTools.join(", ")}`);
  }
  lines.push(`- Artefato salvo: ${input.artifact.filePath ?? `registro #${input.artifact.id}`}`);
  if (input.deliverableArtifact) {
    lines.push(`- Entregável gerado: ${input.deliverableArtifact.filePath ?? `registro #${input.deliverableArtifact.id}`}`);
    if (input.deliverableSummary) {
      lines.push(`- Resumo do entregável: ${input.deliverableSummary}`);
    }
  }
  lines.push(`- Próxima ação recomendada: ${input.brief.followUp}`);
  return lines.join("\n");
}

export function buildWorkflowArtifactsReply(plan: WorkflowPlanRecord, artifacts: WorkflowArtifactRecord[], stepNumber?: number): string {
  if (artifacts.length === 0) {
    return stepNumber
      ? `Não encontrei artefatos para a etapa ${stepNumber} do workflow #${plan.id}.`
      : `Não encontrei artefatos para o workflow #${plan.id}.`;
  }

  return [
    stepNumber
      ? `Artefatos da etapa ${stepNumber} do workflow #${plan.id}: ${artifacts.length}.`
      : `Artefatos do workflow #${plan.id}: ${artifacts.length}.`,
    ...artifacts.slice(0, 10).map((artifact) =>
      `- #${artifact.id} | ${artifact.artifactType} | ${artifact.title}${artifact.stepNumber ? ` | etapa ${artifact.stepNumber}` : ""}${artifact.filePath ? ` | ${artifact.filePath}` : ""}`,
    ),
  ].join("\n");
}
