import type { ProfessionPack } from "../types/profession-pack.js";

const BUILT_IN_PACKS: ProfessionPack[] = [
  {
    id: "mechanic",
    label: "Mecânico",
    aliases: ["mecanico", "mecânico", "oficina"],
    suggestedRole: "field_operator",
    summary: "Rotina com clientes, veículos, peças, prazos e retornos.",
    priorityAreas: ["clientes", "agenda", "entregas", "cobrança"],
    routineAnchors: ["confirmar prazos de entrega", "separar peças antes da visita", "avisar clientes sobre andamento"],
    operationalRules: ["priorizar prazos prometidos", "não esquecer retorno para cliente parado", "agrupar deslocamentos e retiradas"],
    defaultBriefingStyle: "compact",
    defaultBriefingSections: ["weather", "focus", "next_action", "agenda", "mobility", "tasks"],
  },
  {
    id: "doctor",
    label: "Médico",
    aliases: ["medico", "médico", "clinica", "clínica"],
    suggestedRole: "regulated_professional",
    summary: "Rotina regulada, agenda intensa, contextos sensíveis e blocos de atendimento.",
    priorityAreas: ["agenda", "preparação", "documentos", "pendências críticas"],
    routineAnchors: ["revisar agenda do turno", "preparar blocos de atendimento", "proteger contextos sensíveis"],
    operationalRules: ["priorizar clareza e tempo", "evitar exposição de dados sensíveis", "resumos devem ser diretos"],
    defaultBriefingStyle: "executive",
    defaultBriefingSections: ["weather", "focus", "next_action", "agenda", "tasks", "motivation"],
  },
  {
    id: "teacher",
    label: "Professor",
    aliases: ["professor", "professora", "docente"],
    suggestedRole: "individual_contributor",
    summary: "Rotina entre aulas, materiais, correções e comunicação recorrente.",
    priorityAreas: ["agenda", "materiais", "prazos", "alunos"],
    routineAnchors: ["revisar aulas do dia", "separar materiais", "marcar entregas pendentes"],
    operationalRules: ["priorizar aulas do dia", "destacar correções vencidas", "lembrar retornos para turma"],
    defaultBriefingStyle: "executive",
    defaultBriefingSections: ["weather", "focus", "next_action", "agenda", "tasks", "motivation"],
  },
  {
    id: "consultant",
    label: "Consultor",
    aliases: ["consultor", "consultora", "consultoria"],
    suggestedRole: "manager",
    summary: "Rotina com clientes, follow-ups, propostas e blocos de entrega.",
    priorityAreas: ["clientes", "receita", "agenda", "follow-ups"],
    routineAnchors: ["revisar follow-ups críticos", "ver propostas abertas", "preparar reuniões do dia"],
    operationalRules: ["priorizar receita em aberto", "não aceitar demanda nova sem resolver conflito", "toda reunião pede próximo passo"],
    defaultBriefingStyle: "executive",
    defaultBriefingSections: ["focus", "next_action", "goals", "agenda", "emails", "approvals"],
  },
  {
    id: "social_worker",
    label: "Assistente social",
    aliases: ["assistente social", "servico social", "serviço social"],
    suggestedRole: "field_operator",
    summary: "Rotina de campo, atendimentos, registros e comunicação cuidadosa.",
    priorityAreas: ["atendimentos", "agenda", "deslocamento", "registros"],
    routineAnchors: ["revisar visitas do dia", "checar deslocamentos", "preparar registros pendentes"],
    operationalRules: ["priorizar contexto sensível", "sem autoenvio", "campo pesa mais que detalhamento excessivo"],
    defaultBriefingStyle: "compact",
    defaultBriefingSections: ["weather", "focus", "next_action", "agenda", "mobility", "tasks"],
  },
];

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export class ProfessionPackService {
  list(): ProfessionPack[] {
    return BUILT_IN_PACKS.map((item) => ({ ...item, aliases: [...item.aliases] }));
  }

  getById(id: string | undefined): ProfessionPack | undefined {
    if (!id?.trim()) {
      return undefined;
    }
    const normalized = normalize(id);
    return BUILT_IN_PACKS.find((item) => normalize(item.id) === normalized);
  }

  detectByProfession(value: string | undefined): ProfessionPack | undefined {
    if (!value?.trim()) {
      return undefined;
    }
    const normalized = normalize(value);
    return BUILT_IN_PACKS.find((item) => normalize(item.label) === normalized || item.aliases.some((alias) => normalize(alias) === normalized || normalized.includes(normalize(alias))));
  }
}
