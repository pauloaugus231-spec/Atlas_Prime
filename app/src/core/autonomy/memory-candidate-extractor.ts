import type { MemoryCandidate } from "../../types/memory-candidates.js";
import type { Logger } from "../../types/logger.js";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cleanStatement(value: string): string {
  return value.replace(/[.\s]+$/g, "").trim();
}

export interface ExtractMemoryCandidateInput {
  text: string;
  sourceKind: MemoryCandidate["sourceKind"];
  sourceId?: string;
}

export class MemoryCandidateExtractor {
  constructor(private readonly logger: Logger) {}

  extract(input: ExtractMemoryCandidateInput): Array<Omit<MemoryCandidate, "id" | "createdAt" | "lastSeenAt">> {
    const statement = cleanStatement(input.text);
    const normalized = normalize(statement);
    if (!statement || statement.length < 8) {
      return [];
    }

    const candidates: Array<Omit<MemoryCandidate, "id" | "createdAt" | "lastSeenAt">> = [];
    const push = (candidate: Omit<MemoryCandidate, "id" | "createdAt" | "lastSeenAt">) => candidates.push(candidate);

    if (/\bprefiro\b/u.test(normalized)) {
      push({
        kind: normalized.includes("resposta") || normalized.includes("direto") || normalized.includes("curta") ? "style" : "preference",
        statement,
        sourceKind: input.sourceKind,
        ...(input.sourceId ? { sourceId: input.sourceId } : {}),
        evidence: ["Preferência explícita declarada pelo operador."],
        confidence: 0.9,
        sensitivity: "normal",
        status: "candidate",
        reviewStatus: "needs_review",
      });
    }

    if (/\bsempre me lembre\b/u.test(normalized) || /\bme lembre de\b/u.test(normalized)) {
      push({
        kind: "rule",
        statement,
        sourceKind: input.sourceKind,
        ...(input.sourceId ? { sourceId: input.sourceId } : {}),
        evidence: ["Lembrete recorrente explicitamente solicitado."],
        confidence: 0.88,
        sensitivity: normalized.includes("senha") || normalized.includes("documento") ? "sensitive" : "normal",
        status: "candidate",
        reviewStatus: "needs_review",
      });
    }

    if (/\btrabalho em\b/u.test(normalized) || /\btenho\b.*\bemprego/u.test(normalized)) {
      push({
        kind: "routine",
        statement,
        sourceKind: input.sourceKind,
        ...(input.sourceId ? { sourceId: input.sourceId } : {}),
        evidence: ["Contexto de rotina explicitamente informado pelo operador."],
        confidence: 0.82,
        sensitivity: "personal",
        status: "candidate",
        reviewStatus: "needs_review",
      });
    }

    if ((normalized.includes("telegram") || normalized.includes("whatsapp") || normalized.includes("email"))
      && (normalized.includes("principal") || normalized.includes("prefiro") || normalized.includes("canal"))) {
      push({
        kind: "preference",
        statement,
        sourceKind: input.sourceKind,
        ...(input.sourceId ? { sourceId: input.sourceId } : {}),
        evidence: ["Canal preferido explicitamente informado."],
        confidence: 0.86,
        sensitivity: "normal",
        status: "candidate",
        reviewStatus: "needs_review",
      });
    }

    if (normalized.includes("plantao") || normalized.includes("plantão")) {
      push({
        kind: normalized.includes("resposta") || normalized.includes("curta") ? "style" : "constraint",
        statement,
        sourceKind: input.sourceKind,
        ...(input.sourceId ? { sourceId: input.sourceId } : {}),
        evidence: ["Regra contextual explícita para modo de operação."],
        confidence: 0.84,
        sensitivity: "normal",
        status: "candidate",
        reviewStatus: "needs_review",
      });
    }

    const deduped = new Map<string, Omit<MemoryCandidate, "id" | "createdAt" | "lastSeenAt">>();
    for (const candidate of candidates) {
      const key = `${candidate.kind}:${normalize(candidate.statement)}`;
      if (!deduped.has(key)) {
        deduped.set(key, candidate);
      }
    }

    const results = [...deduped.values()];
    if (results.length > 0) {
      this.logger.debug("Memory candidates extracted", {
        sourceKind: input.sourceKind,
        sourceId: input.sourceId,
        count: results.length,
      });
    }
    return results;
  }
}
