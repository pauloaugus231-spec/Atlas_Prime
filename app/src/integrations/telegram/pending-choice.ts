function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const CHOICE_CUES = [
  "escolha uma",
  "escolha a opcao",
  "escolha a opção",
  "escolha uma das opcoes",
  "escolha uma das opções",
  "responda com o numero",
  "responda com o número",
  "responda com 1",
  "responda com",
  "responda apenas uma das opcoes",
  "responda apenas uma das opções",
  "qual prefere",
  "qual opcao",
  "qual opção",
  "opcao desejada",
  "opção desejada",
  "uma das opcoes rapidas",
  "uma das opções rápidas",
  "execute uma das opcoes",
  "execute uma das opções",
];

const AFFIRMATIVE_REPLIES = [
  "sim",
  "ok",
  "okay",
  "pode seguir",
  "seguir",
];

const REFERENTIAL_REPLIES = [
  "essa",
  "essa mesmo",
  "pode seguir com essa",
];

const CANCEL_REPLIES = [
  "cancelar",
  "cancelar isso",
  "cancelar rascunho",
  "descartar rascunho",
  "cancela",
];

const ORDINAL_TO_INDEX = new Map<string, number>([
  ["primeira", 1],
  ["primeiro", 1],
  ["segunda", 2],
  ["segundo", 2],
  ["terceira", 3],
  ["terceiro", 3],
  ["quarta", 4],
  ["quarto", 4],
  ["quinta", 5],
  ["quinto", 5],
]);

export interface PendingChoiceOption {
  index: number;
  label: string;
}

export interface PendingChoiceState {
  createdAt: number;
  assistantText: string;
  options: PendingChoiceOption[];
  recommendedOptionIndex?: number;
}

export type PendingChoiceReplyResolution =
  | { kind: "no_match" }
  | { kind: "cancel"; message: string }
  | { kind: "clarify"; message: string }
  | { kind: "select"; option: PendingChoiceOption };

function hasChoiceCue(text: string): boolean {
  const normalized = normalize(text);
  return CHOICE_CUES.some((token) => normalized.includes(token));
}

function buildInvalidChoiceMessage(options: PendingChoiceOption[]): string {
  const valid = options.map((option) => String(option.index));
  return `Escolha uma opção válida: ${valid.join(", ")} ou \`cancelar\`.`;
}

function parseNumericChoice(text: string, state: PendingChoiceState): number | undefined {
  const normalized = normalize(text);
  const exactMatch = normalized.match(/^(?:quero\s+)?(?:(?:seguir|segue|siga)\s+com\s+)?(?:(?:a\s+opcao|a\s+opção|opcao|opção|a)\s+)?(\d{1,2})$/);
  if (exactMatch?.[1]) {
    return Number.parseInt(exactMatch[1], 10);
  }

  const ordinalMatch = normalized.match(/^(?:(?:a|o)\s+)?(primeira|primeiro|segunda|segundo|terceira|terceiro|quarta|quarto|quinta|quinto)$/);
  if (ordinalMatch?.[1]) {
    return ORDINAL_TO_INDEX.get(ordinalMatch[1]);
  }

  if (["a ultima", "a última", "o ultimo", "o último", "ultima", "última", "ultimo", "último"].includes(normalized)) {
    return state.options[state.options.length - 1]?.index;
  }

  if (REFERENTIAL_REPLIES.includes(normalized)) {
    return state.recommendedOptionIndex ?? (state.options.length === 1 ? state.options[0]?.index : undefined);
  }

  return ORDINAL_TO_INDEX.get(normalized);
}

function parseOptionStartMinutes(label: string): number | undefined {
  const normalized = normalize(label);
  const match =
    normalized.match(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?,\s*(\d{1,2})(?::(\d{2}))?/) ??
    normalized.match(/\b(\d{1,2})(?::(\d{2}))\s*[–-]/) ??
    normalized.match(/\b(\d{1,2})h(\d{2})?\s*[–-]/);
  if (!match?.[1]) {
    return undefined;
  }

  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2] ?? "0", 10);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23 || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    return undefined;
  }

  return hour * 60 + minute;
}

function parseContextualTimeChoice(text: string): number | undefined {
  const normalized = normalize(text);
  const match =
    normalized.match(/^(?:o\s+)?(?:de|das?|as?)\s+(\d{1,2})h(\d{2})?$/) ??
    normalized.match(/^(?:o\s+)?(?:de|das?|as?)\s+(\d{1,2}):(\d{2})$/) ??
    normalized.match(/^(?:o\s+)?(?:de|das?|as?)\s+(\d{1,2})$/);
  if (!match?.[1]) {
    return undefined;
  }

  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2] ?? "0", 10);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23 || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    return undefined;
  }

  return hour * 60 + minute;
}

function parseContextualPeriodChoice(text: string): "morning" | "afternoon" | "night" | undefined {
  const normalized = normalize(text);
  const match = normalized.match(/^(?:o\s+)?(?:da|de)\s+(manha|tarde|noite)$/);
  if (!match?.[1]) {
    return undefined;
  }
  if (match[1] === "manha") {
    return "morning";
  }
  if (match[1] === "tarde") {
    return "afternoon";
  }
  return "night";
}

