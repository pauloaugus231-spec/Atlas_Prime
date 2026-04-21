import { normalizeEmailAnalysisText } from "../integrations/email/email-analysis.js";
import type {
  PersonalOperationalMemoryItemKind,
  PersonalOperationalProfile,
  UpdatePersonalOperationalProfileInput,
} from "../types/personal-operational-memory.js";
import type { CreateLearnedPreferenceInput } from "../types/learned-preferences.js";
import type { LearnedPreference } from "../types/learned-preferences.js";
import {
  looksLikeCapabilityAwareTravelPrompt,
  looksLikeCapabilityAwareWebPrompt,
  looksLikeCapabilityInspectionPrompt,
} from "./capability-planner.js";
import { looksLikeLowFrictionReadPrompt } from "./clarification-rules.js";
import { interpretConversationTurn } from "./conversation-interpreter.js";
import { isGoogleEventCreatePrompt, isGoogleTaskCreatePrompt } from "./google-draft-utils.js";
import type { IntentResolution } from "./intent-router.js";
import type { ReasoningTrace } from "./reasoning-engine.js";
import type { WebResearchMode } from "./web-research.js";

function includesAny(source: string, tokens: string[]): boolean {
  return tokens.some((token) => source.includes(token));
}

export function isEmailFocusedPrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return [
    "email",
    "e-mail",
    "inbox",
    "caixa de entrada",
    "remetente",
    "assunto",
    "uid ",
    "uid=",
  ].some((token) => normalized.includes(token));
}

export function extractEmailUidFromPrompt(prompt: string): string | undefined {
  const match = prompt.match(/\buid(?:\s*=|\s+)?([a-z0-9_-]+)\b/i);
  if (!match) {
    return undefined;
  }
  return match[1]?.trim() || undefined;
}

export function isEmailDraftPrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const hasExactTextIntent = /(?:use|envie|responda)\s+exatamente(?:\s+este|\s+esse|\s+o)?\s+texto/i.test(prompt);
  const hasDraftIntent = [
    "redija",
    "rascunho",
    "resposta",
    "responda",
    "escreva",
    "reply",
    "ajuste o rascunho",
    "ajuste a resposta",
  ].some((token) => normalized.includes(token));
  const hasNoSendIntent = [
    "não envie",
    "nao envie",
    "sem enviar",
    "não mandar",
    "nao mandar",
    "apenas redija",
    "só redija",
    "so redija",
  ].some((token) => normalized.includes(token));

  return (hasDraftIntent || hasExactTextIntent) && hasNoSendIntent && isEmailFocusedPrompt(prompt);
}

export function extractExactReplyBody(prompt: string): string | undefined {
  const match = prompt.match(
    /(?:use|envie|responda)\s+exatamente(?:\s+este|\s+esse|\s+o)?\s+texto\s*:?\s*([\s\S]+)$/i,
  );
  const body = match?.[1]
    ?.replace(/\bnao envie ainda\.?$/i, "")
    ?.replace(/\bnão envie ainda\.?$/i, "")
    ?.trim();
  return body ? body : undefined;
}

export function isEmailSummaryPrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const hasSummaryIntent = [
    "resuma",
    "resumo",
    "resumir",
    "prioridade",
    "triagem",
    "ação",
    "acao",
    "exige ação",
    "exige acao",
    "próxima ação",
    "proxima acao",
    "me diga",
    "me entregue",
  ].some((token) => normalized.includes(token));

  return hasSummaryIntent && extractEmailUidFromPrompt(prompt) !== undefined;
}

export function isInboxTriagePrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const hasTriageIntent = ["triagem", "triage", "classifique", "priorize", "prioridade", "organize", "executivo"].some((token) =>
    normalized.includes(token),
  );
  const hasInboxIntent = ["inbox", "caixa de entrada", "emails recentes", "emails nao lidos", "emails não lidos", "email principal"].some((token) =>
    normalized.includes(token),
  );
  return hasTriageIntent && hasInboxIntent;
}

export function isFollowUpReviewPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  const hasFollowUp = includesAny(normalized, ["follow-up", "follow up", "followup", "retorno", "retornos"]);
  const hasAction = includesAny(normalized, ["revise", "revisar", "organize", "organizar", "priorize", "priorizar", "mostre", "liste"]);
  return hasFollowUp && hasAction;
}

export function isNextCommitmentPrepPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "prepare meu proximo compromisso",
    "prepare meu próximo compromisso",
    "preparar meu proximo compromisso",
    "preparar meu próximo compromisso",
    "como me preparar para meu proximo compromisso",
    "como me preparar para meu próximo compromisso",
    "preparar o proximo compromisso",
    "preparar o próximo compromisso",
  ]);
}

export function isSupportReviewPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  const hasSupportIntent = includesAny(normalized, [
    "suporte",
    "ticket",
    "tickets",
    "fila de suporte",
    "fila de atendimento",
    "atendimento",
    "clientes",
  ]);
  const hasActionIntent = includesAny(normalized, [
    "revise",
    "revisar",
    "organize",
    "organizar",
    "priorize",
    "priorizar",
    "triagem",
    "triage",
    "fila",
    "responda",
    "responder",
    "mostre",
    "liste",
  ]);
  return hasSupportIntent && hasActionIntent;
}

export function isUrgentSupportSignal(value: string): boolean {
  const normalized = normalizeEmailAnalysisText(value);
  return includesAny(normalized, [
    "urgente",
    "hoje",
    "agora",
    "falha",
    "erro",
    "problema",
    "travado",
    "travou",
    "nao consigo",
    "não consigo",
    "bloqueado",
    "bloqueada",
    "sem acesso",
  ]);
}

export function extractSupportTheme(value: string): string | null {
  const normalized = normalizeEmailAnalysisText(value);
  if (!normalized) {
    return null;
  }
  if (includesAny(normalized, ["login", "acesso", "senha", "entrar"])) {
    return "acesso e login";
  }
  if (includesAny(normalized, ["pagamento", "cobranca", "cobrança", "boleto", "pix", "assinatura"])) {
    return "pagamento e cobrança";
  }
  if (includesAny(normalized, ["erro", "falha", "bug", "travado", "travou", "problema"])) {
    return "erro e instabilidade";
  }
  if (includesAny(normalized, ["duvida", "dúvida", "como", "onboarding", "configurar", "usar"])) {
    return "uso e onboarding";
  }
  if (includesAny(normalized, ["cancel", "reembolso", "reembols", "encerrar"])) {
    return "cancelamento e risco";
  }
  return "atendimento geral";
}

export function isOperationalBriefPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return [
    "brief diario",
    "brief diário",
    "meu dia",
    "como esta meu dia",
    "como está meu dia",
    "como ta meu dia",
    "como tá meu dia",
    "status do dia",
    "o que apareceu de importante",
    "o que tenho de importante",
    "agenda de hoje",
    "compromissos de hoje",
    "tarefas de hoje",
    "me de minha agenda",
    "me de meu brief",
  ].some((token) => normalized.includes(token));
}

export function isMorningBriefPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return [
    "morning briefing",
    "briefing da manha",
    "briefing da manhã",
    "brief matinal",
    "resumo da manha",
    "resumo da manhã",
    "me de o resumo da manha",
    "me de o resumo da manhã",
  ].some((token) => normalized.includes(token));
}

export function extractOperationalMode(prompt: string): "field" | null {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (normalized.includes("modo_operacional=field")) {
    return "field";
  }
  return null;
}

export function resolveEffectiveOperationalMode(
  prompt: string,
  profile?: PersonalOperationalProfile,
): "field" | null {
  const explicit = extractOperationalMode(prompt);
  if (explicit) {
    return explicit;
  }
  return profile?.defaultOperationalMode === "field" ? "field" : null;
}

export function isMacQueueStatusPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (normalized.includes("liste")) {
    return false;
  }
  return ["fila do mac", "worker do mac", "status do mac", "mac worker", "comandos do mac"].some((token) =>
    normalized.includes(token),
  );
}

export function isMacQueueListPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return ["liste os comandos do mac", "liste a fila do mac", "comandos pendentes do mac", "fila pendente do mac"].some((token) =>
    normalized.includes(token),
  );
}

export function extractMacOpenApp(prompt: string): string | undefined {
  const normalized = normalizeEmailAnalysisText(prompt);
  const aliases: Array<[string, string]> = [
    ["vscode", "Visual Studio Code"],
    ["visual studio code", "Visual Studio Code"],
    ["chrome", "Google Chrome"],
    ["google chrome", "Google Chrome"],
    ["safari", "Safari"],
    ["telegram", "Telegram"],
    ["terminal", "Terminal"],
    ["finder", "Finder"],
    ["whatsapp", "WhatsApp"],
    ["notes", "Notes"],
    ["notas", "Notes"],
  ];

  if (!(normalized.includes("no meu mac") || normalized.includes("no mac") || normalized.includes("no computador"))) {
    return undefined;
  }

  for (const [alias, appName] of aliases) {
    if (normalized.includes(`abra o ${alias}`) || normalized.includes(`abrir o ${alias}`) || normalized.includes(`abrir ${alias}`) || normalized.includes(`abra ${alias}`)) {
      return appName;
    }
  }

  return undefined;
}

