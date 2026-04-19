export type ConversationInterpreterSkill =
  | "greeting"
  | "weather"
  | "briefing"
  | "agenda"
  | "tasks"
  | "memory"
  | "planning"
  | "visual_task"
  | "other";

export type ConversationSuggestedAction =
  | "respond_direct"
  | "continue_pending_flow"
  | "cancel_pending_flow"
  | "draft_then_confirm"
  | "clarify_short"
  | "route_visual_task"
  | "handoff";

export type PendingConversationFlowKind =
  | "clarification"
  | "choice"
  | "monitored_alert"
  | "calendar_draft"
  | "task_draft"
  | "schedule_import"
  | "visual_task"
  | "other";

export type ConversationClarificationKind =
  | "calendar_account"
  | "time_of_day"
  | "task_or_event"
  | "visual_goal"
  | "rephrase";

export interface ConversationAttachmentSignal {
  kind: "image" | "pdf" | "audio";
}

export interface PendingConversationFlow {
  kind: PendingConversationFlowKind;
  suggestedAction?: string;
}

export interface ConversationInterpreterInput {
  text: string;
  pendingFlow?: PendingConversationFlow;
  attachments?: ConversationAttachmentSignal[];
  recentMessages?: string[];
  operationalMode?: "normal" | "field";
}

