export type LegacyRoutingHintStatus = "safe" | "ambiguous" | "legacy" | "dangerous";

export interface LegacyRoutingHint {
  id: string;
  status: LegacyRoutingHintStatus;
  description: string;
  tokens: string[];
}

export const LEGACY_ROUTING_HINTS: LegacyRoutingHint[] = [
  {
    id: "summary_generic",
    status: "ambiguous",
    description: "Resumo genérico ainda colide entre briefing, email, research e conteúdo.",
    tokens: ["resumo", "resuma", "resumir"],
  },
  {
    id: "briefing_generic",
    status: "ambiguous",
    description: "Briefing pode significar leitura, ajuste de perfil, compartilhamento ou agenda de envio.",
    tokens: ["briefing", "brief matinal", "briefing da manhã", "briefing da manha"],
  },
  {
    id: "calendar_generic",
    status: "ambiguous",
    description: "Agenda e calendário aparecem tanto em leitura quanto em criação e alteração.",
    tokens: ["agenda", "calendario", "calendário", "evento", "agendar"],
  },
  {
    id: "delivery_generic",
    status: "dangerous",
    description: "Mandar ou enviar sem objeto explícito pode cair em canal errado.",
    tokens: ["manda", "envia", "envie", "manda isso", "manda pra equipe"],
  },
  {
    id: "profile_update_generic",
    status: "legacy",
    description: "Ajustes de perfil ainda dependem de frases específicas hardcoded.",
    tokens: ["muda", "ajusta", "troca", "passa para"],
  },
  {
    id: "referential_followup",
    status: "legacy",
    description: "Follow-up referencial ainda depende de tokens fixos como esse/essa/na abordagem.",
    tokens: ["esse", "essa", "na abordagem", "no pessoal", "esse da equipe"],
  },
];

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function collectLegacyRoutingHintIds(prompt: string): string[] {
  const normalized = normalize(prompt);
  return LEGACY_ROUTING_HINTS
    .filter((hint) => hint.tokens.some((token) => normalized.includes(normalize(token))))
    .map((hint) => hint.id);
}

export function isLegacyRoutingHintAmbiguous(prompt: string): boolean {
  const hintIds = new Set(collectLegacyRoutingHintIds(prompt));
  return LEGACY_ROUTING_HINTS.some((hint) => hint.status === "ambiguous" && hintIds.has(hint.id));
}