export function extractMacOpenUrl(prompt: string): string | undefined {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (!(normalized.includes("no meu mac") || normalized.includes("no mac") || normalized.includes("no computador"))) {
    return undefined;
  }
  const match = prompt.match(/https?:\/\/[^\s)]+/i);
  if (match) {
    return match[0];
  }

  const aliases: Array<[string, string]> = [
    ["gmail", "https://mail.google.com/"],
    ["google calendar", "https://calendar.google.com/"],
    ["agenda google", "https://calendar.google.com/"],
    ["agenda", "https://calendar.google.com/"],
    ["github", "https://github.com/"],
    ["supabase", "https://supabase.com/dashboard"],
    ["chatgpt", "https://chatgpt.com/"],
    ["whatsapp web", "https://web.whatsapp.com/"],
    ["telegram web", "https://web.telegram.org/"],
  ];

  for (const [alias, url] of aliases) {
    if (normalized.includes(`abra ${alias}`) || normalized.includes(`abrir ${alias}`) || normalized.includes(`abra o ${alias}`) || normalized.includes(`abrir o ${alias}`)) {
      return url;
    }
  }

  return undefined;
}

export function extractMacNotificationText(prompt: string): string | undefined {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (!(normalized.includes("no meu mac") || normalized.includes("no mac") || normalized.includes("no computador"))) {
    return undefined;
  }

  const match = prompt.match(/(?:notifique|mostre uma notificacao|mostre uma notificação|exiba uma notificacao|exiba uma notificação).{0,20}?(?:que|com)\s+(.+)$/i);
  return match?.[1]?.trim();
}

export function extractMacProjectOpenAlias(prompt: string): string | undefined {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (!(normalized.includes("no meu mac") || normalized.includes("no mac") || normalized.includes("no computador"))) {
    return undefined;
  }

  const match = prompt.match(/(?:abra|abrir)\s+(?:o\s+)?(?:projeto|pasta)\s+(.+?)\s+no\s+(?:meu\s+)?mac/i);
  return match?.[1]?.trim();
}

export function extractMacProjectCommand(prompt: string): { argv: string[]; projectAlias: string } | undefined {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (!(normalized.includes("no meu mac") || normalized.includes("no mac") || normalized.includes("no computador"))) {
    return undefined;
  }

  const patterns: Array<{ pattern: RegExp; argv: string[] }> = [
    { pattern: /(?:rode|execute)\s+git status\s+(?:no|na)\s+(?:projeto|pasta)\s+(.+?)\s+no\s+(?:meu\s+)?mac/i, argv: ["git", "status", "--short"] },
    { pattern: /(?:rode|execute)\s+git branch(?:\s+--show-current)?\s+(?:no|na)\s+(?:projeto|pasta)\s+(.+?)\s+no\s+(?:meu\s+)?mac/i, argv: ["git", "branch", "--show-current"] },
    { pattern: /(?:rode|execute)\s+npm run build\s+(?:no|na)\s+(?:projeto|pasta)\s+(.+?)\s+no\s+(?:meu\s+)?mac/i, argv: ["npm", "run", "build"] },
    { pattern: /(?:rode|execute)\s+npm run dev\s+(?:no|na)\s+(?:projeto|pasta)\s+(.+?)\s+no\s+(?:meu\s+)?mac/i, argv: ["npm", "run", "dev"] },
    { pattern: /(?:rode|execute)\s+npm test\s+(?:no|na)\s+(?:projeto|pasta)\s+(.+?)\s+no\s+(?:meu\s+)?mac/i, argv: ["npm", "test"] },
    { pattern: /(?:rode|execute)\s+pnpm build\s+(?:no|na)\s+(?:projeto|pasta)\s+(.+?)\s+no\s+(?:meu\s+)?mac/i, argv: ["pnpm", "build"] },
    { pattern: /(?:rode|execute)\s+pnpm dev\s+(?:no|na)\s+(?:projeto|pasta)\s+(.+?)\s+no\s+(?:meu\s+)?mac/i, argv: ["pnpm", "dev"] },
    { pattern: /(?:rode|execute)\s+pnpm test\s+(?:no|na)\s+(?:projeto|pasta)\s+(.+?)\s+no\s+(?:meu\s+)?mac/i, argv: ["pnpm", "test"] },
    { pattern: /(?:rode|execute)\s+yarn build\s+(?:no|na)\s+(?:projeto|pasta)\s+(.+?)\s+no\s+(?:meu\s+)?mac/i, argv: ["yarn", "build"] },
    { pattern: /(?:rode|execute)\s+yarn dev\s+(?:no|na)\s+(?:projeto|pasta)\s+(.+?)\s+no\s+(?:meu\s+)?mac/i, argv: ["yarn", "dev"] },
    { pattern: /(?:rode|execute)\s+yarn test\s+(?:no|na)\s+(?:projeto|pasta)\s+(.+?)\s+no\s+(?:meu\s+)?mac/i, argv: ["yarn", "test"] },
  ];

  for (const entry of patterns) {
    const match = prompt.match(entry.pattern);
    if (match?.[1]?.trim()) {
      return {
        argv: entry.argv,
        projectAlias: match[1].trim(),
      };
    }
  }

  return undefined;
}

export function isGoogleTasksPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return (
    includesAny(normalized, [
      "tarefas do google",
      "tarefas google",
      "google tasks",
      "minhas tarefas",
      "tarefas abertas",
      "minhas tasks",
    ]) && !normalized.includes("brief")
  );
}

export function isGoogleContactsPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "procure o contato",
    "buscar contato",
    "busque o contato",
    "google contacts",
    "contato no google",
    "contatos do google",
  ]);
}

export function isGoogleCalendarsListPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "liste os calendarios disponiveis",
    "liste os calendários disponíveis",
    "quais calendarios estao disponiveis",
    "quais calendários estão disponíveis",
    "liste meus calendarios",
    "liste meus calendários",
    "quais calendarios eu tenho",
    "quais calendários eu tenho",
    "listar calendarios",
    "listar calendários",
  ]);
}

export function isPlaceLookupPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "qual endereco",
    "qual endereço",
    "endereco do",
    "endereço do",
    "endereco da",
    "endereço da",
    "localizacao de",
    "localização de",
    "onde fica",
    "procure no maps",
    "busque no maps",
    "google maps",
    "no maps",
  ]) && !normalized.includes("email") && !normalized.includes("e-mail");
}

export function extractPlaceLookupQuery(prompt: string): string | undefined {
  const patterns = [
    /(?:qual(?:\s+e| é)?\s+o\s+)?(?:endereco|endereço|localizacao|localização)\s+(?:do|da|de)\s+["“]?(.+?)["”]?(?=(?:[?.!,;:]|$))/i,
    /(?:onde\s+fica)\s+["“]?(.+?)["”]?(?=(?:[?.!,;:]|$))/i,
    /(?:procure|busque)\s+(?:no\s+)?(?:google\s+maps|maps)\s+(?:por\s+)?["“]?(.+?)["”]?(?=(?:[?.!,;:]|$))/i,
  ];
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    const value = match?.[1]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function extractGoogleContactsQuery(prompt: string): string | undefined {
  const explicitMatch = prompt.match(
    /(?:procure|buscar|busque)\s+(?:o\s+)?contato\s+["“]?(.+?)["”]?(?=(?:[?.!,;:]|$))/i,
  );
  if (explicitMatch?.[1]?.trim()) {
    return explicitMatch[1].trim();
  }

  const genericMatch = prompt.match(
    /(?:contato|contacts?)\s+["“]?(.+?)["”]?(?=(?:[?.!,;:]|$))/i,
  );
  return genericMatch?.[1]?.trim();
}

export function isWebResearchPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  const hasWebIntent = includesAny(normalized, [
    "pesquise",
    "na internet",
    "com fontes",
    "tendencia",
    "tendência",
    "valide",
    "estude",
    "pesquisa web",
    "pesquisa de mercado",
    "procure por",
    "buscar por",
    "busque por",
    "ache informacoes",
    "ache informações",
    "encontre informacoes",
    "encontre informações",
    "procure na internet",
    "busque na internet",
    "qual endereco",
    "qual endereço",
    "onde fica",
    "endereco do",
    "endereço do",
  ]);

  return (
    hasWebIntent &&
    !normalized.includes("email") &&
    !normalized.includes("e-mail") &&
    !normalized.includes("contato") &&
    !normalized.includes("contatos") &&
    !normalized.includes("previsao do tempo") &&
    !normalized.includes("previsão do tempo") &&
    !normalized.includes("clima ") &&
    !normalized.includes("temperatura ") &&
    !normalized.includes("vai chover") &&
    !normalized.includes("workspace") &&
    !normalized.includes("arquivo") &&
    !normalized.includes("pasta")
  );
}