export interface ConversationInterpreterResult {
  kind: "interpreted_turn";
  intent: string;
  skill: ConversationInterpreterSkill;
  confidence: number;
  isTopLevelRequest: boolean;
  isFollowUp: boolean;
  isCorrection: boolean;
  isTopicShift: boolean;
  isShortConfirmation: boolean;
  isCancellation: boolean;
  needsConfirmation: boolean;
  needsClarification: boolean;
  clarificationKind?: ConversationClarificationKind;
  suggestedAction: ConversationSuggestedAction;
  entities: Record<string, unknown>;
  summaryOfUnderstanding: string;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(source: string, tokens: string[]): boolean {
  return tokens.some((token) => source.includes(token));
}

function tokenCount(value: string): number {
  return value.split(" ").filter(Boolean).length;
}

function isGreetingLike(normalized: string): boolean {
  const conversational = normalized.replace(/[?!.,;:]+/g, " ").replace(/\s+/g, " ").trim();
  return [
    "oi",
    "oi atlas",
    "ola",
    "ola atlas",
    "olá",
    "olá atlas",
    "bom dia",
    "boa tarde",
    "boa noite",
    "tudo certo",
    "tudo certo por ai",
    "tudo certo por aí",
    "como esta",
    "como está",
    "oi atlas como esta",
    "oi atlas como está",
    "atlas como esta",
    "atlas como está",
  ].includes(conversational);
}

const SHORT_CONFIRMATIONS = new Set([
  "sim",
  "ok",
  "okay",
  "pode",
  "pode sim",
  "pode seguir",
  "seguir",
  "segue",
  "segue nisso",
  "agendar",
  "agende",
  "faz isso",
  "faca isso",
  "faça isso",
  "faz",
  "manda",
  "envie",
]);

const CANCELLATIONS = new Set([
  "deixa",
  "cancela",
  "cancelar",
  "cancelar isso",
  "ignora",
  "ignorar",
  "ignora isso",
  "nao precisa",
  "não precisa",
  "esquece isso",
  "deixa isso",
]);

const REFERENTIAL_FOLLOWUPS = new Set([
  "esse",
  "esse mesmo",
  "essa",
  "essa mesma",
  "a primeira",
  "o primeiro",
  "a segunda",
  "o segundo",
  "a terceira",
  "o terceiro",
  "a ultima",
  "a última",
  "o da manha",
  "o da manhã",
  "o da tarde",
  "o da noite",
  "na abordagem",
  "abordagem",
  "no pessoal",
  "pessoal",
  "principal",
  "na agenda principal",
  "no calendario principal",
  "no calendário principal",
  "ambos",
  "hoje",
  "amanha",
  "amanhã",
  "agenda",
  "evento",
  "tarefa",
  "task",
  "cria tarefa",
  "cria task",
  "responda",
  "resposta",
  "resumo",
  "registrar",
  "registre",
  "so registra",
  "só registra",
  "cria o evento",
  "crie o evento",
  "transforma isso em tarefa",
]);

const SOCIAL_VISUAL_TERMS = [
  "perfil",
  "bio",
  "instagram",
  "social",
  "feed",
  "reels",
  "posts",
  "post",
  "engajamento",
  "seguidores",
  "metricas",
  "métricas",
];

const TASK_VISUAL_TERMS = [
  "tarefa",
  "tarefas",
  "pendencia",
  "pendência",
  "pendencias",
  "pendências",
  "checklist",
  "acao",
  "ação",
  "acoes",
  "ações",
  "extrai",
  "extraia",
  "transforma",
];

const DOCUMENT_VISUAL_TERMS = [
  "pdf",
  "documento",
  "relatorio",
  "relatório",
  "arquivo",
  "material",
  "pagina",
  "página",
];

const TASK_WRITE_HINTS = [
  "anota",
  "anote",
  "anota isso",
  "anota isso pra mim",
  "anote isso pra mim",
  "lembra de",
  "lembrar de",
  "compra ",
  "comprar ",
  "isso vira tarefa",
  "vira tarefa",
];

const CALENDAR_WRITE_HINTS = [
  "cria isso",
  "coloca na abordagem",
  "coloque na abordagem",
  "muda para a tarde",
  "mova para",
  "passa para",
  "isso vira agenda",
  "vira agenda",
  "vira evento",
];

const WEB_RESEARCH_HINTS = [
  "na internet",
  "com fontes",
  "fonte oficial",
  "fontes oficiais",
  "pesquise",
  "procure",
  "busque",
  "buscar",
  "compare",
  "comparar",
  "valide",
  "confirme",
  "verifique",
  "mais recente",
  "ultimas noticias",
  "últimas notícias",
  "cotacao",
  "cotação",
  "noticia",
  "notícia",
  "noticias",
  "notícias",
];

function looksLikeShortConfirmation(normalized: string): boolean {
  if (!normalized) {
    return false;
  }
  if (SHORT_CONFIRMATIONS.has(normalized)) {
    return true;
  }
  return /^sim(?:,?\s+quero)?$/.test(normalized)
    || /^pode\s+criar\b/.test(normalized)
    || /^pode\s+enviar\b/.test(normalized)
    || /^pode\s+mandar\b/.test(normalized)
    || /^segue\s+com\s+isso\b/.test(normalized)
    || /^modo\s+\d+\s+e\s+seguir\b/.test(normalized)
    || /^agendar\s+modo\s+\d+\b/.test(normalized)
    || /^importar\s+\d+\b/.test(normalized)
    || /^\d+\s+e\s+agendar\b/.test(normalized);
}

function looksLikeCancellation(normalized: string): boolean {
  return CANCELLATIONS.has(normalized);
}

function looksLikeCorrection(normalized: string): boolean {
  return /^(?:nao|não),?\s+/.test(normalized)
    || /^(?:na verdade|verdade|corrigindo|correcao|correção)\b/.test(normalized)
    || /\bquis dizer\b/.test(normalized)
    || /\bnao era\b/.test(normalized)
    || /\bnão era\b/.test(normalized)
    || /\bera .*?,?\s+nao\b/.test(normalized)
    || /\bera .*?,?\s+não\b/.test(normalized);
}

function looksLikeTimeReply(normalized: string): boolean {
  return /^(?:as?|às?)\s+\d{1,2}(?::\d{2})?(?:\s*h(?:oras?)?)?(?:\s+da\s+manha|\s+da\s+tarde|\s+da\s+noite)?$/.test(normalized)
    || /^(?:o\s+de\s+)?\d{1,2}(?::\d{2})?$/.test(normalized)
    || /^\d{1,2}h(?:\d{2})?$/.test(normalized)
    || /^(?:segunda|terca|terça|quarta|quinta|sexta|sabado|sábado|domingo)\b/.test(normalized)
    || normalized === "de manhã"
    || normalized === "de manha"
    || normalized === "de tarde"
    || normalized === "de noite";
}

export function looksLikeShortContextualConversationReply(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) {
    return false;
  }

