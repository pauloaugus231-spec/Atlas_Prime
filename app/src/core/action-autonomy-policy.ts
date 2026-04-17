import type { IntentResolution } from "./intent-router.js";

export type ActionAutonomyRequirement =
  | "autonomous_read"
  | "provider_or_local"
  | "short_confirmation"
  | "strong_confirmation";

export interface ActionAutonomyRule {
  key: string;
  label: string;
  requirement: ActionAutonomyRequirement;
  sensitive: boolean;
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

function isSimpleAgendaRead(normalized: string): boolean {
  const hasAgenda = includesAny(normalized, ["agenda", "calendario", "calendário", "compromiss", "eventos"]);
  const hasScope = includesAny(normalized, [
    "hoje",
    "amanha",
    "amanhã",
    "esta semana",
    "essa semana",
    "proxima semana",
    "próxima semana",
    "semana que vem",
    "proximos compromissos",
    "próximos compromissos",
    "segunda",
    "terca",
    "terça",
    "quarta",
    "quinta",
    "sexta",
    "sabado",
    "sábado",
    "domingo",
  ]);
  return hasAgenda && hasScope;
}

export function resolveActionAutonomyRule(
  prompt: string,
  intent?: IntentResolution,
): ActionAutonomyRule {
  const normalized = normalize(prompt);

  if (isSimpleAgendaRead(normalized)) {
    return {
      key: "calendar.read.simple",
      label: "leitura simples de agenda",
      requirement: "autonomous_read",
      sensitive: false,
    };
  }

  if (includesAny(normalized, ["briefing da manha", "briefing da manhã", "brief diario", "brief diário", "resumo do dia", "clima"])) {
    return {
      key: "operations.read.brief",
      label: "brief diário e sinais operacionais",
      requirement: "autonomous_read",
      sensitive: false,
    };
  }

  if (includesAny(normalized, ["tarefas", "google tasks", "task list", "lista de tarefas"]) && !includesAny(normalized, ["crie", "delete", "apague", "exclua"])) {
    return {
      key: "tasks.read.simple",
      label: "leitura de tarefas",
      requirement: "autonomous_read",
      sensitive: false,
    };
  }

  if (includesAny(normalized, ["organize meu dia", "priorize meu dia", "o que devo focar hoje"])) {
    return {
      key: "operations.plan.day",
      label: "planejamento operacional do dia",
      requirement: "provider_or_local",
      sensitive: false,
    };
  }

  if (includesAny(normalized, ["agende", "crie um evento", "crie um compromisso", "marque uma reuniao", "marque uma reunião"])) {
    return {
      key: "calendar.create",
      label: "criação de evento",
      requirement: "short_confirmation",
      sensitive: true,
    };
  }

  if (includesAny(normalized, ["mova o evento", "reagende", "altere o evento", "atualize o evento"])) {
    return {
      key: "calendar.update",
      label: "atualização de evento",
      requirement: "short_confirmation",
      sensitive: true,
    };
  }

  if (includesAny(normalized, ["exclua o evento", "cancele o evento", "delete o evento", "apague o evento", "remova o evento"])) {
    return {
      key: "calendar.delete",
      label: "exclusão de evento",
      requirement: "strong_confirmation",
      sensitive: true,
    };
  }

  if (includesAny(normalized, ["crie uma tarefa", "adicione uma tarefa", "crie um lembrete"])) {
    return {
      key: "tasks.create",
      label: "criação de tarefa",
      requirement: "short_confirmation",
      sensitive: true,
    };
  }

  if (includesAny(normalized, ["delete task", "exclua a tarefa", "apague a tarefa", "remova a tarefa"])) {
    return {
      key: "tasks.delete",
      label: "exclusão de tarefa",
      requirement: "strong_confirmation",
      sensitive: true,
    };
  }

  if (includesAny(normalized, ["envie email", "responda email", "mande whatsapp", "envie whatsapp"])) {
    return {
      key: "communication.send",
      label: "envio externo",
      requirement: "strong_confirmation",
      sensitive: true,
    };
  }

  if (intent?.orchestration.route.actionMode === "plan") {
    return {
      key: "operations.plan.general",
      label: "planejamento geral",
      requirement: "provider_or_local",
      sensitive: false,
    };
  }

  return {
    key: "default.cautious",
    label: "operação cautelosa padrão",
    requirement: "short_confirmation",
    sensitive: intent?.orchestration.route.actionMode === "execute" || intent?.orchestration.route.actionMode === "communicate",
  };
}

export function isHighAutonomyReadPrompt(
  prompt: string,
  intent?: IntentResolution,
): boolean {
  return resolveActionAutonomyRule(prompt, intent).requirement === "autonomous_read";
}
