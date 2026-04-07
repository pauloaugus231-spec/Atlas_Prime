import type { CapabilityDefinition, RiskLevel, SideEffect } from "../types/capability.js";

export interface ApprovalPolicyRule {
  risk: RiskLevel;
  sideEffects: SideEffect[];
  requiresApproval: boolean;
  rationale: string;
}

const ACTION_RULES: Record<string, ApprovalPolicyRule> = {
  email_reply: {
    risk: "high",
    sideEffects: ["send"],
    requiresApproval: true,
    rationale: "Envio externo por email exige confirmação humana.",
  },
  whatsapp_reply: {
    risk: "high",
    sideEffects: ["send"],
    requiresApproval: true,
    rationale: "Envio externo por WhatsApp exige confirmação humana.",
  },
  youtube_publish: {
    risk: "high",
    sideEffects: ["publish"],
    requiresApproval: true,
    rationale: "Publicação de conteúdo exige confirmação humana.",
  },
  create: {
    risk: "medium",
    sideEffects: ["schedule", "write"],
    requiresApproval: true,
    rationale: "Criação de evento altera agenda e exige confirmação.",
  },
  update: {
    risk: "high",
    sideEffects: ["schedule", "write"],
    requiresApproval: true,
    rationale: "Alteração de evento exige confirmação para evitar regressão operacional.",
  },
  delete: {
    risk: "high",
    sideEffects: ["schedule", "write"],
    requiresApproval: true,
    rationale: "Exclusão de evento exige confirmação humana.",
  },
  delete_batch: {
    risk: "critical",
    sideEffects: ["schedule", "write"],
    requiresApproval: true,
    rationale: "Exclusão em lote é ação crítica.",
  },
  create_batch: {
    risk: "high",
    sideEffects: ["schedule", "write"],
    requiresApproval: true,
    rationale: "Criação em lote altera agenda em escala.",
  },
  task_create: {
    risk: "medium",
    sideEffects: ["write", "schedule"],
    requiresApproval: true,
    rationale: "Criação de tarefa deve ser confirmada no estado atual do Atlas.",
  },
  google_event_import_batch: {
    risk: "critical",
    sideEffects: ["schedule", "write"],
    requiresApproval: true,
    rationale: "Importação de agenda em lote exige confirmação.",
  },
};

function inferFallbackRule(actionKind: string): ApprovalPolicyRule {
  const normalized = actionKind.trim().toLowerCase();
  if (normalized.includes("publish")) {
    return {
      risk: "high",
      sideEffects: ["publish"],
      requiresApproval: true,
      rationale: "Ação de publicação exige confirmação por padrão.",
    };
  }
  if (normalized.includes("reply") || normalized.includes("send")) {
    return {
      risk: "high",
      sideEffects: ["send"],
      requiresApproval: true,
      rationale: "Envio externo exige confirmação por padrão.",
    };
  }
  if (normalized.includes("delete")) {
    return {
      risk: "high",
      sideEffects: ["write"],
      requiresApproval: true,
      rationale: "Exclusão exige confirmação por padrão.",
    };
  }
  if (normalized.includes("exec")) {
    return {
      risk: "high",
      sideEffects: ["exec"],
      requiresApproval: true,
      rationale: "Execução remota exige confirmação por padrão.",
    };
  }

  return {
    risk: "medium",
    sideEffects: ["write"],
    requiresApproval: true,
    rationale: "Ação mutável usa confirmação por padrão.",
  };
}

export class ApprovalPolicyService {
  resolve(input: {
    actionKind: string;
    capability?: CapabilityDefinition | null;
  }): ApprovalPolicyRule {
    if (input.capability) {
      return {
        risk: input.capability.risk,
        sideEffects: input.capability.sideEffects,
        requiresApproval: input.capability.requiresApproval,
        rationale: `Policy derivada da capability ${input.capability.name}.`,
      };
    }

    return ACTION_RULES[input.actionKind] ?? inferFallbackRule(input.actionKind);
  }
}