  if (looksLikeShortConfirmation(normalized) || looksLikeCancellation(normalized) || REFERENTIAL_FOLLOWUPS.has(normalized)) {
    return true;
  }

  if (looksLikeTimeReply(normalized)) {
    return true;
  }

  return /^(?:o\s+de\s+)\d{1,2}(?::\d{2})?$/.test(normalized)
    || /^(?:a|o)\s+(?:primeira|primeiro|segunda|segundo|terceira|terceiro|quarta|quarto|quinta|quinto|ultima|última|ultimo|último)$/.test(normalized);
}

function detectCalendarAccount(normalized: string): "primary" | "abordagem" | "both" | undefined {
  if (hasAny(normalized, ["ambos", "duas agendas", "duas contas"])) {
    return "both";
  }
  if (hasAny(normalized, ["abordagem", "agenda da abordagem", "calendario da abordagem", "calendário da abordagem"])) {
    return "abordagem";
  }
  if (hasAny(normalized, ["pessoal", "agenda principal", "calendario principal", "calendário principal", "primary"])) {
    return "primary";
  }
  return undefined;
}

function detectTopLevelSkill(normalized: string, attachments: ConversationAttachmentSignal[]): {
  intent: string;
  skill: ConversationInterpreterSkill;
  confidence: number;
  entities: Record<string, unknown>;
  suggestedAction: ConversationSuggestedAction;
  needsConfirmation: boolean;
  needsClarification: boolean;
  clarificationKind?: ConversationClarificationKind;
  summaryOfUnderstanding: string;
} {
  const entities: Record<string, unknown> = {};
  const calendarAccount = detectCalendarAccount(normalized);
  if (calendarAccount) {
    entities.calendar_account = calendarAccount;
  }

  if (attachments.length > 0) {
    entities.attachments = attachments.map((item) => item.kind);
    const agendaVisual = hasAny(normalized, [
      "agenda",
      "eventos",
      "calendario",
      "calendário",
      "manha",
      "manhã",
      "tarde",
      "reuniao",
      "reunião",
      "feriado",
    ]);
    if (agendaVisual) {
      return {
        intent: "agenda_import",
        skill: "agenda",
        confidence: attachments.length > 1 ? 0.91 : 0.84,
        entities: {
          ...entities,
          visual_goal: "agenda_import",
        },
        suggestedAction: "route_visual_task",
        needsConfirmation: false,
        needsClarification: false,
        summaryOfUnderstanding: "Material visual parece ser uma agenda para extrair e revisar antes de importar.",
      };
    }

    if (hasAny(normalized, SOCIAL_VISUAL_TERMS)) {
      return {
        intent: "social_profile_analysis",
        skill: "visual_task",
        confidence: 0.86,
        entities: {
          ...entities,
          visual_goal: "social_profile_analysis",
        },
        suggestedAction: "route_visual_task",
        needsConfirmation: false,
        needsClarification: false,
        summaryOfUnderstanding: "Material visual parece voltado a análise de perfil ou presença social.",
      };
    }

    if (hasAny(normalized, TASK_VISUAL_TERMS)) {
      return {
        intent: "task_extraction",
        skill: "visual_task",
        confidence: 0.84,
        entities: {
          ...entities,
          visual_goal: "task_extraction",
        },
        suggestedAction: "route_visual_task",
        needsConfirmation: false,
        needsClarification: false,
        summaryOfUnderstanding: "Material visual parece pedir extração de tarefas, pendências ou ações.",
      };
    }

    if (hasAny(normalized, DOCUMENT_VISUAL_TERMS)) {
      return {
        intent: "document_review",
        skill: "visual_task",
        confidence: 0.82,
        entities: {
          ...entities,
          visual_goal: "document_review",
        },
        suggestedAction: "route_visual_task",
        needsConfirmation: false,
        needsClarification: false,
        summaryOfUnderstanding: "Material visual parece ser um documento para revisar, resumir ou transformar em ação.",
      };
    }

    if (!normalized || hasAny(normalized, ["ve isso", "vê isso", "quero que veja isso", "me ajuda com isso", "isso aqui"])) {
      return {
        intent: "visual_review",
        skill: "visual_task",
        confidence: 0.72,
        entities,
        suggestedAction: "route_visual_task",
        needsConfirmation: false,
        needsClarification: false,
        summaryOfUnderstanding: "Há material visual anexado e o próximo passo é analisar esse material no fluxo visual/documental.",
      };
    }
  }

  if (isGreetingLike(normalized)) {
    return {
      intent: "greeting",
      skill: "greeting",
      confidence: 0.94,
      entities,
      suggestedAction: "respond_direct",
      needsConfirmation: false,
      needsClarification: false,
      summaryOfUnderstanding: "Saudação simples do usuário.",
    };
  }

  if (hasAny(normalized, ["clima", "tempo", "vai chover", "previsao", "previsão"])) {
    return {
      intent: "weather_read",
      skill: "weather",
      confidence: 0.92,
      entities,
      suggestedAction: "respond_direct",
      needsConfirmation: false,
      needsClarification: false,
      summaryOfUnderstanding: "Pedido simples de clima/previsão.",
    };
  }

  if (hasAny(normalized, ["briefing da manha", "briefing da manhã", "brief diario", "brief diário", "resumo da manha", "resumo da manhã"])) {
    return {
      intent: "morning_brief",
      skill: "briefing",
      confidence: 0.94,
      entities,
      suggestedAction: "respond_direct",
      needsConfirmation: false,
      needsClarification: false,
      summaryOfUnderstanding: "Pedido de briefing da manhã.",
    };
  }

  if (hasAny(normalized, ["como esta meu dia", "como está meu dia", "status do dia", "o que apareceu de importante", "o que tenho de importante"])) {
    return {
      intent: "day_status",
      skill: "briefing",
      confidence: 0.9,
      entities,
      suggestedAction: "respond_direct",
      needsConfirmation: false,
      needsClarification: false,
      summaryOfUnderstanding: "Pedido de leitura rápida do dia atual.",
    };
  }

  if (hasAny(normalized, WEB_RESEARCH_HINTS)) {
    return {
      intent: "web_search",
      skill: "planning",
      confidence: 0.84,
      entities,
      suggestedAction: "respond_direct",
      needsConfirmation: false,
      needsClarification: false,
      summaryOfUnderstanding: "Pedido de informação recente ou externa que deve passar por busca web com fontes.",
    };
  }

  if (hasAny(normalized, ["minhas tarefas", "me mostra minhas tarefas", "liste minhas tarefas", "tarefa", "task"])) {
    const write = hasAny(normalized, ["crie", "cria", "adicione", "adiciona", "delete", "exclua", "apague", "remova", "conclua", "concluir", "atualize"]);
    return {
      intent: write ? "task_write" : "task_read",
      skill: "tasks",
      confidence: write ? 0.82 : 0.91,
      entities: {
        ...entities,
        ...(write ? { target_type: "task" } : {}),
      },
      suggestedAction: write ? "draft_then_confirm" : "respond_direct",
      needsConfirmation: write,
      needsClarification: false,
      summaryOfUnderstanding: write
        ? "Pedido envolvendo escrita ou ajuste de tarefa."
        : "Pedido simples de leitura de tarefas.",
    };
  }

  if (hasAny(normalized, TASK_WRITE_HINTS)) {
    return {
      intent: "task_write",
      skill: "tasks",
      confidence: 0.8,
      entities: {
        ...entities,
        target_type: "task",
      },
      suggestedAction: "draft_then_confirm",
      needsConfirmation: true,
      needsClarification: false,
      summaryOfUnderstanding: "Pedido natural que parece criar ou ajustar uma tarefa.",
    };
  }

  if (hasAny(normalized, ["agenda", "calendario", "calendário", "compromissos", "evento", "reuniao", "reunião"])) {
    const write = hasAny(normalized, ["crie", "cria", "coloque", "coloca", "agende", "agendar", "mova", "mude", "reagende", "altere", "atualize", "renomeie", "cancele", "remova", "delete", "exclua", "apague"]);
    return {
      intent: write ? "calendar_write" : "calendar_read",
      skill: "agenda",
      confidence: write ? 0.84 : 0.92,
      entities: {
        ...entities,
        ...(write ? { target_type: "event" } : {}),
      },
      suggestedAction: write ? "draft_then_confirm" : "respond_direct",
      needsConfirmation: write,
      needsClarification: false,
      summaryOfUnderstanding: write
        ? "Pedido envolvendo criação ou ajuste de agenda."
        : "Pedido simples de agenda/compromissos.",
    };
  }

  if (hasAny(normalized, CALENDAR_WRITE_HINTS)) {
    return {
      intent: "calendar_write",
      skill: "agenda",
      confidence: 0.8,
      entities: {
        ...entities,
        target_type: "event",
      },
      suggestedAction: "draft_then_confirm",
      needsConfirmation: true,
      needsClarification: false,
      summaryOfUnderstanding: "Pedido natural que parece criar ou ajustar um evento.",
    };
  }

  if (hasAny(normalized, ["organize meu dia", "organizar meu dia", "planeje meu dia", "planejar meu dia"])) {
    return {
      intent: "day_planning",
      skill: "planning",
      confidence: 0.86,
      entities,
      suggestedAction: "respond_direct",
      needsConfirmation: false,
      needsClarification: false,
      summaryOfUnderstanding: "Pedido de organização prática do dia.",
    };
  }

  if (hasAny(normalized, ["memoria pessoal", "memória pessoal", "salva na memoria", "salve na memória", "mostre meu perfil", "meu perfil operacional", "estado operacional", "o que voce aprendeu sobre mim", "o que você aprendeu sobre mim"])) {
    return {
      intent: "personal_memory",
      skill: "memory",
      confidence: 0.88,
      entities,
      suggestedAction: "respond_direct",
      needsConfirmation: false,
      needsClarification: false,
      summaryOfUnderstanding: "Pedido ligado a perfil, estado ou memória pessoal.",
    };
  }

  if (hasAny(normalized, [
    "ve isso",
    "vê isso",
    "quero que veja isso",
    "me ajuda com isso",
    "isso aqui vira agenda",
    "vê esse print",
    "ve esse print",
    "olha esse pdf",
    "analisa esse perfil",
  ])) {
    return {
      intent: "visual_review",
      skill: "visual_task",
      confidence: 0.64,
      entities,
      suggestedAction: attachments.length > 0 ? "route_visual_task" : "clarify_short",
      needsConfirmation: false,
      needsClarification: attachments.length === 0,
      clarificationKind: attachments.length === 0 ? "visual_goal" : undefined,
      summaryOfUnderstanding: attachments.length > 0
        ? "Pedido de análise de material visual já anexado."
        : "Pedido vago que parece depender de imagem, print ou PDF.",
    };
  }

  return {
    intent: "general_request",
    skill: "other",
    confidence: 0.42,
    entities,
    suggestedAction: "handoff",
    needsConfirmation: false,
    needsClarification: false,
    summaryOfUnderstanding: "Pedido geral sem sinal forte de domínio específico.",
  };
}

