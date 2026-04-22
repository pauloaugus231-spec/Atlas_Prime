import { randomUUID } from "node:crypto";
import type { ContactProfileRecord } from "../../types/contact-intelligence.js";
import type { CommitmentCandidate } from "../../types/commitments.js";
import type { LeadRecord } from "../../types/growth-ops.js";
import type { Logger } from "../../types/logger.js";
import type { RelationshipProfile } from "../../types/relationship-profile.js";
import type { GraphIngestionService } from "../knowledge-graph/graph-ingestion.js";
import { RelationshipStore } from "./relationship-store.js";

interface GrowthOpsLike {
  listLeads(filters?: { limit?: number; search?: string; status?: string; domain?: string }): LeadRecord[];
}

interface ContactsLike {
  listContacts(limit?: number): ContactProfileRecord[];
}

interface CommitmentsLike {
  listByStatus(statuses: CommitmentCandidate["status"][], limit?: number): CommitmentCandidate[];
}

export class RelationshipService {
  constructor(
    private readonly store: RelationshipStore,
    private readonly growthOps: GrowthOpsLike,
    private readonly contacts: ContactsLike,
    private readonly commitments: CommitmentsLike,
    private readonly logger: Logger,
    private readonly graphIngestion?: GraphIngestionService,
  ) {}

  syncFromExistingData(): RelationshipProfile[] {
    const now = new Date().toISOString();
    const profiles: RelationshipProfile[] = [];
    for (const lead of this.growthOps.listLeads({ limit: 100 })) {
      const saved = this.store.upsert({
        id: `lead:${lead.id}`,
        displayName: lead.name,
        kind: lead.status === "won" ? "client" : "lead",
        channels: [
          ...(lead.email ? [{ kind: "email" as const, value: lead.email }] : []),
          ...(lead.phone ? [{ kind: "whatsapp" as const, value: lead.phone }] : []),
        ],
        businessContext: {
          stage: lead.status,
          estimatedValue: lead.estimatedOneOffValue ?? lead.estimatedMonthlyValue ?? undefined,
          nextCommercialAction: lead.nextFollowUpAt ? "fazer follow-up" : undefined,
        },
        lastInteractionAt: lead.lastContactAt ?? undefined,
        nextFollowUpAt: lead.nextFollowUpAt ?? undefined,
        openCommitments: this.matchCommitments(lead.name),
        notes: [lead.notes].filter((item): item is string => Boolean(item)),
        trustLevel: lead.status === "won" ? "trusted" : "known",
        createdAt: now,
        updatedAt: now,
      });
      this.graphIngestion?.ingestRelationship(saved);
      profiles.push(saved);
    }
    for (const contact of this.contacts.listContacts(100)) {
      const saved = this.store.upsert({
        id: `contact:${contact.channel}:${contact.identifier}`,
        displayName: contact.displayName ?? contact.identifier,
        kind: contact.relationship === "client" ? "client" : contact.relationship === "partner" ? "partner" : contact.relationship === "family" ? "family" : "unknown",
        channels: [{ kind: contact.channel as RelationshipProfile["channels"][number]["kind"], value: contact.identifier }],
        openCommitments: this.matchCommitments(contact.displayName ?? contact.identifier),
        notes: [contact.notes].filter((item): item is string => Boolean(item)),
        trustLevel: contact.priority === "alta" ? "trusted" : "known",
        createdAt: now,
        updatedAt: now,
      });
      this.graphIngestion?.ingestRelationship(saved);
      profiles.push(saved);
    }
    this.logger.debug("Synced relationship profiles", { total: profiles.length });
    return profiles;
  }

  private matchCommitments(label: string): string[] {
    const normalized = label.toLowerCase();
    return this.commitments
      .listByStatus(["candidate", "confirmed", "converted_to_task"], 50)
      .filter((item) => item.statement.toLowerCase().includes(normalized) || item.normalizedAction.toLowerCase().includes(normalized))
      .map((item) => item.normalizedAction);
  }

  saveManual(input: { displayName: string; kind?: RelationshipProfile["kind"]; notes?: string[]; nextFollowUpAt?: string }): RelationshipProfile {
    const now = new Date().toISOString();
    const profile = this.store.upsert({
      id: `manual:${randomUUID()}`,
      displayName: input.displayName,
      kind: input.kind ?? "unknown",
      channels: [],
      openCommitments: this.matchCommitments(input.displayName),
      notes: input.notes ?? [],
      ...(input.nextFollowUpAt ? { nextFollowUpAt: input.nextFollowUpAt } : {}),
      trustLevel: "known",
      createdAt: now,
      updatedAt: now,
    });
    this.graphIngestion?.ingestRelationship(profile);
    return profile;
  }

  listNeedFollowUp(limit = 10): RelationshipProfile[] {
    this.syncFromExistingData();
    const nowMs = Date.now();
    return this.store.list(100)
      .filter((item) => item.nextFollowUpAt && Date.parse(item.nextFollowUpAt) <= nowMs || item.openCommitments.length > 0)
      .slice(0, limit);
  }

  findByQuery(query: string): RelationshipProfile[] {
    this.syncFromExistingData();
    return this.store.search(query, 10);
  }

  renderFollowUpList(): string {
    const items = this.listNeedFollowUp(8);
    if (items.length === 0) {
      return "Nenhum relacionamento está pedindo follow-up imediato agora.";
    }
    return [
      "Relacionamentos pedindo atenção:",
      ...items.map((item) => `- ${item.displayName} | ${item.kind}${item.nextFollowUpAt ? ` | follow-up ${item.nextFollowUpAt.slice(0, 10)}` : ""}${item.openCommitments[0] ? ` | compromisso: ${item.openCommitments[0]}` : ""}`),
    ].join("\n");
  }

  renderProfile(query: string): string | undefined {
    const profile = this.findByQuery(query)[0];
    if (!profile) {
      return undefined;
    }
    return [
      `${profile.displayName}:`,
      `- Tipo: ${profile.kind}`,
      `- Confiança: ${profile.trustLevel}`,
      ...(profile.businessContext?.stage ? [`- Etapa: ${profile.businessContext.stage}`] : []),
      ...(profile.businessContext?.estimatedValue ? [`- Valor potencial: R$ ${profile.businessContext.estimatedValue.toFixed(2)}`] : []),
      ...(profile.nextFollowUpAt ? [`- Próximo follow-up: ${profile.nextFollowUpAt.slice(0, 10)}`] : []),
      ...(profile.openCommitments.length > 0 ? [`- Compromissos: ${profile.openCommitments.join(" | ")}`] : []),
      ...(profile.notes.length > 0 ? [`- Notas: ${profile.notes.join(" | ")}`] : []),
    ].join("\n");
  }
}