function periodMatches(minutes: number, period: "morning" | "afternoon" | "night"): boolean {
  const hour = Math.floor(minutes / 60);
  if (period === "morning") {
    return hour >= 0 && hour < 12;
  }
  if (period === "afternoon") {
    return hour >= 12 && hour < 18;
  }
  return hour >= 18 && hour < 24;
}

function buildAmbiguousContextualChoiceMessage(options: PendingChoiceOption[]): string {
  const valid = options.map((option) => String(option.index));
  return `Encontrei mais de uma opção compatível. Responda com o número: ${valid.join(", ")}.`;
}

function resolveContextualCalendarChoice(
  state: PendingChoiceState,
  replyText: string,
): PendingChoiceReplyResolution | null {
  const targetMinutes = parseContextualTimeChoice(replyText);
  const targetPeriod = typeof targetMinutes === "number" ? undefined : parseContextualPeriodChoice(replyText);
  if (typeof targetMinutes !== "number" && !targetPeriod) {
    return null;
  }

  const matches = state.options.filter((option) => {
    const optionMinutes = parseOptionStartMinutes(option.label);
    if (typeof optionMinutes !== "number") {
      return false;
    }
    if (typeof targetMinutes === "number") {
      return optionMinutes === targetMinutes;
    }
    return periodMatches(optionMinutes, targetPeriod!);
  });

  if (matches.length === 1) {
    return {
      kind: "select",
      option: matches[0]!,
    };
  }

  if (matches.length > 1) {
    return {
      kind: "clarify",
      message: buildAmbiguousContextualChoiceMessage(matches),
    };
  }

  return {
    kind: "clarify",
    message: buildInvalidChoiceMessage(state.options),
  };
}

function isShortReply(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) {
    return false;
  }
  return normalized.length <= 24 && normalized.split(" ").length <= 4;
}

export function extractPendingChoiceState(text: string, createdAt = Date.now()): PendingChoiceState | null {
  if (!hasChoiceCue(text)) {
    return null;
  }

  const options: PendingChoiceOption[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(/^(\d{1,2})[\)\.]\s+(.+)$/);
    if (!match?.[1] || !match[2]?.trim()) {
      continue;
    }

    const index = Number.parseInt(match[1], 10);
    if (!Number.isFinite(index) || options.some((option) => option.index === index)) {
      continue;
    }

    options.push({
      index,
      label: match[2].trim(),
    });
  }

  if (options.length < 2 || options.length > 6) {
    return null;
  }

  const recommendedOptionIndex = options.find((option) =>
    normalize(option.label).includes("recomendad")
  )?.index;

  return {
    createdAt,
    assistantText: text.trim(),
    options,
    recommendedOptionIndex,
  };
}

export function resolvePendingChoiceReply(
  state: PendingChoiceState | null | undefined,
  replyText: string,
): PendingChoiceReplyResolution {
  if (!state) {
    return { kind: "no_match" };
  }

  const normalized = normalize(replyText);
  if (!normalized) {
    return { kind: "no_match" };
  }

  if (CANCEL_REPLIES.includes(normalized)) {
    return {
      kind: "cancel",
      message: "Escolha pendente cancelada. Pode mandar o próximo pedido.",
    };
  }

  const numericChoice = parseNumericChoice(replyText, state);
  if (typeof numericChoice === "number") {
    const option = state.options.find((item) => item.index === numericChoice);
    if (option) {
      return {
        kind: "select",
        option,
      };
    }

    return {
      kind: "clarify",
      message: buildInvalidChoiceMessage(state.options),
    };
  }

  const contextualChoice = resolveContextualCalendarChoice(state, replyText);
  if (contextualChoice) {
    return contextualChoice;
  }

  if (AFFIRMATIVE_REPLIES.includes(normalized)) {
    const preferredOption = state.recommendedOptionIndex
      ? state.options.find((item) => item.index === state.recommendedOptionIndex)
      : state.options.length === 1
        ? state.options[0]
        : undefined;
    if (preferredOption) {
      return {
        kind: "select",
        option: preferredOption,
      };
    }

    return {
      kind: "clarify",
      message: buildInvalidChoiceMessage(state.options),
    };
  }

  if (isShortReply(replyText)) {
    return {
      kind: "clarify",
      message: buildInvalidChoiceMessage(state.options),
    };
  }

  return { kind: "no_match" };
}

export function buildPendingChoiceContinuationPrompt(input: {
  state: PendingChoiceState;
  option: PendingChoiceOption;
  userReply: string;
}): string {
  return [
    "Continuidade de escolha pendente no Telegram.",
    "O usuário respondeu a uma lista de opções numeradas apresentada no turno anterior.",
    `Resposta curta do usuário: ${input.userReply.trim()}`,
    `Opção escolhida: ${input.option.index}) ${input.option.label}`,
    "Continue exatamente a partir dessa opção.",
    "Não trate isso como um novo pedido genérico.",
    "Não abra um novo questionário amplo.",
    "Se faltar um dado crítico para a própria opção, faça uma pergunta curta e específica.",
    "Se não houver capacidade real de executar nesta runtime, diga isso objetivamente e ofereça no máximo 2 alternativas concretas.",
    "",
    "Mensagem anterior com as opções:",
    input.state.assistantText,
  ].join("\n");
}