function detectCorrectionEntities(normalized: string): Record<string, unknown> {
  const entities: Record<string, unknown> = {};
  if (normalized.includes("tarefa") && normalized.includes("evento")) {
    if (normalized.includes("nao era tarefa") || normalized.includes("não era tarefa") || normalized.includes("era evento")) {
      entities.corrected_target_type = "event";
    } else if (normalized.includes("nao era evento") || normalized.includes("não era evento") || normalized.includes("era tarefa")) {
      entities.corrected_target_type = "task";
    }
  }
  const account = detectCalendarAccount(normalized);
  if (account) {
    entities.calendar_account = account;
  }
  return entities;
}

export function looksLikeNewTopLevelConversationTurn(text: string, attachments: ConversationAttachmentSignal[] = []): boolean {
  const interpreted = interpretConversationTurn({ text, attachments });
  if (interpreted.isFollowUp || interpreted.isCancellation || interpreted.isShortConfirmation) {
    return false;
  }
  return interpreted.isTopLevelRequest
    && interpreted.suggestedAction !== "handoff";
}

export function interpretConversationTurn(input: ConversationInterpreterInput): ConversationInterpreterResult {
  const normalized = normalize(input.text);
  const attachments = input.attachments ?? [];
  const pendingFlow = input.pendingFlow;
  const recentContext = normalize((input.recentMessages ?? []).slice(-3).join(" "));
  const correction = looksLikeCorrection(normalized);
  const cancellation = looksLikeCancellation(normalized);
  const shortConfirmation = looksLikeShortConfirmation(normalized);
  const shortContextualReply = looksLikeShortContextualConversationReply(normalized);
  const detectedTopLevel = detectTopLevelSkill(normalized, attachments);
  const topLevel =
    input.operationalMode === "field" && ["weather", "briefing", "agenda"].includes(detectedTopLevel.skill)
      ? {
          ...detectedTopLevel,
          confidence: Math.min(0.98, detectedTopLevel.confidence + 0.03),
        }
      : detectedTopLevel;

  const baseEntities = correction ? detectCorrectionEntities(normalized) : {};
  const entities = {
    ...topLevel.entities,
    ...baseEntities,
  };

  if (pendingFlow) {
    if (cancellation) {
      return {
        kind: "interpreted_turn",
        intent: "cancel_pending_flow",
        skill: topLevel.skill,
        confidence: 0.95,
        isTopLevelRequest: false,
        isFollowUp: true,
        isCorrection: false,
        isTopicShift: false,
        isShortConfirmation: false,
        isCancellation: true,
        needsConfirmation: false,
        needsClarification: false,
        suggestedAction: "cancel_pending_flow",
        entities,
        summaryOfUnderstanding: "Cancelar ou abandonar o fluxo pendente atual.",
      };
    }

    if (correction) {
      return {
        kind: "interpreted_turn",
        intent: "correct_pending_flow",
        skill: topLevel.skill,
        confidence: 0.88,
        isTopLevelRequest: false,
        isFollowUp: true,
        isCorrection: true,
        isTopicShift: false,
        isShortConfirmation: false,
        isCancellation: false,
        needsConfirmation: false,
        needsClarification: false,
        suggestedAction: "continue_pending_flow",
        entities,
        summaryOfUnderstanding: "Correção curta do que estava pendente.",
      };
    }

    if (shortConfirmation) {
      return {
        kind: "interpreted_turn",
        intent: "confirm_pending_flow",
        skill: topLevel.skill,
        confidence: 0.94,
        isTopLevelRequest: false,
        isFollowUp: true,
        isCorrection: false,
        isTopicShift: false,
        isShortConfirmation: true,
        isCancellation: false,
        needsConfirmation: false,
        needsClarification: false,
        suggestedAction: "continue_pending_flow",
        entities,
        summaryOfUnderstanding: "Confirmação curta do fluxo pendente.",
      };
    }

    if (shortContextualReply) {
      return {
        kind: "interpreted_turn",
        intent: "followup_pending_flow",
        skill: topLevel.skill,
        confidence: 0.86,
        isTopLevelRequest: false,
        isFollowUp: true,
        isCorrection: false,
        isTopicShift: false,
        isShortConfirmation: false,
        isCancellation: false,
        needsConfirmation: false,
        needsClarification: false,
        suggestedAction: "continue_pending_flow",
        entities,
        summaryOfUnderstanding: "Complemento curto do fluxo pendente atual.",
      };
    }

    const looksLikeNewQuestion = input.text.includes("?")
      || /^(?:qual|quais|como|onde|quando|mostre|me mostre|liste|organize|planeje|gere|salve|guarde|quero|preciso|procure|busque|veja|vê|analise|analisa)\b/.test(normalized)
      || topLevel.skill !== "other";

    if (looksLikeNewQuestion && tokenCount(normalized) >= 2) {
      return {
        kind: "interpreted_turn",
        intent: topLevel.intent,
        skill: topLevel.skill,
        confidence: Math.max(0.78, topLevel.confidence),
        isTopLevelRequest: true,
        isFollowUp: false,
        isCorrection: false,
        isTopicShift: true,
        isShortConfirmation: false,
        isCancellation: false,
        needsConfirmation: topLevel.needsConfirmation,
        needsClarification: topLevel.needsClarification,
        clarificationKind: topLevel.clarificationKind,
        suggestedAction: topLevel.suggestedAction,
        entities,
        summaryOfUnderstanding: topLevel.summaryOfUnderstanding,
      };
    }

    return {
      kind: "interpreted_turn",
      intent: "unclear_pending_followup",
      skill: topLevel.skill,
      confidence: 0.46,
      isTopLevelRequest: false,
      isFollowUp: false,
      isCorrection: false,
      isTopicShift: false,
      isShortConfirmation: false,
      isCancellation: false,
      needsConfirmation: false,
      needsClarification: true,
      clarificationKind: "rephrase",
      suggestedAction: "clarify_short",
      entities,
      summaryOfUnderstanding: "Mensagem curta demais para decidir se continua o fluxo pendente ou abre um pedido novo.",
    };
  }

  if (
    shortContextualReply
    && recentContext
    && hasAny(recentContext, ["rascunho", "confirme", "confirmar", "opcao", "opção", "alerta", "agenda", "evento", "tarefa"])
  ) {
    return {
      kind: "interpreted_turn",
      intent: "recent_context_followup",
      skill: topLevel.skill,
      confidence: 0.58,
      isTopLevelRequest: false,
      isFollowUp: true,
      isCorrection: false,
      isTopicShift: false,
      isShortConfirmation: shortConfirmation,
      isCancellation: cancellation,
      needsConfirmation: false,
      needsClarification: false,
      suggestedAction: cancellation ? "cancel_pending_flow" : "continue_pending_flow",
      entities,
      summaryOfUnderstanding: "Resposta curta que ainda parece continuidade do contexto recente.",
    };
  }

  return {
    kind: "interpreted_turn",
    intent: topLevel.intent,
    skill: topLevel.skill,
    confidence: topLevel.confidence,
    isTopLevelRequest: topLevel.skill !== "other",
    isFollowUp: false,
    isCorrection: correction,
    isTopicShift: false,
    isShortConfirmation: shortConfirmation,
    isCancellation: cancellation,
    needsConfirmation: topLevel.needsConfirmation,
    needsClarification: topLevel.needsClarification,
    clarificationKind: topLevel.clarificationKind,
    suggestedAction: correction ? "continue_pending_flow" : topLevel.suggestedAction,
    entities,
    summaryOfUnderstanding: correction && Object.keys(baseEntities).length > 0
      ? "Correção do entendimento anterior detectada."
      : topLevel.summaryOfUnderstanding,
  };
}
