import type {
  IntentAnalysisContract,
  OrganizationResponseContract,
  ResponseContractKind,
  ResponseQualityAssessment,
} from "../types/response-contracts.js";

function compactBlankLines(lines: string[]): string[] {
  const compacted: string[] = [];
  for (const line of lines) {
    const previous = compacted[compacted.length - 1];
    if (line === "" && previous === "") {
      continue;
    }
    compacted.push(line.trimEnd());
  }
  return compacted;
}

function truncate(value: string, max = 96): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function labelActionMode(value: string): string {
  switch (value) {
    case "analyze":
      return "análise";
    case "plan":
      return "plano";
    case "execute":
      return "execução";
    case "communicate":
      return "comunicação";
    case "schedule":
      return "agenda";
    case "monitor":
      return "monitoramento";
    default:
      return value;
  }
}

export class ResponseOS {
  assess(kind: ResponseContractKind, text: string): ResponseQualityAssessment {
    const issues: string[] = [];
    const normalized = text.trim();
    if (!normalized) {
      issues.push("resposta_vazia");
    }
    if (normalized.includes("dominio principal detectado")) {
      issues.push("linguagem_interna_exposta");
    }
    if (kind !== "briefing" && normalized.length > 1800) {
      issues.push("resposta_longa_demais");
    }
    return {
      passed: issues.length === 0,
      issues,
    };
  }

  finalize(kind: ResponseContractKind, text: string): string {
    const normalized = compactBlankLines(text.replace(/\r\n/g, "\n").split("\n")).join("\n").trim();
    const assessment = this.assess(kind, normalized);
    if (assessment.issues.includes("linguagem_interna_exposta")) {
      return normalized.replace(/dominio principal detectado/gi, "sinais do pedido");
    }
    return normalized;
  }

  buildIntentAnalysisReply(input: IntentAnalysisContract): string {
    const lines = [
      "Leitura do pedido:",
      `- Objetivo inferido: ${truncate(input.objective, 120)}`,
      `- Domínio principal: ${input.primaryDomain}`,
      `- Domínios relacionados: ${input.mentionedDomains.join(", ") || input.primaryDomain}`,
      `- Modo recomendado: ${labelActionMode(input.actionMode)}`,
      `- Pedido composto: ${input.compound ? "sim" : "não"}`,
      `- Confiança: ${input.confidence.toFixed(2)}`,
    ];

    if (input.contextSignals.length > 0) {
      lines.push(
        `- Contexto útil disponível: ${input.contextSignals.slice(0, 4).join(" | ")}`,
      );
    }

    if (input.reasons.length > 0) {
      lines.push(`- Sinais usados: ${truncate(input.reasons.join(" | "), 180)}`);
    }

    if (input.recommendedNextStep) {
      lines.push(`- Próximo passo sugerido: ${truncate(input.recommendedNextStep, 140)}`);
    }

    return this.finalize("analysis", lines.join("\n"));
  }

  buildOrganizationReply(input: OrganizationResponseContract): string {
    const lines = [
      "Leitura operacional:",
      `- Objetivo: ${truncate(input.objective, 120)}`,
    ];

    if (input.currentSituation.length > 0) {
      lines.push("", "Situação agora:");
      for (const item of input.currentSituation.slice(0, 4)) {
        lines.push(`- ${truncate(item, 120)}`);
      }
    }

    if (input.priorities.length > 0) {
      lines.push("", "Prioridades:");
      for (const item of input.priorities.slice(0, 3)) {
        lines.push(`- ${truncate(item, 120)}`);
      }
    }

    if (input.actionPlan.length > 0) {
      lines.push("", "Plano curto:");
      for (const item of input.actionPlan.slice(0, 3)) {
        lines.push(`- ${truncate(item, 140)}`);
      }
    }

    if (input.recommendedNextStep) {
      lines.push("", `Próxima ação: ${truncate(input.recommendedNextStep, 140)}`);
    }

    return this.finalize("organization", lines.join("\n"));
  }
}
