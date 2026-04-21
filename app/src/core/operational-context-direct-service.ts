import type { AgentRunResult } from "./agent-core.js";
import type { ExecutiveMorningBrief } from "./personal-os.js";
import type { DailyOperationalBrief } from "../integrations/google/google-workspace.js";
import type { ConversationMessage } from "../types/llm.js";
import type { Logger } from "../types/logger.js";
import type { LearnedPreference, LearnedPreferenceType } from "../types/learned-preferences.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type {
  PersonalOperationalMemoryItem,
  PersonalOperationalMemoryItemKind,
  PersonalOperationalProfile,
  UpdatePersonalOperationalProfileInput,
} from "../types/personal-operational-memory.js";
import type { OperationalState } from "../types/operational-state.js";
import type { UpdateUserPreferencesInput, UserPreferences } from "../types/user-preferences.js";

interface GoogleWorkspaceStatusLike {
  ready: boolean;
  message: string;
}

interface GoogleWorkspaceLike {
  getStatus: () => GoogleWorkspaceStatusLike;
  getDailyBrief: () => Promise<DailyOperationalBrief>;
}

interface OperationalMemoryLike {
  getDailyFocus: (limit: number) => Array<{
    item: { title: string };
    whyNow: string;
    nextAction: string;
  }>;
}

interface PersonalOsLike {
  getExecutiveMorningBrief: () => Promise<ExecutiveMorningBrief>;
}

interface PreferencesLike {
  get: () => UserPreferences;
  update: (input: UpdateUserPreferencesInput) => UserPreferences;
}

interface PersonalMemoryLike {
  getProfile: () => PersonalOperationalProfile;
  getOperationalState: () => OperationalState;
  findLearnedPreferences: (query: string, limit?: number) => LearnedPreference[];
  findItems: (query: string, limit?: number) => PersonalOperationalMemoryItem[];
}

interface ToolExecutionResult {
  requestId: string;
  content: string;
  rawResult: unknown;
}

interface ProfileUpdateExtraction {
  profile: UpdatePersonalOperationalProfileInput;
  changeLabels: string[];
  preferenceUpdate?: UpdateUserPreferencesInput;
}

interface ProfileRemovalResult {
  profileUpdate: UpdatePersonalOperationalProfileInput;
  removedLabels: string[];
}

