import type {
  AgentActionMode,
  AgentAutonomyLevel,
  AgentDomain,
  AgentRiskLevel,
  DomainPolicy,
  DomainRoute,
  OrchestrationContext,
} from "../types/orchestration.js";

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

function scoreDomain(prompt: string, domain: AgentDomain): number {
  const normalized = normalize(prompt);

  const tokenMap: Record<Exclude<AgentDomain, "orchestrator">, string[]> = {
    assistente_social: [
      "servico social",
      "assistente social",
      "relatorio social",
      "parecer social",
      "acolhimento",
      "familia",
      "usuario",
      "encaminhamento",
      "beneficio",
      "cras",
      "creas",
      "visita domiciliar",
      "atendimento social",
      "estudo social",
      "prontuario",
    ],
    secretario_operacional: [
      "agenda",
      "calendario",
      "rotina",
      "compromisso",
      "lembrete",
      "follow-up",
      "follow up",
      "organize meu dia",
      "prioridades de hoje",
      "planeje minha semana",
      "reuniao",
      "agende",
      "remarque",
      "tarefas do dia",
    ],
    social_media: [
      "post",
      "conteudo",
      "social media",
      "instagram",
      "tiktok",
      "youtube",
      "shorts",
      "reels",
      "legenda",
      "roteiro",
      "carrossel",
      "calendario editorial",
      "cta",
      "hook",
      "engajamento",
    ],
    dev_full_stack: [
      "codigo",
      "bug",
      "api",
      "docker",
      "node",
      "typescript",
      "python",
      "deploy",
      "backend",
      "frontend",
      "build",
      "teste",
      "refator",
      "saas",
      "micro-saas",
      "micro saas",
      "banco de dados",
    ],
    analista_negocios_growth: [
      "growth",
      "receita",
      "faturamento",
      "renda",
      "monetizacao",
      "monetizacao",
      "mrr",
      "lead",
      "funil",
      "oferta",
      "proposta",
      "roi",
      "conversao",
      "cliente",
      "validacao",
      "vendas",
      "negocio",
      "pipeline",
    ],
  };

  if (domain === "orchestrator") {
    return 0;
  }

  return tokenMap[domain].reduce((score, token) => {
    return normalized.includes(token) ? score + 2 : score;
  }, 0);
}

function detectActionMode(prompt: string): AgentActionMode {
  const normalized = normalize(prompt);
  const planningTokens = ["planeje", "roadmap", "plano", "organize", "priorize"];
  const scheduleTokens = ["agende", "remarque", "calendario", "compromisso", "agenda"];
  const reviewTokens = [
    "revise",
    "revisar",
    "analise",
    "analisar",
    "organizar",
    "aprovações",
    "aprovacoes",
    "aprovação",
    "aprovacao",
  ];

  const hasPlanningIntent = includesAny(normalized, planningTokens);
  const hasScheduleIntent = includesAny(normalized, scheduleTokens);
  const hasReviewIntent = includesAny(normalized, reviewTokens);

  // Mixed operational requests like "revisar aprovações e organizar minha agenda"
  // are better handled as planning than as direct scheduling.
  if ((hasScheduleIntent && hasPlanningIntent) || (hasScheduleIntent && hasReviewIntent)) {
    return "plan";
  }

  if (hasPlanningIntent) {
    return "plan";
  }

  if (hasScheduleIntent) {
    return "schedule";
  }

  if (
    includesAny(normalized, [
      "responda",
      "envie",
      "mande",
      "publique",
      "poste",
      "mensagem",
      "email",
      "whatsapp",
    ])
  ) {
    return "communicate";
  }

  if (includesAny(normalized, ["implemente", "execute", "rode", "corrija", "crie o arquivo", "codifique"])) {
    return "execute";
  }

  if (includesAny(normalized, ["monitor", "acompanhe", "verifique continuamente", "triagem", "acompanhamento"])) {
    return "monitor";
  }

  return "analyze";
}