export function isWeatherPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "previsao do tempo",
    "previsão do tempo",
    "clima em",
    "qual o clima",
    "como esta o clima",
    "como está o clima",
    "clima hoje",
    "clima agora",
    "clima amanha",
    "clima amanhã",
    "tempo em",
    "como esta o tempo",
    "como está o tempo",
    "tempo hoje",
    "tempo agora",
    "tempo amanha",
    "tempo amanhã",
    "temperatura em",
    "temperatura hoje",
    "vai chover em",
    "vai chover hoje",
    "vai chover amanha",
    "vai chover amanhã",
    "vai chover",
    "chuva em",
  ]);
}

export function isGreetingPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (!normalized || isMorningBriefPrompt(prompt) || isOperationalBriefPrompt(prompt)) {
    return false;
  }

  return [
    /^oi(?:\s+atlas)?$/,
    /^ola(?:\s+atlas)?$/,
    /^olá(?:\s+atlas)?$/,
    /^bom dia(?:\s+atlas)?$/,
    /^boa tarde(?:\s+atlas)?$/,
    /^boa noite(?:\s+atlas)?$/,
    /^e ai(?:\s+atlas)?$/,
    /^hey(?:\s+atlas)?$/,
    /^tudo certo\??$/,
    /^tudo certo(?:\s+por ai|\s+por aí)?\??$/,
    /^como\s+(?:voce|você)\s+esta\??$/,
    /^como\s+esta\??$/,
    /^oi\s+atlas[, ]+como\s+(?:voce|você)\s+esta\??$/,
    /^oi\s+atlas[, ]+como\s+esta\??$/,
    /^atlas[, ]+como\s+(?:voce|você)\s+esta\??$/,
    /^atlas[, ]+como\s+esta\??$/,
  ].some((pattern) => pattern.test(normalized));
}

export function isAgentIdentityPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "como prefere ser chamado",
    "como voce prefere ser chamado",
    "como você prefere ser chamado",
    "qual seu nome",
    "como devo te chamar",
    "como posso te chamar",
  ]);
}

export function buildAgentIdentityReply(preferredAgentName = "Atlas"): string {
  return [
    `Pode me chamar de ${preferredAgentName}.`,
    "Se preferir algo mais direto, pode usar Agente.",
  ].join("\n");
}

export function extractFirstName(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.split(/\s+/)[0];
}

export function buildGreetingReply(
  prompt: string,
  options?: {
    profile?: PersonalOperationalProfile;
    operationalMode?: "field" | null;
  },
): string {
  const normalized = normalizeEmailAnalysisText(prompt);
  const firstName = extractFirstName(options?.profile?.displayName);
  const greetingName = firstName ? `, ${firstName}` : "";
  const compact = options?.operationalMode === "field";

  if (normalized.startsWith("bom dia")) {
    return compact
      ? `Bom dia${greetingName}. Diz o que precisa agora.`
      : `Bom dia${greetingName}. Como posso te ajudar hoje?`;
  }
  if (normalized.startsWith("boa tarde")) {
    return compact
      ? `Boa tarde${greetingName}. Diz o que precisa agora.`
      : `Boa tarde${greetingName}. Como posso te ajudar?`;
  }
  if (normalized.startsWith("boa noite")) {
    return compact
      ? `Boa noite${greetingName}. Diz o que precisa agora.`
      : `Boa noite${greetingName}. Como posso te ajudar?`;
  }
  if (normalized.includes("como") && (normalized.includes("esta") || normalized.includes("está"))) {
    return compact
      ? `Tudo certo por aqui${greetingName}. Diz o que tu precisa agora.`
      : `Estou bem${greetingName}. Em que posso te ajudar?`;
  }
  if (normalized.includes("tudo certo")) {
    return compact
      ? `Tudo certo por aqui${greetingName}. Diz o que precisa.`
      : `Tudo certo por aqui${greetingName}. O que tu precisa agora?`;
  }

  return compact
    ? `Estou online${greetingName}. Pode mandar o pedido.`
    : `Estou online${greetingName}. Em que posso te ajudar?`;
}

export function hasTechnicalSimpleReplyFraming(reply: string): boolean {
  return [
    "Conclusão",
    "Evidência essencial",
    "Lacuna / risco",
    "Próxima ação recomendada",
  ].some((token) => reply.includes(token));
}

export function extractConclusionLine(reply: string): string | undefined {
  const lines = reply
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const explicit = lines.find((line) => /^Conclus[aã]o\s+[—-]\s*/i.test(line));
  if (explicit) {
    return explicit.replace(/^Conclus[aã]o\s+[—-]\s*/i, "").trim();
  }

  return lines.find((line) =>
    !/^Evid[êe]ncia essencial/i.test(line)
    && !/^Lacuna \/ risco/i.test(line)
    && !/^Pr[oó]xima a[cç][aã]o recomendada/i.test(line)
  );
}

export function applyReasoningReplyPolicy(reply: string, reasoningTrace?: ReasoningTrace): string {
  if (!reasoningTrace) {
    return reply;
  }

  const lines = reply
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());

  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  const shouldCompact =
    (reasoningTrace.energyHint === "low" && nonEmptyLines.length > 8)
    || (reasoningTrace.suggestedResponseStyle === "executive" && nonEmptyLines.length > 14);
  if (!shouldCompact) {
    return reply;
  }

  const limit = reasoningTrace.energyHint === "low" ? 8 : 12;
  const compact = nonEmptyLines.slice(0, limit).join("\n");
  return `${compact}\n\nPosso detalhar se quiser.`;
}

export function rewriteConversationalSimpleReply(
  prompt: string,
  reply: string,
  options?: {
    profile?: PersonalOperationalProfile;
    operationalMode?: "field" | null;
    reasoningTrace?: ReasoningTrace;
  },
): string {
  const interpreted = interpretConversationTurn({
    text: prompt,
    operationalMode: options?.operationalMode === "field" ? "field" : "normal",
  });
  if (
    !["greeting", "weather", "briefing", "agenda", "tasks", "planning", "memory"].includes(interpreted.skill)
    || interpreted.confidence < 0.78
    || !hasTechnicalSimpleReplyFraming(reply)
  ) {
    return applyReasoningReplyPolicy(reply, options?.reasoningTrace);
  }

  if (interpreted.skill === "greeting") {
    return buildGreetingReply(prompt, options);
  }

  const conclusion = extractConclusionLine(reply);
  if (!conclusion) {
    return reply;
  }

  const normalized = conclusion.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return reply;
  }

  return applyReasoningReplyPolicy(
    /[.!?]$/.test(normalized) ? normalized : `${normalized}.`,
    options?.reasoningTrace,
  );
}

export function isConversationStyleCorrectionPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (!normalized) {
    return false;
  }

  return includesAny(normalized, [
    "essa resposta está muito verbosa",
    "essa resposta esta muito verbosa",
    "essa resposta esta muito longa",
    "essa resposta está muito longa",
    "seja mais direto",
    "seja mais objetiva",
    "mais direto",
    "mais objetiva",
    "mais objetivo",
    "responda curto",
    "responde curto",
    "responda mais curto",
    "responda mais direto",
    "resposta mais curta",
    "nao precisa perguntar tanto",
    "não precisa perguntar tanto",
    "nao precisa perguntar muito",
    "não precisa perguntar muito",
    "pergunta menos",
    "menos perguntas",
  ]);
}