interface OperationalContextDirectHelpers {
  isOperationalBriefPrompt: (prompt: string) => boolean;
  buildOperationalBriefReply: (input: {
    brief: DailyOperationalBrief;
    focus: Array<{ title: string; whyNow: string; nextAction: string }>;
  }) => string;
  isMorningBriefPrompt: (prompt: string) => boolean;
  buildMorningBriefReply: (
    brief: ExecutiveMorningBrief,
    options?: {
      compact?: boolean;
      profile?: PersonalOperationalProfile;
      operationalMode?: "field" | null;
    },
  ) => string;
  resolveEffectiveOperationalMode: (
    prompt: string,
    profile: PersonalOperationalProfile,
  ) => "field" | null;
  isPersonalOperationalProfileShowPrompt: (prompt: string) => boolean;
  buildPersonalOperationalProfileReply: (profile: PersonalOperationalProfile) => string;
  isOperationalStateShowPrompt: (prompt: string) => boolean;
  buildOperationalStateReply: (state: OperationalState) => string;
  isLearnedPreferencesListPrompt: (prompt: string) => boolean;
  resolveLearnedPreferencesListFilter: (prompt: string) => {
    type?: LearnedPreferenceType;
    search?: string;
  };
  buildLearnedPreferencesReply: (items: LearnedPreference[]) => string;
  isLearnedPreferencesDeletePrompt: (prompt: string) => boolean;
  extractLearnedPreferenceId: (prompt: string) => number | undefined;
  extractLearnedPreferenceDeleteTarget: (prompt: string) => string | undefined;
  buildLearnedPreferenceDeactivatedReply: (item: LearnedPreference) => string;
  isPersonalOperationalProfileUpdatePrompt: (prompt: string) => boolean;
  extractPersonalOperationalProfileUpdate: (
    prompt: string,
    currentProfile: PersonalOperationalProfile,
  ) => ProfileUpdateExtraction | null;
  buildPersonalOperationalProfileUpdatedReply: (
    profile: PersonalOperationalProfile,
    changeLabels: string[],
  ) => string;
  isPersonalOperationalProfileDeletePrompt: (prompt: string) => boolean;
  extractPersonalOperationalProfileRemoveQuery: (prompt: string) => string | undefined;
  removeFromPersonalOperationalProfile: (
    profile: PersonalOperationalProfile,
    query: string,
  ) => ProfileRemovalResult | null;
  buildPersonalOperationalProfileRemovedReply: (
    profile: PersonalOperationalProfile,
    removedLabels: string[],
  ) => string;
  isPersonalMemoryListPrompt: (prompt: string) => boolean;
  buildPersonalMemoryListReply: (input: {
    profile: PersonalOperationalProfile;
    items: PersonalOperationalMemoryItem[];
  }) => string;
  isPersonalMemorySavePrompt: (prompt: string) => boolean;
  extractPersonalMemoryStatement: (prompt: string) => string | undefined;
  inferPersonalMemoryKind: (statement: string) => PersonalOperationalMemoryItemKind;
  buildPersonalMemoryTitle: (statement: string, kind: PersonalOperationalMemoryItemKind) => string;
  buildPersonalMemorySavedReply: (item: PersonalOperationalMemoryItem) => string;
  isPersonalMemoryUpdatePrompt: (prompt: string) => boolean;
  extractPersonalMemoryId: (prompt: string) => number | undefined;
  extractPersonalMemoryUpdateTarget: (prompt: string) => string | undefined;
  extractPersonalMemoryUpdateContent: (prompt: string) => string | undefined;
  buildPersonalMemoryAmbiguousReply: (query: string, items: PersonalOperationalMemoryItem[]) => string;
  buildPersonalMemoryUpdatedReply: (item: PersonalOperationalMemoryItem) => string;
  isPersonalMemoryDeletePrompt: (prompt: string) => boolean;
  extractPersonalMemoryDeleteTarget: (prompt: string) => string | undefined;
  buildPersonalMemoryDeletedReply: (item: PersonalOperationalMemoryItem) => string;
}

export interface OperationalContextDirectServiceDependencies {
  logger: Logger;
  googleWorkspace: GoogleWorkspaceLike;
  memory: OperationalMemoryLike;
  personalOs: PersonalOsLike;
  preferences: PreferencesLike;
  personalMemory: PersonalMemoryLike;
  executeToolDirect: (toolName: string, rawArguments: unknown) => Promise<ToolExecutionResult>;
  buildBaseMessages: (
    userPrompt: string,
    orchestration: OrchestrationContext,
    preferences?: UserPreferences,
  ) => ConversationMessage[];
  helpers: OperationalContextDirectHelpers;
}

interface OperationalContextDirectInput {
  userPrompt: string;
  requestId: string;
  orchestration: OrchestrationContext;
  preferences?: UserPreferences;
  requestLogger?: Logger;
}

