export type EmailOperationalPriority = "alta" | "media" | "baixa";
export type EmailOperationalGroup = "seguranca" | "profissional" | "social" | "promocional" | "financeiro" | "geral";

export interface EmailOperationalSummary {
  group: EmailOperationalGroup;
  category: string;
  priority: EmailOperationalPriority;
  status: string;
  summary: string;
  action: string;
  expected: boolean;
}

export function normalizeEmailAnalysisText(value: string): string {
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

export function summarizeEmailForOperations(input: {
  subject: string;
  from: string[];
  text: string;
}): EmailOperationalSummary {
  const normalized = normalizeEmailAnalysisText(`${input.subject}\n${input.from.join(" ")}\n${input.text}`);

  if (normalized.includes("google") && normalized.includes("senha") && normalized.includes("app")) {
    const expected = normalized.includes("agente ai local");
    return {
      group: "seguranca",
      category: "alerta de seguranca",
      priority: "alta",
      status: expected
        ? "esperado no contexto do teste da senha de app"
        : "suspeito ate validacao manual",
      summary: "O Google registrou criacao ou uso de senha de app para acessar a conta.",
      action: expected
        ? "Nenhuma acao urgente se foi voce quem gerou a senha. Revogue a senha de app se quiser encerrar o acesso do agente."
        : "Revogue imediatamente a senha de app e revise a atividade de seguranca da conta.",
      expected,
    };
  }

  if (
    normalized.includes("supabase") &&
    includesAny(normalized, ["going to be paused", "will be paused", "paused", "pause"])
  ) {
    return {
      group: "profissional",
      category: "infraestrutura/produto",
      priority: "alta",
      status: "exige atencao",
      summary: "A Supabase avisou que um projeto com baixa atividade esta prestes a ser pausado.",
      action: "Verificar se o projeto ainda e relevante e decidir entre reativar uso, fazer backup ou aceitar a pausa.",
      expected: false,
    };
  }

  if (
    includesAny(normalized, [
      "linkedin",
      "invitation to connect",
      "connection request",
      "convite para conectar",
      "nova conexao",
      "perfil visualizou",
      "networking",
    ])
  ) {
    return {
      group: "social",
      category: "social/networking",
      priority: "media",
      status: "informativo",
      summary: "Email de rede social ou networking com potencial de relacionamento ou oportunidade.",
      action: "Verificar se existe contato, convite, lead ou oportunidade que valha resposta ou acompanhamento.",
      expected: false,
    };
  }

  if (
    includesAny(normalized, [
      "github",
      "gitlab",
      "supabase",
      "vercel",
      "cloudflare",
      "railway",
      "render",
      "docker",
      "stripe",
      "aws",
      "deploy",
      "build failed",
      "incident",
      "proposal",
      "proposta",
      "orcamento",
      "budget",
      "cliente",
      "contract",
      "contrato",
      "meeting",
      "reuniao",
      "freelance",
      "vaga",
      "oportunidade",
    ])
  ) {
    return {
      group: "profissional",
      category: "profissional/dev-negocio",
      priority: "media",
      status: "pendente de analise",
      summary: "Email relacionado a trabalho, infraestrutura, proposta ou oportunidade profissional.",
      action: "Avaliar se exige resposta, acompanhamento comercial ou acao tecnica nas proximas horas.",
      expected: false,
    };
  }

  if (
    includesAny(normalized, [
      "desconto",
      "cupom",
      "parcela",
      "promo",
      "promoc",
      "seminovos",
      "zarpo",
      "oferta",
      "aniversario",
      "renner",
      "black friday",
      "liquidacao",
      "sale",
    ])
  ) {
    return {
      group: "promocional",
      category: "marketing/promocional",
      priority: "baixa",
      status: "informativo",
      summary: "Email promocional com oferta comercial, sem sinal operacional importante.",
      action: "Arquivar ou ignorar, a menos que exista interesse especifico na oferta.",
      expected: false,
    };
  }

  if (
    includesAny(normalized, [
      "credito",
      "emprestimo",
      "disponivel para voce",
      "foregon",
      "simulacao",
      "financiamento",
      "cartao",
      "cartao de credito",
    ])
  ) {
    return {
      group: "financeiro",
      category: "oferta financeira",
      priority: "baixa",
      status: "informativo",
      summary: "Oferta comercial de credito ou produto financeiro, sem urgencia operacional aparente.",
      action: "Ignorar ou avaliar separadamente se houver interesse real.",
      expected: false,
    };
  }

  return {
    group: "geral",
    category: "email geral",
    priority: "media",
    status: "pendente de analise",
    summary: "Email lido com sucesso, mas sem padrao forte o bastante para classificacao totalmente deterministica.",
    action: "Ler o conteudo principal e decidir manualmente se exige resposta, arquivamento ou acompanhamento.",
    expected: false,
  };
}
