export type VisualTaskKind =
  | "agenda_import"
  | "social_profile_analysis"
  | "task_extraction"
  | "document_review"
  | "general_visual";

export type VisualAttachmentKind = "pdf" | "image";

export interface VisualTaskAttachment {
  fileId: string;
  fileName: string;
  mimeType: string;
  kind: VisualAttachmentKind;
  receivedAt: number;
}

export interface VisualTaskPlan {
  kind: VisualTaskKind;
  objective: string;
  expectedData: string[];
  acceptedModes: string[];
  preferredMode: string;
  shouldAttemptExtraction: boolean;
}

export interface VisualTaskState {
  kind: VisualTaskKind;
  objective: string;
  files: VisualTaskAttachment[];
  status: "open" | "extracting" | "draft_ready" | "awaiting_better_material";
  extractionAttempts: number;
  lastFailure?: string;
  nextBestSteps: string[];
  openedAt: number;
  updatedAt: number;
}

interface BuildStateInput {
  previous?: VisualTaskState;
  plan: VisualTaskPlan;
  attachment: Omit<VisualTaskAttachment, "receivedAt">;
  now?: number;
}

const AGENDA_TERMS = [
  "agenda",
  "calendario",
  "calendário",
  "evento",
  "eventos",
  "compromisso",
  "compromissos",
  "reuniao",
  "reunião",
  "cronograma",
  "escala",
  "semanal",
  "horario",
  "horário",
];

const SOCIAL_TERMS = [
  "perfil",
  "bio",
  "instagram",
  "social",
  "feed",
  "reels",
  "post",
  "posts",
  "metricas",
  "métricas",
  "seguidores",
  "engajamento",
];