export function extractConversationStyleCorrection(
  prompt: string,
  current: PersonalOperationalProfile,
): {
  profileUpdate: UpdatePersonalOperationalProfileInput;
  preferenceUpdate: import("../types/user-preferences.js").UpdateUserPreferencesInput;
  learnedPreference: CreateLearnedPreferenceInput;
  reply: string;
} | null {
  if (!isConversationStyleCorrectionPrompt(prompt)) {
    return null;
  }

  const normalized = normalizeEmailAnalysisText(prompt);
  const wantsShort = includesAny(normalized, [
    "muito verbosa",
    "muito longa",
    "mais direto",
    "mais objetiva",
    "mais objetivo",
    "responda curto",
    "responde curto",
    "responda mais curto",
    "responda mais direto",
    "resposta mais curta",
  ]);
  const wantsFewerQuestions = includesAny(normalized, [
    "nao precisa perguntar tanto",
    "não precisa perguntar tanto",
    "nao precisa perguntar muito",
    "não precisa perguntar muito",
    "pergunta menos",
    "menos perguntas",
  ]);

  const autonomyPreference = "leituras simples executam direto quando o contexto já basta";
  const profileUpdate: UpdatePersonalOperationalProfileInput = {
    responseStyle: wantsShort ? "direto e objetivo" : current.responseStyle,
    tonePreference: wantsShort ? "objetivo" : current.tonePreference,
    detailLevel: wantsShort ? "resumo" : current.detailLevel,
    briefingPreference: wantsShort ? "curto" : current.briefingPreference,
    autonomyPreferences: wantsFewerQuestions
      ? uniqueAppend(current.autonomyPreferences, [autonomyPreference])
      : current.autonomyPreferences,
  };

  const preferenceUpdate: import("../types/user-preferences.js").UpdateUserPreferencesInput = {
    responseStyle: "executive",
    responseLength: "short",
  };

  const learnedPreference: CreateLearnedPreferenceInput = wantsFewerQuestions
    ? {
        type: "response_style",
        key: "low_friction_simple_reads",
        description: "Preferência por respostas curtas e menos perguntas em pedidos simples",
        value: "responder curto e só perguntar quando faltar dado crítico",
        source: "correction",
        confidence: 0.84,
      }
    : {
        type: "response_style",
        key: "short_direct_replies",
        description: "Preferência por respostas curtas, diretas e mais resolutivas",
        value: "responder curto e direto",
        source: "correction",
        confidence: 0.8,
      };

  const reply = wantsFewerQuestions
    ? "Ajustado. Vou responder mais curto e direto, e só vou perguntar quando faltar algo realmente crítico."
    : "Ajustado. Vou responder mais curto e direto.";

  return {
    profileUpdate,
    preferenceUpdate,
    learnedPreference,
    reply,
  };
}

export function isMemoryUpdatePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return (
    includesAny(normalized, ["atualize o item", "atualizar o item", "update memory", "update_memory_item"]) &&
    normalized.includes("memoria")
  );
}

export function extractMemoryItemId(prompt: string): number | undefined {
  const match = prompt.match(/\bitem\s+(\d+)\b/i) ?? prompt.match(/\bid\s*[:=]?\s*(\d+)\b/i);
  if (!match?.[1]) {
    return undefined;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function hasMemoryUpdateFields(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "status",
    "prioridade",
    "priority",
    "titulo",
    "título",
    "title",
    "detalhes",
    "details",
    "projeto",
    "project",
    "tags",
    "horizon",
    "stage",
    "feito",
    "done",
    "open",
    "closed",
    "em andamento",
    "high",
    "medium",
    "low",
  ]);
}

export function isUserPreferencesPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "modo executivo",
    "mais executivo",
    "mais detalhado",
    "mais detalhada",
    "mais investigativo",
    "modo investigativo",
    "modo secretario",
    "modo secretário",
    "me chame de",
    "prefiro que voce se chame",
    "quais sao minhas preferencias",
    "quais são minhas preferências",
    "minhas preferencias",
    "minhas preferências",
  ]);
}

export function isPersonalMemoryListPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "liste minha memoria pessoal",
    "listar minha memoria pessoal",
    "mostre minha memoria pessoal",
    "mostrar minha memoria pessoal",
    "quais sao minhas memorias pessoais",
    "quais sao minhas regras pessoais",
    "quais sao minhas rotinas",
  ]);
}

export function isOperationalStateShowPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "mostre meu estado operacional",
    "mostrar meu estado operacional",
    "meu estado operacional",
    "estado operacional atual",
    "como esta meu estado operacional",
    "como está meu estado operacional",
  ]);
}

export function isLearnedPreferencesListPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "o que voce aprendeu sobre mim",
    "o que você aprendeu sobre mim",
    "o que voce leva em conta sobre mim",
    "o que você leva em conta sobre mim",
    "que preferencias minhas voce considera",
    "que preferências minhas você considera",
    "que padroes meus voce esta usando",
    "que padrões meus você está usando",
    "o que voce aprendeu sobre minha agenda",
    "o que você aprendeu sobre minha agenda",
    "o que voce aprendeu com minhas correcoes",
    "o que você aprendeu com minhas correções",
    "liste aprendizados",
    "liste minhas preferencias aprendidas",
    "liste minhas preferências aprendidas",
    "liste preferencias aprendidas de agenda",
    "liste preferências aprendidas de agenda",
    "mostre minhas preferencias aprendidas",
    "mostre minhas preferências aprendidas",
    "aprendizados sobre mim",
  ]);
}

export function resolveLearnedPreferencesListFilter(prompt: string): {
  search?: string;
  type?: LearnedPreference["type"];
} {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (includesAny(normalized, ["agenda", "calendario", "calendário", "importacao", "importação", "titulo", "título", "local"])) {
    return {
      search: "agenda",
    };
  }
  if (includesAny(normalized, ["alerta", "institucional", "whatsapp monitorado"])) {
    return {
      type: "alert_action",
    };
  }
  return {};
}

export function isLearnedPreferencesDeletePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "remova essa preferencia",
    "remova essa preferência",
    "remova a preferencia aprendida",
    "remova a preferência aprendida",
    "desative a preferencia aprendida",
    "desative a preferência aprendida",
    "esqueca essa preferencia",
    "esqueca essa preferência",
    "esquece a preferencia",
    "esquece a preferência",
  ]);
}

export function extractLearnedPreferenceId(prompt: string): number | undefined {
  const match = prompt.match(/#(\d{1,6})/);
  if (!match?.[1]) {
    return undefined;
  }
  const id = Number.parseInt(match[1], 10);
  return Number.isFinite(id) ? id : undefined;
}

export function extractLearnedPreferenceDeleteTarget(prompt: string): string | undefined {
  const cleaned = prompt
    .replace(/^\s*(?:remova|desative|esqueca|esqueça)\s+(?:essa\s+)?(?:a\s+)?prefer[eê]ncia\s+aprendida\s*/i, "")
    .replace(/^\s*(?:remova|desative|esqueca|esqueça)\s+essa\s+prefer[eê]ncia\s*/i, "")
    .replace(/[.;]+$/g, "")
    .trim();
  return cleaned || undefined;
}

export function isPersonalMemorySavePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  const explicitMemoryIntent = includesAny(normalized, [
    "salve na minha memoria pessoal",
    "salve na memoria pessoal",
    "guarde na minha memoria pessoal",
    "guarde na memoria pessoal",
    "registre na minha memoria pessoal",
    "adicione na minha memoria pessoal",
  ]);
  const implicitOperationalMemoryIntent =
    (normalized.startsWith("salve que ") || normalized.startsWith("guarde que "))
    && includesAny(normalized, [
      "plantao",
      "plantão",
      "rotina",
      "resposta",
      "respostas curtas",
      "casaco",
      "carregador",
      "dois dias fora",
      "na rua",
      "deslocamento",
    ]);
  return explicitMemoryIntent || implicitOperationalMemoryIntent;
}

export function isPersonalMemoryUpdatePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "atualize minha memoria pessoal",
    "atualizar minha memoria pessoal",
    "edite minha memoria pessoal",
    "altere minha memoria pessoal",
    "altere a minha memoria pessoal",
  ]);
}

export function isPersonalMemoryDeletePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "remova da minha memoria pessoal",
    "remover da minha memoria pessoal",
    "apague da minha memoria pessoal",
    "delete da minha memoria pessoal",
    "exclua da minha memoria pessoal",
  ]);
}

export function extractPersonalMemoryStatement(prompt: string): string | undefined {
  const cleaned = prompt
    .replace(/^\s*(?:salve|guarde|registre|adicione)\s+(?:na\s+)?(?:minha\s+)?mem[oó]ria\s+pessoal\s*(?:que|:)?\s*/i, "")
    .replace(/^\s*(?:salve|guarde)\s+que\s*/i, "")
    .trim();
  return cleaned || undefined;
}

export function inferPersonalMemoryKind(statement: string): PersonalOperationalMemoryItemKind {
  const normalized = normalizeEmailAnalysisText(statement);
  if (includesAny(normalized, ["foco", "prioridade do dia"])) {
    return "focus";
  }
  if (includesAny(normalized, ["casaco", "carregador", "roupa", "guarda chuva", "guarda-chuva", "levar", "leve"])) {
    return "packing";
  }
  if (includesAny(normalized, ["plantao", "plantão", "rotina", "quando eu for", "quando eu estiver", "vou sair", "dois dias fora"])) {
    return "routine";
  }
  if (includesAny(normalized, ["respostas curtas", "resposta curta", "prefiro", "me responda", "tom", "estilo"])) {
    return "preference";
  }
  if (includesAny(normalized, ["regra", "sempre", "nunca", "devo"])) {
    return "rule";
  }
  if (includesAny(normalized, ["deslocamento", "na rua", "seas", "albergue", "trajeto"])) {
    return "mobility";
  }
  if (includesAny(normalized, ["agenda", "calendario", "calendário", "abordagem", "primary", "trabalho"])) {
    return "context";
  }
  return "note";
}

