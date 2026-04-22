import { randomUUID } from "node:crypto";
import type { CommitmentCandidate } from "../../types/commitments.js";
import type { Logger } from "../../types/logger.js";
import type { CreateMissionInput, Mission } from "../../types/mission.js";
import type { GraphIngestionService } from "../knowledge-graph/graph-ingestion.js";
import { MissionStore } from "./mission-store.js";

interface CommitmentsLike {
  listByStatus(statuses: CommitmentCandidate["status"][], limit?: number): CommitmentCandidate[];
  getById?(id: string): CommitmentCandidate | undefined;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export class MissionService {
  constructor(
    private readonly store: MissionStore,
    private readonly commitments: CommitmentsLike,
    private readonly logger: Logger,
    private readonly graphIngestion?: GraphIngestionService,
  ) {}

  create(input: CreateMissionInput): Mission {
    const now = new Date().toISOString();
    const mission: Mission = {
      id: randomUUID(),
      title: input.title.trim(),
      domain: input.domain ?? "business",
      outcome: input.outcome?.trim() || input.title.trim(),
      status: "active",
      priority: input.priority ?? "high",
      owner: "atlas-assisted",
      ...(input.deadline ? { deadline: input.deadline } : {}),
      context: input.context?.trim() || "missão criada via conversa",
      successCriteria: input.successCriteria ?? [],
      currentPlan: input.nextAction ? [{ title: input.nextAction, status: "pending" }] : [],
      artifacts: [],
      openQuestions: input.openQuestions ?? [],
      risks: input.risks ?? [],
      ...(input.nextAction ? { nextAction: input.nextAction } : {}),
      supportingCommitmentIds: this.findSupportingCommitments(input.title),
      createdAt: now,
      updatedAt: now,
    };
    const saved = this.store.upsert(mission);
    this.graphIngestion?.ingestMission(saved);
    for (const commitmentId of saved.supportingCommitmentIds) {
      const commitment = this.commitments.getById?.(commitmentId);
      if (commitment) {
        this.graphIngestion?.ingestCommitment(commitment);
        this.graphIngestion?.linkMissionToCommitment(saved, commitment);
      }
    }
    return saved;
  }

  listActive(): Mission[] {
    return this.store.list(["active", "blocked", "paused"], 30);
  }

  find(query: string): Mission | undefined {
    return this.store.findByTitle(query);
  }

  findSupportingCommitments(query: string): string[] {
    const normalized = normalize(query);
    return this.commitments
      .listByStatus(["candidate", "confirmed", "converted_to_task"], 100)
      .filter((item) => normalize(item.statement).includes(normalized) || normalized.includes(normalize(item.statement)))
      .map((item) => item.id);
  }

  renderStatus(query?: string): string {
    const items = query ? [this.find(query)].filter((item): item is Mission => Boolean(item)) : this.listActive();
    if (items.length === 0) {
      return query ? "Não encontrei essa missão." : "Nenhuma missão ativa no momento.";
    }
    return [
      query ? `Missão ${items[0].title}:` : "Missões ativas:",
      ...items.map((item) => `- ${item.title} | ${item.status} | prioridade ${item.priority}${item.nextAction ? ` | próxima ação: ${item.nextAction}` : ""}${item.deadline ? ` | prazo: ${item.deadline.slice(0, 10)}` : ""}`),
    ].join("\n");
  }

  renderNextAction(query: string): string {
    const mission = this.find(query);
    if (!mission) {
      return "Não encontrei essa missão.";
    }
    return mission.nextAction
      ? `Próxima ação da missão ${mission.title}: ${mission.nextAction}`
      : `A missão ${mission.title} ainda não tem próxima ação definida.`;
  }

  renderRisks(query: string): string {
    const mission = this.find(query);
    if (!mission) {
      return "Não encontrei essa missão.";
    }
    if (mission.risks.length === 0) {
      return `A missão ${mission.title} ainda não tem riscos explícitos registrados.`;
    }
    return [`Riscos da missão ${mission.title}:`, ...mission.risks.map((item) => `- ${item}`)].join("\n");
  }
}