const TASK_TERMS = [
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

const DOCUMENT_TERMS = [
  "pdf",
  "documento",
  "relatorio",
  "relatório",
  "material",
  "arquivo",
  "contrato",
  "texto",
  "pagina",
  "página",
];

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(normalized: string, terms: string[]): boolean {
  return terms.some((term) => normalized.includes(normalize(term)));
}

function labelAttachmentKind(kind: VisualAttachmentKind): string {
  return kind === "pdf" ? "PDF" : "print/imagem";
}

function buildPlanForKind(kind: VisualTaskKind, attachmentKind: VisualAttachmentKind): VisualTaskPlan {
  if (kind === "agenda_import") {
    return {
      kind,
      objective: "montar um rascunho de agenda/calendário a partir do material enviado",
      expectedData: ["datas", "horários", "títulos dos eventos", "locais", "responsáveis quando aparecerem"],
      acceptedModes: ["PDF pesquisável", "print nítido", "foto bem enquadrada", "texto colado no chat"],
      preferredMode: attachmentKind === "pdf" ? "PDF pesquisável" : "print nítido por dia/período",
      shouldAttemptExtraction: true,
    };
  }

  if (kind === "social_profile_analysis") {
    return {
      kind,
      objective: "analisar perfil/social a partir de prints, link ou export",
      expectedData: ["bio", "identidade visual", "clareza da oferta", "consistência do conteúdo", "sinais de melhoria"],
      acceptedModes: ["prints do perfil", "link do perfil", "export de métricas", "texto com objetivo da análise"],
      preferredMode: "prints do perfil mais link/export quando disponível",
      shouldAttemptExtraction: false,
    };
  }

  if (kind === "task_extraction") {
    return {
      kind,
      objective: "extrair tarefas, pendências e próximos passos do material visual",
      expectedData: ["tarefas", "prazos", "responsáveis", "prioridade", "contexto mínimo"],
      acceptedModes: ["print nítido", "PDF pesquisável", "texto exportado", "recortes por seção"],
      preferredMode: "PDF pesquisável ou texto exportado",
      shouldAttemptExtraction: false,
    };
  }

  if (kind === "document_review") {
    return {
      kind,
      objective: "avaliar o documento/material visual e transformar em resumo ou próximos passos",
      expectedData: ["assunto", "pontos importantes", "prazos", "riscos", "ações necessárias"],
      acceptedModes: ["PDF pesquisável", "print nítido", "texto copiado", "recortes por página"],
      preferredMode: "PDF pesquisável",
      shouldAttemptExtraction: false,
    };
  }

  return {
    kind,
    objective: "entender o material visual e continuar a tarefa com o melhor próximo formato",
    expectedData: ["objetivo da análise", "informações visíveis", "pontos acionáveis"],
    acceptedModes: ["print/imagem", "PDF", "link", "export", "texto complementar"],
    preferredMode: labelAttachmentKind(attachmentKind),
    shouldAttemptExtraction: false,
  };
}

export function detectVisualTaskPlan(input: {
  text?: string;
  attachmentKind: VisualAttachmentKind;
  previous?: VisualTaskState;
}): VisualTaskPlan {
  const normalized = normalize(input.text ?? "");
  if (!normalized && input.previous) {
    return buildPlanForKind(input.previous.kind, input.attachmentKind);
  }

  if (hasAny(normalized, AGENDA_TERMS)) {
    return buildPlanForKind("agenda_import", input.attachmentKind);
  }
  if (hasAny(normalized, SOCIAL_TERMS)) {
    return buildPlanForKind("social_profile_analysis", input.attachmentKind);
  }
  if (hasAny(normalized, TASK_TERMS)) {
    return buildPlanForKind("task_extraction", input.attachmentKind);
  }
  if (hasAny(normalized, DOCUMENT_TERMS)) {
    return buildPlanForKind("document_review", input.attachmentKind);
  }

  return buildPlanForKind(input.previous?.kind ?? "general_visual", input.attachmentKind);
}

export function buildVisualTaskState(input: BuildStateInput): VisualTaskState {
  const now = input.now ?? Date.now();
  const file: VisualTaskAttachment = {
    ...input.attachment,
    receivedAt: now,
  };
  const files = input.previous ? [...input.previous.files, file] : [file];

  return {
    kind: input.plan.kind,
    objective: input.plan.objective,
    files,
    status: input.plan.shouldAttemptExtraction ? "extracting" : "open",
    extractionAttempts: input.previous?.extractionAttempts ?? 0,
    lastFailure: input.previous?.lastFailure,
    nextBestSteps: buildNextBestSteps(input.plan),
    openedAt: input.previous?.openedAt ?? now,
    updatedAt: now,
  };
}

export function markVisualTaskDraftReady(state: VisualTaskState, now = Date.now()): VisualTaskState {
  return {
    ...state,
    status: "draft_ready",
    updatedAt: now,
  };
}

export function markVisualTaskExtractionFailed(
  state: VisualTaskState,
  failure: string,
  now = Date.now(),
): VisualTaskState {
  return {
    ...state,
    status: "awaiting_better_material",
    extractionAttempts: state.extractionAttempts + 1,
    lastFailure: failure,
    nextBestSteps: buildFailureNextBestSteps(state.kind),
    updatedAt: now,
  };
}

export function buildVisualTaskStrategyReply(state: VisualTaskState, plan: VisualTaskPlan): string {
  const latest = state.files[state.files.length - 1];
  const fileCount = state.files.length;
  const opening = fileCount > 1
    ? `Recebi ${fileCount} materiais desta tarefa visual. Vou tratar como a mesma missão.`
    : `Recebi ${latest ? labelAttachmentKind(latest.kind) : "material visual"} para uma tarefa visual.`;

  if (plan.shouldAttemptExtraction) {
    return [
      opening,
      `Vou tentar extrair ${plan.expectedData.join(", ")}.`,
      latest ? `Origem atual: ${latest.fileName}.` : undefined,
      `Modo inicial: ${labelAttachmentKind(latest?.kind ?? "image")}. Melhor alternativa se falhar: ${plan.preferredMode}.`,
      "Se eu não conseguir ler com segurança, continuo com o mesmo objetivo e te digo o melhor próximo formato sem perder o contexto.",
    ].filter(Boolean).join("\n");
  }

  return [
    opening,
    `Objetivo entendido: ${plan.objective}.`,
    `Posso trabalhar com: ${plan.acceptedModes.join(", ")}.`,
    `Vou começar pelo material enviado. Se não for suficiente, te peço o próximo melhor formato: ${plan.preferredMode}.`,
    state.kind === "general_visual"
      ? "Se quiser acelerar, mande junto o objetivo: agenda, tarefas, análise de perfil, relatório ou resumo."
      : "Continuo com esta tarefa aberta para os próximos prints/arquivos que você mandar.",
  ].join("\n");
}

export function buildVisualTaskUnsupportedReply(state: VisualTaskState, plan: VisualTaskPlan): string {
  return [
    `Vou manter esta tarefa aberta: ${plan.objective}.`,
    "Nesta etapa ainda não vou tentar uma extração automática completa desse tipo de material.",
    `Melhor próximo passo: ${plan.preferredMode}.`,
    "Se você mandar mais prints/arquivos ou colar o texto principal, eu sigo daqui.",
  ].join("\n");
}

export function buildVisualTaskFailureReply(state: VisualTaskState): string {
  return [
    `Não consegui extrair os dados com segurança deste material, mas continuo com o objetivo de ${state.objective}.`,
    state.lastFailure ? `Motivo curto: ${state.lastFailure}.` : undefined,
    "O melhor próximo passo é:",
    ...state.nextBestSteps.map((step, index) => `${index + 1}. ${step}`),
    "Assim que você mandar o próximo material, eu continuo do ponto em que parei.",
  ].filter(Boolean).join("\n");
}

export function shouldAttemptScheduleImport(plan: VisualTaskPlan): boolean {
  return plan.kind === "agenda_import" && plan.shouldAttemptExtraction;
}

export function isVisualTaskLikelyTopLevelRequest(text: string): boolean {
  const normalized = normalize(text);
  return hasAny(normalized, [...AGENDA_TERMS, ...SOCIAL_TERMS, ...TASK_TERMS, ...DOCUMENT_TERMS]) ||
    /\b(print|screenshot|foto|imagem|pdf|arquivo|documento)\b/.test(normalized);
}

function buildNextBestSteps(plan: VisualTaskPlan): string[] {
  if (plan.kind === "agenda_import") {
    return ["enviar PDF pesquisável", "enviar print mais nítido", "enviar cortes por dia ou período"];
  }
  return [`enviar ${plan.preferredMode}`, "mandar mais contexto em texto", "enviar recortes menores se o material estiver poluído"];
}

function buildFailureNextBestSteps(kind: VisualTaskKind): string[] {
  if (kind === "agenda_import") {
    return ["enviar um print mais nítido", "enviar um PDF pesquisável", "enviar cortes por dia/período"];
  }
  if (kind === "social_profile_analysis") {
    return ["enviar prints da bio, feed e métricas", "mandar o link do perfil", "dizer o objetivo da análise"];
  }
  if (kind === "task_extraction") {
    return ["enviar PDF pesquisável ou texto exportado", "mandar print mais nítido", "recortar apenas a área das pendências"];
  }
  return ["enviar PDF pesquisável", "mandar print mais nítido", "colar o texto principal no chat"];
}