export function buildPersonalMemoryTitle(statement: string, kind: PersonalOperationalMemoryItemKind): string {
  const cleaned = statement
    .replace(/^que\s+/i, "")
    .replace(/^quando\s+/i, "")
    .replace(/[.;]+$/g, "")
    .trim();
  const compact = cleaned.length > 72 ? `${cleaned.slice(0, 69).trim()}...` : cleaned;
  if (compact) {
    return compact[0]?.toUpperCase() + compact.slice(1);
  }

  switch (kind) {
    case "focus":
      return "Foco operacional";
    case "packing":
      return "Itens e roupa";
    case "routine":
      return "Rotina operacional";
    case "preference":
      return "Preferência operacional";
    case "rule":
      return "Regra operacional";
    case "mobility":
      return "Deslocamento";
    case "context":
      return "Contexto pessoal";
    case "note":
    default:
      return "Nota operacional";
  }
}

export function isPersonalOperationalProfileShowPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "mostre meu perfil operacional",
    "mostrar meu perfil operacional",
    "mostre meu perfil base",
    "mostrar meu perfil base",
    "mostre meu perfil pessoal operacional",
    "mostrar meu perfil pessoal operacional",
    "mostre meu perfil",
    "mostrar meu perfil",
    "liste meu perfil operacional",
  ]);
}

export function isPersonalOperationalProfileUpdatePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "defina meu estilo de resposta",
    "quero briefing mais",
    "salve que em plantao",
    "salve que em plantão",
    "salve que quando eu",
    "guarde que em plantao",
    "guarde que em plantão",
    "minha prioridade padrao",
    "minha prioridade padrão",
    "atualize meu perfil",
    "atualizar meu perfil",
    "ajuste meu perfil",
    "ajustar meu perfil",
    "onboarding",
    "configuracao inicial",
    "configuração inicial",
    "meu endereco",
    "meu endereço",
    "moro em",
    "minha casa fica",
    "meu carro",
    "meu veiculo",
    "meu veículo",
    "modo mais executivo",
    "modo mais humano",
    "modo mais firme",
    "modo mais acolhedor",
    "quero respostas muito curtas",
    "quero respostas curtas",
    "quero respostas mais curtas",
    "devo lembrar",
  ]);
}

export function isPersonalOperationalProfileDeletePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "remova do meu perfil",
    "remove do meu perfil",
    "remover do meu perfil",
    "apague do meu perfil",
    "tire do meu perfil",
    "exclua do meu perfil",
  ]);
}

export function isDirectLocalContextCommandPrompt(prompt: string): boolean {
  return (
    isGreetingPrompt(prompt) ||
    isConversationStyleCorrectionPrompt(prompt) ||
    isWeatherPrompt(prompt) ||
    isMorningBriefPrompt(prompt) ||
    isOperationalBriefPrompt(prompt) ||
    isPersonalOperationalProfileShowPrompt(prompt) ||
    isPersonalOperationalProfileUpdatePrompt(prompt) ||
    isPersonalOperationalProfileDeletePrompt(prompt) ||
    isOperationalStateShowPrompt(prompt) ||
    isLearnedPreferencesListPrompt(prompt) ||
    isLearnedPreferencesDeletePrompt(prompt) ||
    isPersonalMemoryListPrompt(prompt) ||
    isPersonalMemorySavePrompt(prompt) ||
    isPersonalMemoryUpdatePrompt(prompt) ||
    isPersonalMemoryDeletePrompt(prompt) ||
    isUserPreferencesPrompt(prompt) ||
    isAgentIdentityPrompt(prompt) ||
    looksLikeCapabilityInspectionPrompt(prompt)
  );
}

export function shouldBypassPreLocalExternalReasoningForPrompt(
  prompt: string,
  intent?: IntentResolution,
): boolean {
  if (
    isGoogleEventCreatePrompt(prompt)
    || isGoogleTaskCreatePrompt(prompt)
    || isDirectLocalContextCommandPrompt(prompt)
    || looksLikeLowFrictionReadPrompt(prompt, intent)
    || looksLikeCapabilityAwareTravelPrompt(prompt)
    || looksLikeCapabilityAwareWebPrompt(prompt)
  ) {
    return true;
  }

  const interpreted = interpretConversationTurn({ text: prompt });
  if (interpreted.suggestedAction === "handoff") {
    return false;
  }

  if ([
    "greeting",
    "weather",
    "briefing",
    "agenda",
    "tasks",
    "memory",
    "planning",
    "visual_task",
  ].includes(interpreted.skill) && interpreted.confidence >= 0.78) {
    return true;
  }

  return interpreted.suggestedAction === "draft_then_confirm" && interpreted.confidence >= 0.8;
}

export function extractPersonalOperationalProfileRemoveQuery(prompt: string): string | undefined {
  const cleaned = prompt
    .replace(/^\s*(?:remova|remove|remover|apague|tire|exclua)\s+do\s+meu\s+perfil\s*(?:a|o)?\s*/i, "")
    .replace(/[.;]+$/g, "")
    .trim();
  return cleaned || undefined;
}

export function extractCarryItemsFromProfilePrompt(text: string): string[] {
  if (!/\b(?:levar|leve|levo|devo lembrar)\b/i.test(text)) {
    return [];
  }
  const normalized = text
    .replace(/^.*?\b(?:levar|leve|levo|devo lembrar)\b\s*/i, "")
    .replace(/[.;]+$/g, "")
    .trim();
  if (!normalized) {
    return [];
  }

  return [...new Set(normalized
    .split(/,|\se\s|\s\+\s/)
    .map((item) => item.trim())
    .filter((item) => item.length > 2))];
}

export function uniqueAppend(values: string[], additions: string[]): string[] {
  return [...new Set([...values, ...additions.map((item) => item.trim()).filter(Boolean)])];
}

export function removeMatchingEntries(values: string[], query: string): string[] {
  const normalizedQuery = normalizeEmailAnalysisText(query);
  return values.filter((item) => {
    const normalizedItem = normalizeEmailAnalysisText(item);
    return !normalizedItem.includes(normalizedQuery) && !normalizedQuery.includes(normalizedItem);
  });
}

export function normalizeTonePreferenceFromText(value: string): PersonalOperationalProfile["tonePreference"] | undefined {
  const normalized = normalizeEmailAnalysisText(value);
  if (includesAny(normalized, ["objetivo", "direto"])) {
    return "objetivo";
  }
  if (normalized.includes("humano")) {
    return "humano";
  }
  if (normalized.includes("firme")) {
    return "firme";
  }
  if (normalized.includes("acolhedor")) {
    return "acolhedor";
  }
  if (normalized.includes("executivo")) {
    return "executivo";
  }
  return undefined;
}

export function inferProfileResponseLength(
  briefingPreference: PersonalOperationalProfile["briefingPreference"] | undefined,
  detailLevel: PersonalOperationalProfile["detailLevel"] | undefined,
): import("../types/user-preferences.js").UpdateUserPreferencesInput["responseLength"] | undefined {
  if (briefingPreference === "detalhado" || detailLevel === "detalhado") {
    return "medium";
  }
  if (briefingPreference === "curto" || detailLevel === "resumo") {
    return "short";
  }
  return undefined;
}

