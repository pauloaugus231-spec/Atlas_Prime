import type { Logger } from "../types/logger.js";
import type { MemoryEntityRecord } from "../types/memory-entities.js";
import { resolveMemoryScope, type MemoryScope } from "./memory-scopes.js";
import type { MemoryEntityStore } from "./memory-entity-store.js";

export interface ScopedMemorySummary {
  scope: MemoryScope;
  total: number;
  entities: MemoryEntityRecord[];
  signals: string[];
}

function deriveSignal(entity: MemoryEntityRecord): string | null {
  switch (entity.kind) {
    case "approval":
      return `aprovação recente: ${entity.title}`;
    case "workflow_run":
      return `workflow ativo: ${entity.title}`;
    case "task":
      return `tarefa rastreada: ${entity.title}`;
    case "contact":
      return `contato relevante: ${entity.title}`;
    case "project":
      return `projeto ativo: ${entity.title}`;
    case "lead":
      return `lead em aberto: ${entity.title}`;
    case "content_item":
      return `conteúdo recente: ${entity.title}`;
    case "research_session":
      return `pesquisa recente: ${entity.title}`;
    default:
      return null;
  }
}

export class ContextMemoryService {
  constructor(
    private readonly entities: MemoryEntityStore,
    private readonly logger: Logger,
  ) {}

  summarize(scope: MemoryScope, limit = 6): ScopedMemorySummary {
    const recent = this.entities.list(24);
    const scoped = recent.filter((entity) => resolveMemoryScope(entity) === scope).slice(0, limit);
    const signals = scoped
      .map((entity) => deriveSignal(entity))
      .filter((value): value is string => Boolean(value));

    this.logger.debug("Built scoped memory summary", {
      scope,
      total: scoped.length,
    });

    return {
      scope,
      total: scoped.length,
      entities: scoped,
      signals,
    };
  }
}