function buildProfileUpdateToolArguments(profile: UpdatePersonalOperationalProfileInput): Record<string, unknown> {
  return {
    ...(profile.displayName ? { displayName: profile.displayName } : {}),
    ...(profile.primaryRole ? { primaryRole: profile.primaryRole } : {}),
    ...(profile.routineSummary ? { routineSummary: profile.routineSummary } : {}),
    ...(profile.timezone ? { timezone: profile.timezone } : {}),
    ...(profile.preferredChannels ? { preferredChannels: profile.preferredChannels } : {}),
    ...(profile.preferredAlertChannel ? { preferredAlertChannel: profile.preferredAlertChannel } : {}),
    ...(profile.priorityAreas ? { priorityAreas: profile.priorityAreas } : {}),
    ...(profile.defaultAgendaScope ? { defaultAgendaScope: profile.defaultAgendaScope } : {}),
    ...(profile.responseStyle ? { responseStyle: profile.responseStyle } : {}),
    ...(profile.briefingPreference ? { briefingPreference: profile.briefingPreference } : {}),
    ...(profile.detailLevel ? { detailLevel: profile.detailLevel } : {}),
    ...(profile.tonePreference ? { tonePreference: profile.tonePreference } : {}),
    ...(profile.defaultOperationalMode ? { defaultOperationalMode: profile.defaultOperationalMode } : {}),
    ...(profile.mobilityPreferences ? { mobilityPreferences: profile.mobilityPreferences } : {}),
    ...(profile.autonomyPreferences ? { autonomyPreferences: profile.autonomyPreferences } : {}),
    ...(profile.savedFocus ? { savedFocus: profile.savedFocus } : {}),
    ...(profile.routineAnchors ? { routineAnchors: profile.routineAnchors } : {}),
    ...(profile.operationalRules ? { operationalRules: profile.operationalRules } : {}),
    ...(profile.attire?.carryItems ? { carryItems: profile.attire.carryItems } : {}),
    ...(typeof profile.fieldModeHours === "number" ? { fieldModeHours: profile.fieldModeHours } : {}),
  };
}

export class OperationalContextDirectService {
  constructor(private readonly deps: OperationalContextDirectServiceDependencies) {}

  async tryRunOperationalBrief(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isOperationalBriefPrompt(input.userPrompt)) {
      return null;
    }