export function extractPersonalOperationalProfileUpdate(
  prompt: string,
  current: PersonalOperationalProfile,
): {
  profile: UpdatePersonalOperationalProfileInput;
  preferenceUpdate?: import("../types/user-preferences.js").UpdateUserPreferencesInput;
  changeLabels: string[];
} | null {
  const normalized = normalizeEmailAnalysisText(prompt);
  const profile: UpdatePersonalOperationalProfileInput = {};
  const preferenceUpdate: import("../types/user-preferences.js").UpdateUserPreferencesInput = {};
  const changeLabels: string[] = [];

  const styleMatch = prompt.match(/(?:estilo de resposta|meu estilo(?: de resposta)?)\s+(?:como\s+)?["“]?(.+?)["”]?(?=(?:[?.!,;:]|$))/i);
  if (styleMatch?.[1]?.trim()) {
    profile.responseStyle = styleMatch[1].trim();
    changeLabels.push(`estilo de resposta: ${profile.responseStyle}`);
  } else if (includesAny(normalized, ["direto e objetivo", "direto", "objetivo"])) {
    profile.responseStyle = "direto e objetivo";
    changeLabels.push(`estilo de resposta: ${profile.responseStyle}`);
  }

  const nameMatch = prompt.match(/(?:meu nome(?: no atlas)?(?: e| é)?|chame-me de)\s+["“]?(.+?)["”]?(?=(?:[?.!,;:]|$))/i);
  if (nameMatch?.[1]?.trim()) {
    profile.displayName = nameMatch[1].trim();
    changeLabels.push(`nome: ${profile.displayName}`);
  }

  const roleMatch = prompt.match(/(?:meu papel principal(?: e| é)?|minha ocupacao(?: principal)?(?: e| é)?|minha ocupação(?: principal)?(?: e| é)?)\s+["“]?(.+?)["”]?(?=(?:[?.!,;:]|$))/i);
  if (roleMatch?.[1]?.trim()) {
    profile.primaryRole = roleMatch[1].trim();
    changeLabels.push(`papel principal: ${profile.primaryRole}`);
  }

  const timezoneMatch = prompt.match(/(?:meu fuso(?: horario| horário)?(?: e| é)?|timezone(?: e| é)?)\s+([A-Za-z_\/+-]{3,64})/i);
  if (timezoneMatch?.[1]?.trim()) {
    profile.timezone = timezoneMatch[1].trim();
    changeLabels.push(`fuso: ${profile.timezone}`);
  }

  const homeAddressMatch = prompt.match(/(?:meu\s+endere[cç]o(?:\s+de\s+casa)?|moro\s+em|minha\s+casa\s+fica\s+em|saio\s+de\s+casa\s+(?:em|de))\s*(?:[ée]|:)?\s+(.+?)(?=(?:[.!?;]|$))/i);
  if (homeAddressMatch?.[1]?.trim()) {
    profile.homeAddress = homeAddressMatch[1].trim();
    profile.homeLocationLabel = "casa";
    changeLabels.push("endereço base: casa");
  }

  const vehicleMatch = prompt.match(/(?:meu\s+(?:carro|ve[ií]culo)|minha\s+moto)\s*(?:[ée]|:)?\s+(.+?)(?=(?:,|;|\.|$|\s+e\s+(?:faz|consome)|\s+com\s+consumo))/i);
  if (vehicleMatch?.[1]?.trim()) {
    profile.defaultVehicle = {
      ...(profile.defaultVehicle ?? {}),
      name: vehicleMatch[1].trim(),
    };
    changeLabels.push(`veículo padrão: ${profile.defaultVehicle.name}`);
  }

  const consumptionMatch = prompt.match(/\b(?:faz|consome|consumo(?: medio| médio)?(?: é| e)?|m[eé]dia(?: de)?)\s*(\d+(?:[.,]\d+)?)\s*(?:km\/l|km por litro)\b/i)
    ?? prompt.match(/\b(\d+(?:[.,]\d+)?)\s*(?:km\/l|km por litro)\b/i);
  if (consumptionMatch?.[1]) {
    const consumption = Number(consumptionMatch[1].replace(",", "."));
    if (Number.isFinite(consumption) && consumption > 0) {
      profile.defaultVehicle = {
        ...(profile.defaultVehicle ?? {}),
        consumptionKmPerLiter: consumption,
      };
      changeLabels.push(`consumo padrão: ${consumption.toFixed(1).replace(".", ",")} km/l`);
    }
  }

  const fuelType = normalized.includes("gasolina")
    ? "gasolina" as const
    : normalized.includes("etanol")
      ? "etanol" as const
      : normalized.includes("diesel")
        ? "diesel" as const
        : normalized.includes("flex")
          ? "flex" as const
          : undefined;
  if (fuelType) {
    profile.defaultVehicle = {
      ...(profile.defaultVehicle ?? {}),
      fuelType,
    };
    changeLabels.push(`combustível padrão: ${fuelType}`);
  }

  const fuelPriceMatch = prompt.match(/\b(?:gasolina|etanol|diesel|combust[ií]vel)\b.*?(?:r\$?\s*)?(\d+(?:[.,]\d+)?)/i);
  if (fuelPriceMatch?.[1]) {
    const price = Number(fuelPriceMatch[1].replace(",", "."));
    if (Number.isFinite(price) && price > 0) {
      profile.defaultFuelPricePerLiter = price;
      changeLabels.push(`preço de combustível padrão: R$ ${price.toFixed(2).replace(".", ",")}/l`);
    }
  }

  if (normalized.includes("telegram")) {
    profile.preferredChannels = uniqueAppend(current.preferredChannels, ["telegram"]);
  }
  if (normalized.includes("whatsapp")) {
    profile.preferredChannels = uniqueAppend(profile.preferredChannels ?? current.preferredChannels, ["whatsapp"]);
  }
  if (profile.preferredChannels?.length) {
    changeLabels.push(`canais preferidos: ${profile.preferredChannels.join(", ")}`);
  }

  const priorityAreasMatch = prompt.match(/(?:areas prioritarias|áreas prioritárias|prioridades principais)\s*(?::|sao|são|sao)\s+(.+?)(?=(?:[?.!,;:]|$))/i);
  if (priorityAreasMatch?.[1]?.trim()) {
    const areas = priorityAreasMatch[1].split(/,|\se\s/).map((item) => item.trim()).filter(Boolean);
    if (areas.length > 0) {
      profile.priorityAreas = uniqueAppend(current.priorityAreas, areas);
      changeLabels.push(`áreas prioritárias: ${areas.join(", ")}`);
    }
  }

  if (normalized.includes("briefing mais curto") || normalized.includes("briefing curto")) {
    profile.briefingPreference = "curto";
    profile.detailLevel = "resumo";
    changeLabels.push("briefing da manhã: curto");
  } else if (normalized.includes("briefing mais detalhado") || normalized.includes("briefing detalhado")) {
    profile.briefingPreference = "detalhado";
    profile.detailLevel = "detalhado";
    changeLabels.push("briefing da manhã: detalhado");
  } else if (normalized.includes("modo mais executivo") || normalized.includes("perfil mais executivo")) {
    profile.briefingPreference = "executivo";
    profile.tonePreference = "executivo";
    if (!profile.responseStyle) {
      profile.responseStyle = "executivo e direto";
    }
    changeLabels.push("perfil: executivo");
  }

  if (normalized.includes("mais detalhado") || normalized.includes("detalhado")) {
    profile.detailLevel = profile.detailLevel ?? "detalhado";
  }
  if (normalized.includes("modo resumo") || normalized.includes("nivel de detalhe resumo") || normalized.includes("nível de detalhe resumo")) {
    profile.detailLevel = "resumo";
    changeLabels.push("nível de detalhe: resumo");
  } else if (normalized.includes("nivel de detalhe equilibrado") || normalized.includes("nível de detalhe equilibrado")) {
    profile.detailLevel = "equilibrado";
    changeLabels.push("nível de detalhe: equilibrado");
  } else if (normalized.includes("nivel de detalhe detalhado") || normalized.includes("nível de detalhe detalhado")) {
    profile.detailLevel = "detalhado";
    changeLabels.push("nível de detalhe: detalhado");
  }

  const tonePreference = normalizeTonePreferenceFromText(prompt);
  if (tonePreference) {
    profile.tonePreference = tonePreference;
    changeLabels.push(`tom: ${tonePreference}`);
  }

  if (includesAny(normalized, [
    "plantao",
    "plantão",
    "na rua",
    "vou sair e so volto amanha",
    "vou sair e só volto amanhã",
  ])) {
    if (includesAny(normalized, ["respostas muito curtas", "respostas curtas", "resposta curta"])) {
      profile.defaultOperationalMode = "field";
      profile.briefingPreference = profile.briefingPreference ?? "curto";
      profile.detailLevel = "resumo";
      changeLabels.push("modo plantão padrão: compacto");
    }

    if (normalized.includes("quando eu") || normalized.includes("vou sair") || normalized.includes("na rua")) {
      profile.mobilityPreferences = uniqueAppend(current.mobilityPreferences, [extractPersonalMemoryStatement(prompt) ?? prompt.trim()]);
      changeLabels.push("preferência de deslocamento atualizada");
    }
  }

  const carryItems = extractCarryItemsFromProfilePrompt(prompt);
  if (carryItems.length > 0) {
    profile.attire = {
      carryItems: uniqueAppend(current.attire.carryItems, carryItems),
    };
    changeLabels.push(`itens importantes: ${carryItems.join(", ")}`);
  }

  const priorityMatch = prompt.match(/minha prioridade padr[aã]o\s+[ée]\s+(.+?)(?=(?:[?.!,;:]|$))/i);
  if (priorityMatch?.[1]?.trim()) {
    profile.operationalRules = uniqueAppend(current.operationalRules, [priorityMatch[1].trim()]);
    changeLabels.push(`regra fixa: ${priorityMatch[1].trim()}`);
  }

  if (normalized.includes("autonomia")) {
    const statement = extractPersonalMemoryStatement(prompt) ?? prompt.trim();
    profile.autonomyPreferences = uniqueAppend(current.autonomyPreferences, [statement]);
    changeLabels.push("preferência de autonomia atualizada");
  }

  if (includesAny(normalized, ["agenda principal", "calendario principal", "calendário principal", "agenda pessoal"])) {
    profile.defaultAgendaScope = "primary";
    changeLabels.push("escopo padrão de agenda: principal");
  } else if (includesAny(normalized, ["agenda trabalho", "agenda de trabalho", "calendario trabalho", "calendário trabalho"])) {
    profile.defaultAgendaScope = "work";
    changeLabels.push("escopo padrão de agenda: trabalho");
  } else if (includesAny(normalized, ["agenda pessoal e trabalho", "ambos", "ambas"])) {
    profile.defaultAgendaScope = "both";
    changeLabels.push("escopo padrão de agenda: ambos");
  }

  if (profile.briefingPreference || profile.detailLevel) {
    const responseLength = inferProfileResponseLength(profile.briefingPreference, profile.detailLevel);
    if (responseLength) {
      preferenceUpdate.responseLength = responseLength;
    }
  }

  if (profile.tonePreference === "executivo" || profile.responseStyle?.includes("executivo")) {
    preferenceUpdate.responseStyle = "executive";
  } else if (profile.tonePreference === "objetivo" || profile.responseStyle?.includes("direto")) {
    preferenceUpdate.responseStyle = "executive";
  } else if (profile.tonePreference === "acolhedor") {
    preferenceUpdate.responseStyle = "secretary";
  } else if (profile.detailLevel === "detalhado") {
    preferenceUpdate.responseStyle = "detailed";
  }

  if (Object.keys(profile).length === 0) {
    return null;
  }

  return {
    profile,
    preferenceUpdate: Object.keys(preferenceUpdate).length > 0 ? preferenceUpdate : undefined,
    changeLabels,
  };
}

