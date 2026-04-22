import { randomUUID } from "node:crypto";
import type { CommitmentCandidate } from "../../types/commitments.js";
import type { Logger } from "../../types/logger.js";
import type { Mission } from "../../types/mission.js";
import type { RelationshipProfile } from "../../types/relationship-profile.js";
import type { ResearchBrief } from "../../types/research-brief.js";
import { EntityStore, type GraphEntity } from "./entity-store.js";
import { RelationshipStore } from "./relationship-store.js";

export class GraphIngestionService {
  constructor(
    private readonly entities: EntityStore,
    private readonly relationships: RelationshipStore,
    private readonly logger: Logger,
  ) {}

  ingestRelationship(profile: RelationshipProfile): GraphEntity {
    const now = new Date().toISOString();
    return this.entities.upsert({
      id: `relationship:${profile.id}`,
      kind: "person",
      label: profile.displayName,
      payload: profile as unknown as Record<string, unknown>,
      createdAt: now,
      updatedAt: now,
    });
  }

  ingestMission(mission: Mission): GraphEntity {
    const now = new Date().toISOString();
    return this.entities.upsert({
      id: `mission:${mission.id}`,
      kind: "mission",
      label: mission.title,
      payload: mission as unknown as Record<string, unknown>,
      createdAt: now,
      updatedAt: now,
    });
  }

  ingestResearch(brief: ResearchBrief): GraphEntity {
    return this.entities.upsert({
      id: `research:${brief.id}`,
      kind: "research_session",
      label: brief.topic,
      payload: brief as unknown as Record<string, unknown>,
      createdAt: brief.collectedAt,
      updatedAt: brief.collectedAt,
    });
  }

  ingestCommitment(commitment: CommitmentCandidate): GraphEntity {
    return this.entities.upsert({
      id: `commitment:${commitment.id}`,
      kind: "commitment",
      label: commitment.normalizedAction,
      payload: commitment as unknown as Record<string, unknown>,
      createdAt: commitment.createdAt,
      updatedAt: commitment.updatedAt,
    });
  }

  linkMissionToCommitment(mission: Mission, commitment: CommitmentCandidate): void {
    this.relationships.upsert({
      id: randomUUID(),
      fromEntityId: `mission:${mission.id}`,
      toEntityId: `commitment:${commitment.id}`,
      type: "supports",
      evidence: [commitment.statement],
      createdAt: new Date().toISOString(),
    });
  }

  linkRelationshipToMission(profile: RelationshipProfile, mission: Mission): void {
    this.relationships.upsert({
      id: randomUUID(),
      fromEntityId: `relationship:${profile.id}`,
      toEntityId: `mission:${mission.id}`,
      type: "involved_in",
      evidence: [profile.displayName, mission.title],
      createdAt: new Date().toISOString(),
    });
  }
}
