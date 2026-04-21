import process from "node:process";
import { AgentCore } from "../src/core/agent-core.js";
import type { Logger } from "../src/types/logger.js";
import type { UserPreferences } from "../src/types/user-preferences.js";

type EvalResult = {
  name: string;
  passed: boolean;
  detail?: string;
};

function assert(name: string, passed: boolean, detail?: string): EvalResult {
  return { name, passed, detail };
}

function makeLogger(): Logger {
  const logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => logger,
  } as unknown as Logger;
  return logger;
}

function buildOrchestration(): any {
  return {
    route: {
      primaryDomain: "secretario_operacional",
      secondaryDomains: [],
      confidence: 0.9,
      actionMode: "assist",
      reasons: ["eval"],
    },
    policy: {
      riskLevel: "medium",
      autonomyLevel: "draft_with_confirmation",
      guardrails: [],
      requiresApprovalFor: [],
      capabilities: {
        canReadSensitiveChannels: true,
        canDraftExternalReplies: true,
        canSendExternalReplies: false,
        canWriteWorkspace: false,
        canPersistMemory: true,
        canRunProjectTools: true,
        canModifyCalendar: true,
        canPublishContent: false,
      },
    },
  };
}

function buildPreferences(): UserPreferences {
  return {
    responseStyle: "executive",
    responseLength: "medium",
    proactiveNextStep: false,
    autoSourceFallback: false,
    preferredAgentName: "Atlas",
  };
}

function buildCoreStub() {
  const core = Object.create(AgentCore.prototype) as AgentCore;
  const logger = makeLogger();
  const contactUpserts: Array<Record<string, unknown>> = [];
  const linkedContacts: string[] = [];
  const listCalls: Array<{ limit?: number; kind?: string }> = [];
  const searchCalls: Array<{ query: string; limit?: number; kind?: string }> = [];

  (core as any).logger = logger;
  (core as any).contacts = {
    listContacts: () => [
      {
        id: 1,
        channel: "telegram",
        identifier: "@paulo",
        displayName: "Paulo",
        relationship: "friend",
        persona: "pessoal_afetivo",
        priority: "alta",
        company: null,
        preferredTone: null,
        notes: null,
        tags: [],
        source: "manual",
        createdAt: "2026-04-20T00:00:00.000Z",
        updatedAt: "2026-04-20T00:00:00.000Z",
      },
    ],
    upsertContact: (input: Record<string, unknown>) => {
      contactUpserts.push(input);
      return {
        id: 2,
        channel: String(input.channel),
        identifier: String(input.identifier),
        displayName: typeof input.displayName === "string" ? input.displayName : null,
        relationship: input.relationship,
        persona: input.persona,
        priority: input.priority ?? "media",
        company: typeof input.company === "string" ? input.company : null,
        preferredTone: typeof input.preferredTone === "string" ? input.preferredTone : null,
        notes: null,
        tags: [],
        source: "manual",
        createdAt: "2026-04-20T00:00:00.000Z",
        updatedAt: "2026-04-20T00:00:00.000Z",
      };
    },
  };
  (core as any).entityLinker = {
    upsertContact: (contact: { identifier: string }) => {
      linkedContacts.push(contact.identifier);
      return undefined;
    },
  };
  (core as any).memoryEntities = {
    list: (limit?: number, kind?: string) => {
      listCalls.push({ limit, kind });
      return [
        {
          id: "contact:2",
          kind: "contact",
          title: "Paulo",
          tags: ["telegram"],
          state: {},
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z",
        },
      ];
    },
    search: (query: string, limit?: number, kind?: string) => {
      searchCalls.push({ query, limit, kind });
      return [
        {
          id: "contact:2",
          kind: "contact",
          title: "Paulo",
          tags: ["telegram"],
          state: { query },
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z",
        },
      ];
    },
  };

  return { core, contactUpserts, linkedContacts, listCalls, searchCalls };
}

async function run(): Promise<void> {
  const results: EvalResult[] = [];
  const { core, contactUpserts, linkedContacts, listCalls, searchCalls } = buildCoreStub();
  const orchestration = buildOrchestration();
  const preferences = buildPreferences();

  {
    const result = await (core as any).tryRunDirectContactList(
      "liste meus contatos",
      "req-phase15-contact-list",
      orchestration,
      preferences,
    );

    results.push(assert(
      "agent_core_contact_list_wrapper_uses_memory_contact_service",
      Boolean(
        result?.reply?.includes("Contatos inteligentes: 1.") &&
        result.reply.includes("Paulo | friend | pessoal_afetivo | telegram") &&
        result.toolExecutions.length === 0,
      ),
      result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectContactUpsert(
      "salve contato nome Paulo telegram @paulo",
      "req-phase15-contact-upsert",
      orchestration,
      preferences,
    );

    results.push(assert(
      "agent_core_contact_upsert_wrapper_uses_memory_contact_service_and_links_entity",
      Boolean(
        result?.reply?.includes("Contato salvo.") &&
        contactUpserts.length === 1 &&
        linkedContacts.includes("@paulo") &&
        result.toolExecutions.length === 0,
      ),
      JSON.stringify({
        contactUpserts,
        linkedContacts,
      }),
    ));
  }

  {
    const result = await (core as any).tryRunDirectMemoryEntityList(
      "liste as entidades de contato",
      "req-phase15-memory-entity-list",
      orchestration,
      preferences,
    );

    results.push(assert(
      "agent_core_memory_entity_list_wrapper_uses_memory_contact_service",
      Boolean(
        result?.reply?.includes("Entidades do tipo contact: 1.") &&
        listCalls.length === 1 &&
        listCalls[0]?.kind === "contact" &&
        result.toolExecutions.length === 0,
      ),
      JSON.stringify({
        listCalls,
        reply: result?.reply,
      }),
    ));
  }

  {
    const result = await (core as any).tryRunDirectMemoryEntitySearch(
      'busque entidades "Paulo" do tipo contato',
      "req-phase15-memory-entity-search",
      orchestration,
      preferences,
    );

    results.push(assert(
      "agent_core_memory_entity_search_wrapper_uses_memory_contact_service",
      Boolean(
        result?.reply?.includes('Entidades encontradas para "Paulo": 1.') &&
        searchCalls.length === 1 &&
        searchCalls[0]?.query === "Paulo" &&
        searchCalls[0]?.kind === "contact" &&
        result.toolExecutions.length === 0,
      ),
      JSON.stringify({
        searchCalls,
        reply: result?.reply,
      }),
    ));
  }

  const failed = results.filter((item) => !item.passed);
  for (const result of results) {
    const prefix = result.passed ? "PASS" : "FAIL";
    const suffix = result.detail ? ` :: ${result.detail}` : "";
    console.log(`${prefix} ${result.name}${suffix}`);
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("eval-agent-core-phase15 failed", error);
  process.exitCode = 1;
});