export function removeFromPersonalOperationalProfile(
  profile: PersonalOperationalProfile,
  query: string,
): {
  profileUpdate: UpdatePersonalOperationalProfileInput;
  removedLabels: string[];
} | null {
  const normalizedQuery = normalizeEmailAnalysisText(query);
  const removedLabels: string[] = [];
  const profileUpdate: UpdatePersonalOperationalProfileInput = {};

  const resetStyle = normalizedQuery.includes("estilo")
    || normalizeEmailAnalysisText(profile.responseStyle).includes(normalizedQuery);
  if (resetStyle) {
    profileUpdate.responseStyle = "direto e objetivo";
    removedLabels.push("estilo de resposta personalizado");
  }

  const resetTone = normalizedQuery.includes("tom")
    || normalizeEmailAnalysisText(profile.tonePreference).includes(normalizedQuery);
  if (resetTone) {
    profileUpdate.tonePreference = "executivo";
    removedLabels.push("tom personalizado");
  }

  if (normalizedQuery.includes("briefing")) {
    profileUpdate.briefingPreference = "executivo";
    removedLabels.push("preferência de briefing");
  }

  if (normalizedQuery.includes("detalhe")) {
    profileUpdate.detailLevel = "resumo";
    removedLabels.push("nível de detalhe personalizado");
  }

  if (includesAny(normalizedQuery, ["plantao", "plantão", "modo rua"])) {
    profileUpdate.defaultOperationalMode = "normal";
    removedLabels.push("modo plantão padrão");
  }

  const nextMobility = removeMatchingEntries(profile.mobilityPreferences, query);
  if (nextMobility.length !== profile.mobilityPreferences.length) {
    profileUpdate.mobilityPreferences = nextMobility;
    removedLabels.push("preferência(s) de deslocamento");
  }

  const nextAutonomy = removeMatchingEntries(profile.autonomyPreferences, query);
  if (nextAutonomy.length !== profile.autonomyPreferences.length) {
    profileUpdate.autonomyPreferences = nextAutonomy;
    removedLabels.push("preferência(s) de autonomia");
  }

  const nextRules = removeMatchingEntries(profile.operationalRules, query);
  if (nextRules.length !== profile.operationalRules.length) {
    profileUpdate.operationalRules = nextRules;
    removedLabels.push("regra(s) operacionais");
  }

  const nextRoutineAnchors = removeMatchingEntries(profile.routineAnchors, query);
  if (nextRoutineAnchors.length !== profile.routineAnchors.length) {
    profileUpdate.routineAnchors = nextRoutineAnchors;
    removedLabels.push("âncora(s) de rotina");
  }

  const nextCarryItems = removeMatchingEntries(profile.attire.carryItems, query);
  if (nextCarryItems.length !== profile.attire.carryItems.length) {
    profileUpdate.attire = {
      ...(profileUpdate.attire ?? {}),
      carryItems: nextCarryItems,
    };
    removedLabels.push("item(ns) físicos");
  }

  return removedLabels.length > 0
    ? {
        profileUpdate,
        removedLabels,
      }
    : null;
}

export function extractPersonalMemoryId(prompt: string): number | undefined {
  const match = prompt.match(/\b(?:item|id)\s*(\d+)\b/i) ?? prompt.match(/#(\d+)\b/);
  if (!match?.[1]) {
    return undefined;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function extractPersonalMemoryUpdateTarget(prompt: string): string | undefined {
  const byId = extractPersonalMemoryId(prompt);
  if (byId) {
    return undefined;
  }

  const match = prompt.match(/mem[oó]ria\s+pessoal\s+(?:sobre|da|do|a regra|o item)?\s*(.+?)\s+(?:para|com|:)/i);
  if (match?.[1]) {
    return match[1].trim();
  }

  return undefined;
}

export function extractPersonalMemoryUpdateContent(prompt: string): string | undefined {
  const match = prompt.match(/\b(?:para|com|:)\s+(.+)$/i);
  if (!match?.[1]) {
    return undefined;
  }
  return match[1].trim();
}

export function extractPersonalMemoryDeleteTarget(prompt: string): string | undefined {
  const byId = extractPersonalMemoryId(prompt);
  if (byId) {
    return undefined;
  }

  const cleaned = prompt
    .replace(/^\s*(?:remova|remover|apague|delete|exclua)\s+(?:da\s+)?minha\s+mem[oó]ria\s+pessoal\s*/i, "")
    .replace(/^a\s+regra\s+/i, "")
    .replace(/^o\s+item\s+/i, "")
    .trim();
  return cleaned || undefined;
}

export function isMemoryEntityListPrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return (
    normalized.includes("liste as entidades") ||
    normalized.includes("listar entidades") ||
    normalized.includes("mostre as entidades") ||
    normalized.includes("memoria do atlas") ||
    normalized.includes("memória do atlas")
  ) && !normalized.includes("busque");
}

export function isMemoryEntitySearchPrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return normalized.includes("busque entidades")
    || normalized.includes("buscar entidades")
    || normalized.includes("procure entidades");
}

export function isIntentResolvePrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return normalized.includes("analise a intencao")
    || normalized.includes("analise a intenção")
    || normalized.includes("analise este pedido")
    || normalized.includes("inspecione a intencao")
    || normalized.includes("mostre a intencao");
}

export function extractIntentResolveSubject(prompt: string): string {
  const cleaned = prompt
    .replace(/^.*?(analise a intencao|analise a intenção|analise este pedido|inspecione a intencao|inspecione a intenção|mostre a intencao|mostre a intenção)\s*(?:de|:)?\s*/i, "")
    .trim();
  return cleaned || prompt.trim();
}

export function isOperationalPlanningPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  const hasPlanningVerb = includesAny(normalized, [
    "organize",
    "organizar",
    "priorize",
    "priorizar",
    "alinhe",
    "alinha",
    "arrume",
    "arrumar",
    "planeje",
    "planejar",
    "revisar",
  ]);
  const hasOperationalScope = includesAny(normalized, [
    "meu dia",
    "minha agenda",
    "agenda",
    "compromissos",
    "aprovacoes",
    "aprovações",
    "approval",
    "foco hoje",
  ]);
  return hasPlanningVerb && hasOperationalScope;
}

export function extractPreferenceUpdate(prompt: string): import("../types/user-preferences.js").UpdateUserPreferencesInput | null {
  const normalized = normalizeEmailAnalysisText(prompt);
  const update: import("../types/user-preferences.js").UpdateUserPreferencesInput = {};

  if (normalized.includes("modo executivo") || normalized.includes("mais executivo")) {
    update.responseStyle = "executive";
    update.responseLength = "short";
  }
  if (normalized.includes("mais detalhado") || normalized.includes("mais detalhada")) {
    update.responseStyle = "detailed";
    update.responseLength = "medium";
  }
  if (normalized.includes("mais investigativo") || normalized.includes("modo investigativo")) {
    update.responseStyle = "investigative";
    update.responseLength = "medium";
  }
  if (normalized.includes("modo secretario") || normalized.includes("modo secretário")) {
    update.responseStyle = "secretary";
    update.responseLength = "short";
  }

  const nameMatch = prompt.match(/(?:me\s+chame\s+de|prefiro\s+que\s+voce\s+se\s+chame\s+de)\s+["“]?(.+?)["”]?(?=(?:[?.!,;:]|$))/i);
  if (nameMatch?.[1]?.trim()) {
    update.preferredAgentName = nameMatch[1].trim();
  }

  return Object.keys(update).length > 0 ? update : null;
}

export function isImplicitResearchPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return (
    includesAny(normalized, [
      "albergue em ",
      "abrigo em ",
      "dias da cruz",
      "felipe diehl",
      "porto alegre",
    ]) &&
    !includesAny(normalized, [
      "email",
      "e-mail",
      "contato",
      "google",
      "tarefa",
      "workspace",
      "arquivo",
      "pasta",
      "projeto",
    ])
  );
}