function clampConfidence(value: number): number {
  if (value < 0.2) {
    return 0.2;
  }
  if (value > 0.98) {
    return 0.98;
  }
  return Number(value.toFixed(2));
}

export function resolveDomainRoute(prompt: string): DomainRoute {
  const domainScoreSeed: Array<{ domain: AgentDomain; score: number }> = [
    { domain: "assistente_social", score: scoreDomain(prompt, "assistente_social") },
    { domain: "secretario_operacional", score: scoreDomain(prompt, "secretario_operacional") },
    { domain: "social_media", score: scoreDomain(prompt, "social_media") },
    { domain: "dev_full_stack", score: scoreDomain(prompt, "dev_full_stack") },
    { domain: "analista_negocios_growth", score: scoreDomain(prompt, "analista_negocios_growth") },
  ];
  const domainScores = [...domainScoreSeed].sort((left, right) => right.score - left.score);

  const top = domainScores[0];
  const second = domainScores[1];
  const actionMode = detectActionMode(prompt);

  if (!top || top.score === 0) {
    return {
      primaryDomain: "orchestrator",
      secondaryDomains: [],
      confidence: 0.35,
      actionMode,
      reasons: ["pedido sem sinais fortes de domínio; roteado para o orquestrador"],
    };
  }

  const secondaryDomains = domainScores
    .filter((item) => item.domain !== top.domain && item.score >= Math.max(2, top.score - 2))
    .slice(0, 2)
    .map((item) => item.domain);

  const confidenceBase = second ? 0.55 + (top.score - second.score) * 0.08 : 0.7;

  return {
    primaryDomain: top.domain,
    secondaryDomains,
    confidence: clampConfidence(confidenceBase),
    actionMode,
    reasons: [
      `dominio principal detectado por sinais de ${top.domain}`,
      ...(secondaryDomains.length > 0 ? [`dominios secundarios: ${secondaryDomains.join(", ")}`] : []),
    ],
  };
}

function maxRisk(left: AgentRiskLevel, right: AgentRiskLevel): AgentRiskLevel {
  const order: AgentRiskLevel[] = ["low", "medium", "high", "critical"];
  return order[Math.max(order.indexOf(left), order.indexOf(right))];
}

function policyForDomain(domain: AgentDomain): { risk: AgentRiskLevel; autonomy: AgentAutonomyLevel } {
  switch (domain) {
    case "assistente_social":
      return {
        risk: "high",
        autonomy: "draft_with_confirmation",
      };
    case "secretario_operacional":
      return {
        risk: "medium",
        autonomy: "execute_with_confirmation",
      };
    case "social_media":
      return {
        risk: "medium",
        autonomy: "draft_with_confirmation",
      };
    case "dev_full_stack":
      return {
        risk: "medium",
        autonomy: "execute_with_confirmation",
      };
    case "analista_negocios_growth":
      return {
        risk: "medium",
        autonomy: "autonomous_low_risk",
      };
    case "orchestrator":
    default:
      return {
        risk: "medium",
        autonomy: "draft_with_confirmation",
      };
  }
}

