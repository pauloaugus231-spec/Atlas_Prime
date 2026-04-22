import type { Logger } from "../../types/logger.js";
import { EntityStore } from "./entity-store.js";
import { RelationshipStore } from "./relationship-store.js";

export class GraphQueryService {
  constructor(
    private readonly entities: EntityStore,
    private readonly relationships: RelationshipStore,
    private readonly logger: Logger,
  ) {}

  explain(query: string): string {
    const entity = this.entities.search(query, 1)[0];
    if (!entity) {
      return "Ainda não encontrei esse item no grafo de conhecimento.";
    }
    const relations = this.relationships.listForEntity(entity.id);
    return [
      `Conhecimento sobre ${entity.label}:`,
      `- Tipo: ${entity.kind}`,
      `- Relações: ${relations.length}`,
      ...relations.slice(0, 5).map((item) => `- ${item.type}: ${item.fromEntityId === entity.id ? item.toEntityId : item.fromEntityId}`),
    ].join("\n");
  }
}