    const status = this.deps.googleWorkspace.getStatus();
    if (!status.ready) {
      return {
        requestId: input.requestId,
        reply: `A integração Google Workspace não está pronta. ${status.message}`,
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const logger = input.requestLogger ?? this.deps.logger;
    logger.info("Using direct operational brief route", {
      domain: input.orchestration.route.primaryDomain,
    });

    const brief = await this.deps.googleWorkspace.getDailyBrief();
    const focus = this.deps.memory.getDailyFocus(4).map((item) => ({
      title: item.item.title,
      whyNow: item.whyNow,
      nextAction: item.nextAction,
    }));

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildOperationalBriefReply({
        brief,
        focus,
      }),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "daily_operational_brief",
          resultPreview: JSON.stringify(
            {
              events: brief.events.length,
              tasks: brief.tasks.length,
              focus: focus.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async tryRunMorningBrief(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isMorningBriefPrompt(input.userPrompt)) {
      return null;
    }

    const logger = input.requestLogger ?? this.deps.logger;
    logger.info("Using direct morning brief route", {
      domain: input.orchestration.route.primaryDomain,
    });

    const brief = await this.deps.personalOs.getExecutiveMorningBrief();
    const profile = this.deps.personalMemory.getProfile();
    const operationalMode = this.deps.helpers.resolveEffectiveOperationalMode(input.userPrompt, profile);

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildMorningBriefReply(brief, {
        compact: operationalMode === "field",
        operationalMode,
        profile,
      }),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "morning_brief",
          resultPreview: JSON.stringify(
            {
              events: brief.events.length,
              tasks: brief.taskBuckets.actionableCount,
              emails: brief.emails.length,
              approvals: brief.approvals.length,
              workflows: brief.workflows.length,
              founderSections: brief.founderSnapshot.sections.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async tryRunProfileShow(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isPersonalOperationalProfileShowPrompt(input.userPrompt)) {
      return null;
    }

    const execution = await this.deps.executeToolDirect("get_personal_operational_profile", {});
    const rawResult = execution.rawResult as {
      profile?: PersonalOperationalProfile;
    };

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildPersonalOperationalProfileReply(rawResult.profile ?? this.deps.personalMemory.getProfile()),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "get_personal_operational_profile",
          resultPreview: execution.content.slice(0, 240),
        },
      ],
    };
  }

  async tryRunOperationalStateShow(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isOperationalStateShowPrompt(input.userPrompt)) {
      return null;
    }

    const execution = await this.deps.executeToolDirect("get_operational_state", {});
    const rawResult = execution.rawResult as {
      state?: OperationalState;
    };

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildOperationalStateReply(rawResult.state ?? this.deps.personalMemory.getOperationalState()),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "get_operational_state",
          resultPreview: execution.content.slice(0, 240),
        },
      ],
    };
  }

  async tryRunLearnedPreferencesList(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isLearnedPreferencesListPrompt(input.userPrompt)) {
      return null;
    }

    const filter = this.deps.helpers.resolveLearnedPreferencesListFilter(input.userPrompt);
    const execution = await this.deps.executeToolDirect("list_learned_preferences", {
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.search ? { search: filter.search } : {}),
      limit: 12,
    });
    const rawResult = execution.rawResult as { items?: LearnedPreference[] };
    const items = filter.search === "agenda"
      ? (rawResult.items ?? []).filter((item) =>
          ["schedule_import_mode", "agenda_scope", "calendar_interpretation"].includes(item.type),
        )
      : (rawResult.items ?? []);

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildLearnedPreferencesReply(items),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "list_learned_preferences",
          resultPreview: execution.content.slice(0, 240),
        },
      ],
    };
  }

  async tryRunLearnedPreferencesDelete(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isLearnedPreferencesDeletePrompt(input.userPrompt)) {
      return null;
    }

    let targetId = this.deps.helpers.extractLearnedPreferenceId(input.userPrompt);
    const query = this.deps.helpers.extractLearnedPreferenceDeleteTarget(input.userPrompt);
    if (!targetId && !query) {
      return {
        requestId: input.requestId,
        reply: "Diga qual preferência aprendida devo desativar, por id ou por referência curta.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    if (!targetId && query) {
      const matches = this.deps.personalMemory.findLearnedPreferences(query, 5);
      if (matches.length === 0) {
        return {
          requestId: input.requestId,
          reply: `Não encontrei preferência aprendida para "${query}".`,
          messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
          toolExecutions: [],
        };
      }
      if (matches.length > 1) {
        return {
          requestId: input.requestId,
          reply: this.deps.helpers.buildLearnedPreferencesReply(matches),
          messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
          toolExecutions: [],
        };
      }
      targetId = matches[0]?.id;
    }

    if (!targetId) {
      return null;
    }

    const execution = await this.deps.executeToolDirect("deactivate_learned_preference", {
      id: targetId,
    });
    const rawResult = execution.rawResult as {
      item?: LearnedPreference;
    };
    const item = rawResult.item;

    return {
      requestId: input.requestId,
      reply: item
        ? this.deps.helpers.buildLearnedPreferenceDeactivatedReply(item)
        : "Não consegui desativar essa preferência aprendida.",
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: item
        ? [
            {
              toolName: "deactivate_learned_preference",
              resultPreview: execution.content.slice(0, 240),
            },
          ]
        : [],
    };
  }

  async tryRunProfileUpdate(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isPersonalOperationalProfileUpdatePrompt(input.userPrompt)) {
      return null;
    }

    const currentProfile = this.deps.personalMemory.getProfile();
    const extracted = this.deps.helpers.extractPersonalOperationalProfileUpdate(input.userPrompt, currentProfile);
    if (!extracted) {
      return {
        requestId: input.requestId,
        reply: "Diga o ajuste de perfil que você quer. Exemplo: `defina meu estilo de resposta como direto e objetivo`.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const execution = await this.deps.executeToolDirect(
      "update_personal_operational_profile",
      buildProfileUpdateToolArguments(extracted.profile),
    );
    if (extracted.preferenceUpdate) {
      this.deps.preferences.update(extracted.preferenceUpdate);
    }

    const rawResult = execution.rawResult as {
      profile?: PersonalOperationalProfile;
    };

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildPersonalOperationalProfileUpdatedReply(
        rawResult.profile ?? this.deps.personalMemory.getProfile(),
        extracted.changeLabels,
      ),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, this.deps.preferences.get()),
      toolExecutions: [
        {
          toolName: "update_personal_operational_profile",
          resultPreview: execution.content.slice(0, 240),
        },
      ],
    };
  }

  async tryRunProfileDelete(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isPersonalOperationalProfileDeletePrompt(input.userPrompt)) {
      return null;
    }

    const currentProfile = this.deps.personalMemory.getProfile();
    const query = this.deps.helpers.extractPersonalOperationalProfileRemoveQuery(input.userPrompt);
    if (!query) {
      return {
        requestId: input.requestId,
        reply: "Diga o que devo remover do seu perfil operacional.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const removal = this.deps.helpers.removeFromPersonalOperationalProfile(currentProfile, query);
    if (!removal) {
      return {
        requestId: input.requestId,
        reply: `Não encontrei ajuste de perfil compatível com "${query}".`,
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const execution = await this.deps.executeToolDirect(
      "update_personal_operational_profile",
      buildProfileUpdateToolArguments(removal.profileUpdate),
    );
    const preferenceReset: UpdateUserPreferencesInput = {};
    if (removal.profileUpdate.responseStyle || removal.profileUpdate.tonePreference) {
      preferenceReset.responseStyle = "executive";
    }
    if (removal.profileUpdate.briefingPreference || removal.profileUpdate.detailLevel) {
      preferenceReset.responseLength = "short";
    }
    if (Object.keys(preferenceReset).length > 0) {
      this.deps.preferences.update(preferenceReset);
    }

    const rawResult = execution.rawResult as {
      profile?: PersonalOperationalProfile;
    };

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildPersonalOperationalProfileRemovedReply(
        rawResult.profile ?? this.deps.personalMemory.getProfile(),
        removal.removedLabels,
      ),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "update_personal_operational_profile",
          resultPreview: execution.content.slice(0, 240),
        },
      ],
    };
  }

  async tryRunPersonalMemoryList(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isPersonalMemoryListPrompt(input.userPrompt)) {
      return null;
    }

    const execution = await this.deps.executeToolDirect("list_personal_memory_items", {
      limit: 12,
    });
    const rawResult = execution.rawResult as {
      items?: PersonalOperationalMemoryItem[];
      profile?: PersonalOperationalProfile;
    };

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildPersonalMemoryListReply({
        profile: rawResult.profile ?? this.deps.personalMemory.getProfile(),
        items: rawResult.items ?? [],
      }),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "list_personal_memory_items",
          resultPreview: execution.content.slice(0, 240),
        },
      ],
    };
  }

  async tryRunPersonalMemorySave(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isPersonalMemorySavePrompt(input.userPrompt)) {
      return null;
    }

    const statement = this.deps.helpers.extractPersonalMemoryStatement(input.userPrompt);
    if (!statement) {
      return {
        requestId: input.requestId,
        reply: "Diga o que devo salvar na memória pessoal. Exemplo: `salve na minha memória pessoal que em dias de plantão quero respostas curtas`.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const kind = this.deps.helpers.inferPersonalMemoryKind(statement);
    const execution = await this.deps.executeToolDirect("save_personal_memory_item", {
      kind,
      title: this.deps.helpers.buildPersonalMemoryTitle(statement, kind),
      content: statement,
    });
    const rawResult = execution.rawResult as { item?: PersonalOperationalMemoryItem };
    const item = rawResult.item;
    if (!item) {
      return {
        requestId: input.requestId,
        reply: "Não consegui salvar esse item na memória pessoal.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildPersonalMemorySavedReply(item),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "save_personal_memory_item",
          resultPreview: execution.content.slice(0, 240),
        },
      ],
    };
  }

  async tryRunPersonalMemoryUpdate(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isPersonalMemoryUpdatePrompt(input.userPrompt)) {
      return null;
    }

    const id = this.deps.helpers.extractPersonalMemoryId(input.userPrompt);
    const query = this.deps.helpers.extractPersonalMemoryUpdateTarget(input.userPrompt);
    const content = this.deps.helpers.extractPersonalMemoryUpdateContent(input.userPrompt);
    if (!id && !query) {
      return {
        requestId: input.requestId,
        reply: "Diga qual item da memória pessoal devo atualizar, por id ou por referência curta. Exemplo: `atualize minha memória pessoal #3 para respostas muito curtas em plantão`.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    if (!content) {
      return {
        requestId: input.requestId,
        reply: "Entendi o item alvo, mas faltou dizer o novo conteúdo. Exemplo: `atualize minha memória pessoal sobre rotina de plantão para respostas curtas e foco em deslocamento`.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    let targetId = id;
    if (!targetId && query) {
      const matches = this.deps.personalMemory.findItems(query, 5);
      if (matches.length === 0) {
        return {
          requestId: input.requestId,
          reply: `Não encontrei item de memória pessoal para "${query}".`,
          messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
          toolExecutions: [],
        };
      }
      if (matches.length > 1) {
        return {
          requestId: input.requestId,
          reply: this.deps.helpers.buildPersonalMemoryAmbiguousReply(query, matches),
          messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
          toolExecutions: [],
        };
      }
      targetId = matches[0]?.id;
    }

    if (!targetId) {
      return null;
    }

    const kind = this.deps.helpers.inferPersonalMemoryKind(content);
    const execution = await this.deps.executeToolDirect("update_personal_memory_item", {
      id: targetId,
      kind,
      title: this.deps.helpers.buildPersonalMemoryTitle(content, kind),
      content,
    });
    const rawResult = execution.rawResult as { item?: PersonalOperationalMemoryItem };
    const item = rawResult.item;
    if (!item) {
      return {
        requestId: input.requestId,
        reply: "Não consegui atualizar esse item da memória pessoal.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildPersonalMemoryUpdatedReply(item),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "update_personal_memory_item",
          resultPreview: execution.content.slice(0, 240),
        },
      ],
    };
  }

  async tryRunPersonalMemoryDelete(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isPersonalMemoryDeletePrompt(input.userPrompt)) {
      return null;
    }

    let targetId = this.deps.helpers.extractPersonalMemoryId(input.userPrompt);
    const query = this.deps.helpers.extractPersonalMemoryDeleteTarget(input.userPrompt);

    if (!targetId && !query) {
      return {
        requestId: input.requestId,
        reply: "Diga qual item da memória pessoal devo remover, por id ou por referência curta. Exemplo: `remova da minha memória pessoal #4`.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    if (!targetId && query) {
      const matches = this.deps.personalMemory.findItems(query, 5);
      if (matches.length === 0) {
        return {
          requestId: input.requestId,
          reply: `Não encontrei item de memória pessoal para "${query}".`,
          messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
          toolExecutions: [],
        };
      }
      if (matches.length > 1) {
        return {
          requestId: input.requestId,
          reply: this.deps.helpers.buildPersonalMemoryAmbiguousReply(query, matches),
          messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
          toolExecutions: [],
        };
      }
      targetId = matches[0]?.id;
    }

    if (!targetId) {
      return null;
    }

    const execution = await this.deps.executeToolDirect("delete_personal_memory_item", {
      id: targetId,
    });
    const rawResult = execution.rawResult as { item?: PersonalOperationalMemoryItem };
    const item = rawResult.item;
    if (!item) {
      return {
        requestId: input.requestId,
        reply: "Não consegui remover esse item da memória pessoal.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildPersonalMemoryDeletedReply(item),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "delete_personal_memory_item",
          resultPreview: execution.content.slice(0, 240),
        },
      ],
    };
  }
}
