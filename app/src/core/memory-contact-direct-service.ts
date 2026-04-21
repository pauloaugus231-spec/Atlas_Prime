import type { AgentRunResult } from "./agent-core.js";
import type { ConversationMessage } from "../types/llm.js";
import type { Logger } from "../types/logger.js";
import type {
  ContactProfileRecord,
  UpsertContactProfileInput,
} from "../types/contact-intelligence.js";
import type { MemoryEntityKind, MemoryEntityRecord } from "../types/memory-entities.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type { UserPreferences } from "../types/user-preferences.js";

interface ContactsLike {
  listContacts: (limit?: number) => ContactProfileRecord[];
  upsertContact: (input: UpsertContactProfileInput) => ContactProfileRecord;
}

interface EntityLinkerLike {
  upsertContact: (contact: ContactProfileRecord) => unknown;
}

interface MemoryEntitiesLike {
  list: (limit?: number, kind?: MemoryEntityKind) => MemoryEntityRecord[];
  search: (query: string, limit?: number, kind?: MemoryEntityKind) => MemoryEntityRecord[];
}

interface MemoryContactDirectHelpers {
  isContactListPrompt: (prompt: string) => boolean;
  isContactUpsertPrompt: (prompt: string) => boolean;
  extractContactProfileInput: (prompt: string) => UpsertContactProfileInput | undefined;
  buildContactSaveReply: (contact: ContactProfileRecord) => string;
  buildContactListReply: (contacts: ContactProfileRecord[]) => string;
  isMemoryEntityListPrompt: (prompt: string) => boolean;
  isMemoryEntitySearchPrompt: (prompt: string) => boolean;
  extractMemoryEntityKindFromPrompt: (prompt: string) => MemoryEntityKind | undefined;
  extractMemoryEntitySearchQuery: (prompt: string) => string | undefined;
  buildMemoryEntityListReply: (entities: MemoryEntityRecord[], input: {
    kind?: MemoryEntityKind;
    query?: string;
  }) => string;
}

export interface MemoryContactDirectServiceDependencies {
  logger: Logger;
  contacts: ContactsLike;
  entityLinker: EntityLinkerLike;
  memoryEntities: MemoryEntitiesLike;
  buildBaseMessages: (
    userPrompt: string,
    orchestration: OrchestrationContext,
    preferences?: UserPreferences,
  ) => ConversationMessage[];
  helpers: MemoryContactDirectHelpers;
}

export interface MemoryContactDirectInput {
  userPrompt: string;
  requestId: string;
  orchestration: OrchestrationContext;
  preferences?: UserPreferences;
}

export class MemoryContactDirectService {
  constructor(private readonly deps: MemoryContactDirectServiceDependencies) {}

  tryRunContactList(input: MemoryContactDirectInput): AgentRunResult | null {
    if (!this.deps.helpers.isContactListPrompt(input.userPrompt)) {
      return null;
    }

    const contacts = this.deps.contacts.listContacts(20);
    this.deps.logger.info("Listing direct contacts", {
      total: contacts.length,
    });
    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildContactListReply(contacts),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [],
    };
  }

  tryRunContactUpsert(input: MemoryContactDirectInput): AgentRunResult | null {
    if (!this.deps.helpers.isContactUpsertPrompt(input.userPrompt)) {
      return null;
    }

    const payload = this.deps.helpers.extractContactProfileInput(input.userPrompt);
    if (!payload) {
      return {
        requestId: input.requestId,
        reply: "Para salvar um contato, eu preciso ao menos de um email, @username do Telegram ou número de telefone.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const contact = this.deps.contacts.upsertContact(payload);
    this.deps.entityLinker.upsertContact(contact);
    this.deps.logger.info("Upserted direct contact", {
      channel: contact.channel,
      identifier: contact.identifier,
      relationship: contact.relationship,
    });
    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildContactSaveReply(contact),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [],
    };
  }

  tryRunMemoryEntityList(input: MemoryContactDirectInput): AgentRunResult | null {
    if (!this.deps.helpers.isMemoryEntityListPrompt(input.userPrompt)) {
      return null;
    }

    const kind = this.deps.helpers.extractMemoryEntityKindFromPrompt(input.userPrompt);
    const entities = this.deps.memoryEntities.list(12, kind);
    this.deps.logger.info("Listing direct memory entities", {
      total: entities.length,
      kind,
    });
    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildMemoryEntityListReply(entities, { kind }),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [],
    };
  }

  tryRunMemoryEntitySearch(input: MemoryContactDirectInput): AgentRunResult | null {
    if (!this.deps.helpers.isMemoryEntitySearchPrompt(input.userPrompt)) {
      return null;
    }

    const query = this.deps.helpers.extractMemoryEntitySearchQuery(input.userPrompt);
    if (!query) {
      return {
        requestId: input.requestId,
        reply: "Para buscar entidades, eu preciso de um termo ou frase entre aspas.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const kind = this.deps.helpers.extractMemoryEntityKindFromPrompt(input.userPrompt);
    const entities = this.deps.memoryEntities.search(query, 12, kind);
    this.deps.logger.info("Searching direct memory entities", {
      query,
      total: entities.length,
      kind,
    });
    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildMemoryEntityListReply(entities, { kind, query }),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [],
    };
  }
}
