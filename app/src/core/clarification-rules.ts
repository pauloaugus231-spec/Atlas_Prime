import type { IntentResolution } from "./intent-router.js";

export interface ClarificationRuleProposal {
  objectiveSummary: string;
  rationale: string;
  questions: string[];
  executionPrompt?: string;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(source: string, tokens: string[]): boolean {
  return tokens.some((token) => source.includes(token));
}

function isSupportPrompt(normalized: string): boolean {
  return includesAny(normalized, ["suporte", "ticket", "tickets", "cliente", "clientes", "atendimento"]);
}

export function looksLikeCalendarDeletePrompt(prompt: string): boolean {
  const normalized = normalize(prompt);
  const hasDeleteVerb = includesAny(normalized, [
    "cancele",
    "cancela",
    "cancelar",
    "exclua",
    "excluir",
    "delete",
    "apague",
    "apagar",
    "remova",
    "remover",
  ]);
  const hasCalendarObject = includesAny(normalized, [
    "evento",
    "compromisso",
    "agenda",
    "calendario",
    "calendário",
    "reuniao",
    "reunião",
  ]);
  return hasDeleteVerb && hasCalendarObject;
}

function normalizeAnswer(answerText: string): string {
  return answerText
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "");
}

function buildSecretaryProposal(prompt: string, intent: IntentResolution): ClarificationRuleProposal | null {
  const normalized = normalize(prompt);
  const hasAgenda = includesAny(normalized, ["agenda", "compromiss", "calendario", "calendário", "dia"]);
  const hasApprovals = includesAny(normalized, ["aprova", "approval"]);
  const hasToday = includesAny(normalized, ["hoje", "amanha", "amanhã"]);
  const hasWeek = includesAny(normalized, ["semana"]);

  if (hasAgenda && hasApprovals) {
    const questions: string[] = [];
    if (!hasToday && !hasWeek) {
      questions.push("Quer olhar a agenda de hoje ou da semana?");
    }
    questions.push("Nas aprovações, você quer só revisar ou já quer que eu priorize as que exigem ação agora?");

    return {
      objectiveSummary: "revisar aprovações e reorganizar a rotina operacional",
      rationale: "O pedido mistura agenda e aprovações. Falta fechar a janela e o nível de ação para eu devolver um plano certo.",
      questions: questions.slice(0, 2),
      executionPrompt: questions.length === 1
        ? `Revise as aprovações pendentes e organize ${hasWeek ? "a agenda da semana" : "a agenda de hoje"}, considerando este ajuste do usuário: ${normalizeAnswer(prompt)}.`
        : undefined,
    };
  }

  if (hasApprovals) {
    return {
      objectiveSummary: "revisar a fila de aprovações",
      rationale: "Falta fechar se a entrega desejada é só leitura, priorização ou execução das pendências de baixo risco.",
      questions: ["Você quer só revisar as aprovações pendentes, priorizá-las ou já executar as de baixo risco?"],
    };
  }

  if (intent.compoundIntent && includesAny(normalized, ["organ", "prioriz", "alin", "planej"])) {
    return {
      objectiveSummary: "organizar a operação pessoal com base no pedido atual",
      rationale: "O pedido é composto e ainda falta a janela temporal para eu devolver um plano curto e útil.",
      questions: ["Você quer que eu organize isso olhando hoje ou a semana inteira?"],
    };
  }

  return null;
}

function buildSupportProposal(prompt: string): ClarificationRuleProposal | null {
  const normalized = normalize(prompt);
  if (!isSupportPrompt(normalized)) {
    return null;
  }

  return {
    objectiveSummary: "organizar ou atuar sobre a fila de suporte",
    rationale: "Em suporte, a decisão muda bastante entre triagem, resposta, priorização e ação interna.",
    questions: ["Você quer que eu faça triagem, priorize os casos ou prepare respostas para a fila?"],
  };
}

function buildGrowthProposal(prompt: string): ClarificationRuleProposal | null {
  const normalized = normalize(prompt);
  if (!includesAny(normalized, ["growth", "funil", "convers", "trafego", "tráfego", "mrr", "receita", "campanha"])) {
    return null;
  }

  return {
    objectiveSummary: "analisar ou melhorar uma frente de growth",
    rationale: "Growth fica vago rápido. Preciso saber qual métrica ou frente você quer atacar primeiro.",
    questions: ["Você quer focar em tráfego, conversão, retenção ou receita?"],
  };
}

function buildCodeProposal(prompt: string): ClarificationRuleProposal | null {
  const normalized = normalize(prompt);
  if (!includesAny(normalized, ["codigo", "código", "bug", "deploy", "api", "repo", "refator", "implemente", "corrija"])) {
    return null;
  }

  const hasAction = includesAny(normalized, ["analis", "corrig", "fix", "implem", "refator", "review"]);
  if (hasAction) {
    return null;
  }

  return {
    objectiveSummary: "atuar sobre uma demanda de código",
    rationale: "No domínio técnico, preciso fechar se o trabalho é análise, correção, implementação ou refatoração.",
    questions: ["Você quer que eu analise, corrija, implemente ou refatore isso?"],
  };
}

export function buildClarificationRuleProposal(
  prompt: string,
  intent: IntentResolution,
): ClarificationRuleProposal | null {
  const secretary = buildSecretaryProposal(prompt, intent);
  if (secretary) {
    return secretary;
  }

  if (intent.orchestration.route.primaryDomain === "assistente_social" || intent.orchestration.route.primaryDomain === "secretario_operacional") {
    const support = buildSupportProposal(prompt);
    if (support) {
      return support;
    }
  }

  if (intent.orchestration.route.primaryDomain === "analista_negocios_growth") {
    const growth = buildGrowthProposal(prompt);
    if (growth) {
      return growth;
    }
  }

  if (intent.orchestration.route.primaryDomain === "dev_full_stack") {
    const code = buildCodeProposal(prompt);
    if (code) {
      return code;
    }
  }

  return buildSupportProposal(prompt)
    ?? buildGrowthProposal(prompt)
    ?? buildCodeProposal(prompt);
}

export function buildClarifiedExecutionPrompt(
  originalPrompt: string,
  answerText: string,
  intent: IntentResolution,
): string | null {
  const normalizedPrompt = normalize(originalPrompt);
  const normalizedAnswer = normalizeAnswer(answerText);

  if (looksLikeCalendarDeletePrompt(originalPrompt)) {
    return [originalPrompt.trim(), answerText.trim()].filter(Boolean).join(" ");
  }

  if (includesAny(normalizedPrompt, ["aprova", "approval"]) && includesAny(normalizedPrompt, ["agenda", "compromiss", "dia"])) {
    return `Revise as aprovações pendentes e organize a agenda com base neste ajuste confirmado: ${normalizedAnswer}.`;
  }

  if (includesAny(normalizedPrompt, ["aprova", "approval"])) {
    return `Revise a fila de aprovações com base neste ajuste confirmado: ${normalizedAnswer}.`;
  }

  if (isSupportPrompt(normalizedPrompt) || intent.orchestration.route.primaryDomain === "assistente_social") {
    return `Atue na fila de suporte e casos com base neste ajuste confirmado: ${normalizedAnswer}.`;
  }

  if (intent.orchestration.route.primaryDomain === "analista_negocios_growth") {
    return `Analise a frente de growth considerando este foco confirmado: ${normalizedAnswer}.`;
  }

  if (intent.orchestration.route.primaryDomain === "dev_full_stack") {
    return `Atue na demanda técnica considerando este escopo confirmado: ${normalizedAnswer}.`;
  }

  return null;
}