export function buildDomainPolicy(prompt: string, route: DomainRoute): DomainPolicy {
  const normalized = normalize(prompt);
  const base = policyForDomain(route.primaryDomain);
  let risk = base.risk;
  let autonomy = base.autonomy;
  const guardrails = new Set<string>();
  const approvals = new Set<string>();

  if (includesAny(normalized, ["whatsapp", "email", "responda", "envie", "mande", "dm", "mensagem"])) {
    risk = maxRisk(risk, "high");
    approvals.add("envio de mensagens externas");
    guardrails.add("nao enviar mensagens externas sem confirmacao explicita");
  }

  if (includesAny(normalized, ["publique", "poste", "publicar", "postar", "story", "reel", "shorts"])) {
    risk = maxRisk(risk, "high");
    approvals.add("publicacao em canais publicos");
    guardrails.add("nao publicar conteudo sem aprovacao humana");
  }

  if (includesAny(normalized, ["agende", "remarque", "cancele compromisso", "calendar", "calendario"])) {
    risk = maxRisk(risk, "high");
    approvals.add("alteracao de agenda ou calendario");
    guardrails.add("nao alterar agenda real sem confirmacao do usuario");
  }

  if (includesAny(normalized, ["automaticamente", "sozinho", "sem me perguntar", "sem aprovacao"])) {
    risk = maxRisk(risk, "critical");
    guardrails.add("o pedido menciona automacao sensivel; manter humano no loop");
  }

  if (route.primaryDomain === "assistente_social") {
    risk = maxRisk(risk, "high");
    approvals.add("comunicacao sensivel da area social");
    guardrails.add("tratar dados e comunicacoes da area social como contexto sensivel");
  }

  if (route.actionMode === "analyze" && risk === "medium" && !approvals.size) {
    autonomy = "autonomous_low_risk";
  } else if (risk === "high" || risk === "critical") {
    autonomy = "draft_with_confirmation";
  }

  if (route.primaryDomain === "dev_full_stack" && route.actionMode === "execute" && risk === "medium") {
    autonomy = "execute_with_confirmation";
    approvals.add("execucao tecnica com impacto no projeto");
  }

  const capabilities = {
    canReadSensitiveChannels: true,
    canDraftExternalReplies: true,
    canSendExternalReplies: false,
    canWriteWorkspace: true,
    canPersistMemory: true,
    canRunProjectTools: route.primaryDomain === "dev_full_stack" || route.primaryDomain === "orchestrator",
    canModifyCalendar: route.primaryDomain === "secretario_operacional",
    canPublishContent: false,
  };

  if (autonomy === "autonomous_low_risk" && risk === "low") {
    capabilities.canPublishContent = false;
  }

  return {
    riskLevel: risk,
    autonomyLevel: autonomy,
    guardrails: [
      "separar claramente contexto social, operacional, dev, growth e midia",
      "privilegiar leitura, triagem e rascunho antes de automacao ativa",
      ...guardrails,
    ],
    requiresApprovalFor: [...approvals],
    capabilities,
  };
}

function domainMission(domain: AgentDomain): string {
  switch (domain) {
    case "assistente_social":
      return "atender demandas da area social com linguagem adequada, responsabilidade e alto cuidado com contexto sensivel";
    case "secretario_operacional":
      return "organizar rotina, compromissos, prioridades, follow-ups e carga operacional";
    case "social_media":
      return "planejar, criar e organizar conteudo, distribuicao e calendario editorial";
    case "dev_full_stack":
      return "analisar, construir e operar projetos, SaaS, automacoes e software";
    case "analista_negocios_growth":
      return "priorizar receita, ofertas, validacao, vendas, crescimento e oportunidades";
    case "orchestrator":
    default:
      return "coordenar varios dominios e decidir a proxima acao de maior impacto";
  }
}

export function buildOrchestrationContext(prompt: string): OrchestrationContext {
  const route = resolveDomainRoute(prompt);
  const policy = buildDomainPolicy(prompt, route);
  return {
    route,
    policy,
  };
}

export function buildOrchestrationSystemMessage(context: OrchestrationContext): string {
  const approvalText = context.policy.requiresApprovalFor.length > 0
    ? context.policy.requiresApprovalFor.join(", ")
    : "nenhuma aprovacao adicional detectada para leitura/analise";

  return [
    "Contexto de orquestracao atual:",
    `- Dominio principal: ${context.route.primaryDomain}`,
    `- Dominios secundarios: ${context.route.secondaryDomains.join(", ") || "nenhum"}`,
    `- Modo de acao: ${context.route.actionMode}`,
    `- Confianca da rota: ${context.route.confidence}`,
    `- Missao do dominio: ${domainMission(context.route.primaryDomain)}`,
    `- Nivel de risco: ${context.policy.riskLevel}`,
    `- Nivel de autonomia: ${context.policy.autonomyLevel}`,
    `- Exige aprovacao humana para: ${approvalText}`,
    `- Guardrails: ${context.policy.guardrails.join("; ")}`,
  ].join("\n");
}
