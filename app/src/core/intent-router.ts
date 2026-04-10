import { buildOrchestrationContext } from "./orchestration.js";
import type { OrchestrationContext, AgentDomain } from "../types/orchestration.js";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function extractActiveUserPrompt(prompt: string): string {
  const marker = "Mensagem atual do usuário:";
  const index = prompt.lastIndexOf(marker);
  if (index === -1) {
    return prompt.trim();
  }

  const extracted = prompt.slice(index + marker.length).trim();
  return extracted || prompt.trim();
}

function extractTelegramHistoryUserTurns(prompt: string): string[] {
  const historyMarker = "Histórico recente do chat:";
  const currentMarker = "Mensagem atual do usuário:";
  const historyIndex = prompt.indexOf(historyMarker);
  const currentIndex = prompt.indexOf(currentMarker);
  if (historyIndex === -1 || currentIndex === -1 || currentIndex <= historyIndex) {
    return [];
  }

  return prompt
    .slice(historyIndex + historyMarker.length, currentIndex)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("Usuário: "))
    .map((line) => line.replace(/^Usuário:\s*/i, "").trim())
    .filter(Boolean);
}

function detectMentionedDomains(prompt: string, orchestration: OrchestrationContext): AgentDomain[] {
  const normalized = normalize(prompt);
  const mentioned = new Set<AgentDomain>([
    orchestration.route.primaryDomain,
    ...orchestration.route.secondaryDomains,
  ]);

  const checks: Array<[AgentDomain, string[]]> = [
    ["secretario_operacional", ["agenda", "compromisso", "follow-up", "prioridade", "briefing", "inbox", "email", "whatsapp", "aprovação", "aprovacao", "ticket", "tickets", "suporte", "atendimento", "tarefa"]],
    ["social_media", ["conteudo", "instagram", "youtube", "tiktok", "roteiro", "post"]],
    ["dev_full_stack", ["codigo", "api", "deploy", "bug", "build", "saas"]],
    ["analista_negocios_growth", ["growth", "receita", "mrr", "funil", "conversao", "lead"]],
    ["assistente_social", ["creas", "cras", "parecer social", "relatorio social", "acolhimento"]],
  ];

  for (const [domain, tokens] of checks) {
    if (tokens.some((token) => normalized.includes(token))) {
      mentioned.add(domain);
    }
  }

  return [...mentioned];
}

function detectCompoundIntent(prompt: string, mentionedDomains: AgentDomain[]): boolean {
  const normalized = normalize(prompt);
  if (mentionedDomains.length > 1) {
    return true;
  }

  const actionVerbMatches = [
    "revis",
    "organ",
    "prioriz",
    "agend",
    "planej",
    "respon",
    "publique",
    "ger",
    "cri",
    "corrig",
    "implement",
  ].filter((token) => normalized.includes(token)).length;

  return (normalized.includes(" e ") && actionVerbMatches >= 2)
    || normalized.includes(" depois ")
    || normalized.includes(" em seguida ")
    || normalized.includes(" ao mesmo tempo ")
    || normalized.includes(" junto com ");
}

export interface IntentResolution {
  rawPrompt: string;
  activeUserPrompt: string;
  historyUserTurns: string[];
  orchestration: OrchestrationContext;
  mentionedDomains: AgentDomain[];
  compoundIntent: boolean;
}

export class IntentRouter {
  resolve(prompt: string): IntentResolution {
    const activeUserPrompt = extractActiveUserPrompt(prompt);
    const historyUserTurns = extractTelegramHistoryUserTurns(prompt);
    const orchestration = buildOrchestrationContext(activeUserPrompt);
    const mentionedDomains = detectMentionedDomains(activeUserPrompt, orchestration);

    return {
      rawPrompt: prompt,
      activeUserPrompt,
      historyUserTurns,
      orchestration,
      mentionedDomains,
      compoundIntent: detectCompoundIntent(activeUserPrompt, mentionedDomains),
    };
  }
}
