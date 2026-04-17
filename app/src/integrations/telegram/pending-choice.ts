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

const CANCEL_REPLIES = [
  "cancelar",
  "cancelar isso",
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

function parseNumericChoice(text: string): number | undefined {
  const normalized = normalize(text);
  const exactMatch = normalized.match(/^(?:opcao|opção)?\s*(\d{1,2})$/);
  if (exactMatch?.[1]) {
    return Number.parseInt(exactMatch[1], 10);
  }

  return ORDINAL_TO_INDEX.get(normalized);
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

  return {
    createdAt,
    assistantText: text.trim(),
    options,
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

  const numericChoice = parseNumericChoice(replyText);
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

  if (AFFIRMATIVE_REPLIES.includes(normalized)) {
    if (state.options.length === 1) {
      return {
        kind: "select",
        option: state.options[0]!,
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