export function isInternalKnowledgePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "pesquise internamente",
    "procure internamente",
    "busque internamente",
    "contexto interno",
    "busca interna",
    "pesquisa interna",
    "na pasta",
    "no projeto",
    "neste projeto",
    "nesse projeto",
    "dentro do projeto",
    "dentro da pasta",
  ]);
}

export function extractWeatherLocation(prompt: string): string | undefined {
  const patterns = [
    /previs[aã]o do tempo para\s+(.+?)(?=$|[?.!,;:])/i,
    /clima em\s+(.+?)(?=$|[?.!,;:])/i,
    /tempo em\s+(.+?)(?=$|[?.!,;:])/i,
    /temperatura em\s+(.+?)(?=$|[?.!,;:])/i,
    /vai chover em\s+(.+?)(?=$|[?.!,;:])/i,
    /chuva em\s+(.+?)(?=$|[?.!,;:])/i,
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    const value = match?.[1]
      ?.trim()
      .replace(/[.,;:!?]+$/g, "")
      .replace(/\b(?:hoje|agora|amanha|amanhã)\b$/i, "")
      .trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

export function buildWeatherTip(result: {
  current?: {
    temperatureC?: number;
  };
  daily: Array<{
    minTempC?: number;
    maxTempC?: number;
    precipitationProbabilityMax?: number;
  }>;
}): string | undefined {
  const today = result.daily[0];
  const rain = today?.precipitationProbabilityMax ?? 0;
  const maxTemp = today?.maxTempC ?? result.current?.temperatureC;
  const minTemp = today?.minTempC;

  if (rain >= 60) {
    return "Vale sair com guarda-chuva.";
  }
  if (typeof minTemp === "number" && minTemp <= 14) {
    return "Vale levar um casaco leve.";
  }
  if (typeof maxTemp === "number" && maxTemp >= 28) {
    return "Pode ir com roupa leve.";
  }
  if (rain <= 20) {
    return "Não parece precisar de guarda-chuva.";
  }
  return undefined;
}

export function buildWeatherReply(result: {
  locationLabel: string;
  timezone: string;
  current?: {
    time?: string;
    temperatureC?: number;
    apparentTemperatureC?: number;
    humidityPercent?: number;
    precipitationMm?: number;
    description: string;
    windSpeedKmh?: number;
  };
  daily: Array<{
    date: string;
    description: string;
    minTempC?: number;
    maxTempC?: number;
    precipitationProbabilityMax?: number;
    precipitationSumMm?: number;
  }>;
}): string {
  const today = result.daily[0];
  const tomorrow = result.daily[1];
  const parts: string[] = [];

  if (today) {
    const tempRange = typeof today.minTempC === "number" && typeof today.maxTempC === "number"
      ? `, entre ${today.minTempC}° e ${today.maxTempC}°`
      : "";
    const rain = typeof today.precipitationProbabilityMax === "number"
      ? ` e chuva em torno de ${today.precipitationProbabilityMax}%`
      : "";
    const currentTemp = typeof result.current?.temperatureC === "number"
      ? `, ${result.current.temperatureC}°C agora`
      : "";
    parts.push(`Hoje em ${result.locationLabel} o tempo está ${today.description.toLowerCase()}${currentTemp}${tempRange}${rain}.`);
  } else if (result.current) {
    parts.push(`Agora em ${result.locationLabel} está ${result.current.description.toLowerCase()}, com ${result.current.temperatureC ?? "?"}°C.`);
  }

  const tip = buildWeatherTip(result);
  if (tip) {
    parts.push(tip);
  }

  if (tomorrow) {
    const tempRange = typeof tomorrow.minTempC === "number" && typeof tomorrow.maxTempC === "number"
      ? `, entre ${tomorrow.minTempC}° e ${tomorrow.maxTempC}°`
      : "";
    const rain = typeof tomorrow.precipitationProbabilityMax === "number"
      ? ` e chuva em torno de ${tomorrow.precipitationProbabilityMax}%`
      : "";
    parts.push(`Amanhã a tendência é ${tomorrow.description.toLowerCase()}${tempRange}${rain}.`);
  }

  if (parts.length === 0) {
    return `Não encontrei uma previsão confiável agora para ${result.locationLabel}.`;
  }

  return parts.join(" ");
}

export function extractWebResearchQuery(prompt: string): string {
  return prompt
    .replace(/^\s*pesquisa\s+(?:rapida|rápida|executiva|executivo|profunda|profundo)\s+/i, "")
    .replace(/\b(pesquise|pesquisa|estude|valide)\b/gi, "")
    .replace(/^\s*qual\s+(?:o\s+)?endere[cç]o\s+(?:do|da|de)\s+/i, "")
    .replace(/^\s*onde\s+fica\s+(?:o|a)\s+/i, "")
    .replace(/^\s*endere[cç]o\s+(?:do|da|de)\s+/i, "")
    .replace(/^\s*(procure|busque|buscar|encontre)\s+na internet\s+por\s+/i, "")
    .replace(/^\s*(procure|busque|buscar|encontre)\s+por\s+/i, "")
    .replace(/^\s*(procure|busque|buscar|encontre)\s+na internet\s+/i, "")
    .replace(/^\s*ache\s+informacoes?\s+sobre\s+/i, "")
    .replace(/^\s*ache\s+informações?\s+sobre\s+/i, "")
    .replace(/\bna internet\b/gi, "")
    .replace(/\bcom fontes\b/gi, "")
    .replace(/\bpor favor\b/gi, "")
    .replace(/^\s*(?:rapida|rápida|executiva|executivo|profunda|profundo)\s+/i, "")
    .replace(/^\s*por\s+/i, "")
    .replace(/^\s*sobre\s+(?:o|a|os|as)\s+/i, "")
    .replace(/^\s*sobre\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?-]+$/g, "")
    .trim();
}

export function extractWebResearchMode(prompt: string): WebResearchMode {
  const normalized = normalizeEmailAnalysisText(prompt);

  if (
    includesAny(normalized, [
      "pesquisa profunda",
      "modo profundo",
      "profundo",
      "profunda",
      "aprofunde",
      "detalhado",
      "detalhada",
      "completo",
      "completa",
    ])
  ) {
    return "deep";
  }

  if (
    includesAny(normalized, [
      "pesquisa rapida",
      "pesquisa rápida",
      "modo rapido",
      "modo rápido",
      "rapido",
      "rápido",
      "breve",
      "curto",
      "curta",
      "resumo rapido",
      "resumo rápido",
    ])
  ) {
    return "quick";
  }

  if (
    includesAny(normalized, [
      "mercado",
      "concorr",
      "benchmark",
      "tendencia",
      "tendência",
      "viabilidade",
      "demanda",
      "oportunidade",
    ])
  ) {
    return "deep";
  }

  return "executive";
}

export function maxResearchResultsForMode(mode: WebResearchMode): number {
  if (mode === "quick") {
    return 4;
  }
  if (mode === "deep") {
    return 8;
  }
  return 6;
}

export function excerptBudgetForResearchMode(mode: WebResearchMode): number {
  if (mode === "quick") {
    return 1100;
  }
  if (mode === "deep") {
    return 3200;
  }
  return 2200;
}

export function extractInternalKnowledgeQuery(prompt: string): string {
  return prompt
    .replace(/^\s*(pesquise|procure|busque|encontre)\s+internamente\s+/i, "")
    .replace(/^\s*(pesquise|procure|busque|encontre)\s+(?:na|no)\s+(?:pasta|projeto)\s+/i, "")
    .replace(/\bcom contexto interno\b/gi, "")
    .replace(/\bbusca interna\b/gi, "")
    .replace(/\bpesquisa interna\b/gi, "")
    .replace(/\binternamente\b/gi, "")
    .replace(/^\s*por\s+/i, "")
    .replace(/\bna pasta\b/gi, "")
    .replace(/\bno projeto\b/gi, "")
    .replace(/\bdentro do projeto\b/gi, "")
    .replace(/\bdentro da pasta\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?-]+$/g, "")
    .trim();
}

export function isRevenueScoreboardPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return [
    "placar mensal",
    "scoreboard mensal",
    "receita do mes",
    "receita do mês",
    "placar de receita",
    "pipeline do mes",
    "pipeline do mês",
  ].some((token) => normalized.includes(token));
}

export function isAllowedSpacesPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return (
    includesAny(normalized, [
      "quais espacos",
      "quais espaços",
      "quais pastas",
      "quais diretorios",
      "quais diretórios",
      "o que voce pode ver",
      "o que voce pode acessar",
      "espacos autorizados",
      "pastas autorizadas",
    ]) &&
    includesAny(normalized, ["mac", "pastas", "espacos", "espaços", "diretorios", "diretórios", "acessar", "ver"])
  );
}
