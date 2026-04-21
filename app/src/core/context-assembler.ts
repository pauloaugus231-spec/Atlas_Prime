import type { ConversationMessage, LlmToolDefinition } from "../types/llm.js";
import type { Logger } from "../types/logger.js";
import type { OperationalState } from "../types/operational-state.js";
import type {
  PersonalOperationalProfile,
} from "../types/personal-operational-memory.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type { UserPreferences } from "../types/user-preferences.js";
import type { ReasoningTrace } from "./reasoning-engine.js";

export interface ContextBundle {
  requestId: string;
  userPrompt: string;
  activeUserPrompt: string;
  orchestration: OrchestrationContext;
  preferences: UserPreferences;
  recentMessages: string[];
  profile?: PersonalOperationalProfile;
  operationalState?: OperationalState;
  memorySummary?: string;
  messages: ConversationMessage[];
  tools: LlmToolDefinition[];
  maxToolIterations: number;
  reasoningTrace?: ReasoningTrace;
}

export interface AssembleContextInput {
  requestId: string;
  userPrompt: string;
  activeUserPrompt: string;
  orchestration: OrchestrationContext;
  preferences: UserPreferences;
  recentMessages?: string[];
}

export interface ContextAssemblerDependencies {
  buildBaseMessages(
    userPrompt: string,
    orchestration: OrchestrationContext,
    preferences?: UserPreferences,
  ): ConversationMessage[];
  selectToolsForPrompt(userPrompt: string): LlmToolDefinition[];
  getMemorySummary(): string | undefined;
  getProfile(): PersonalOperationalProfile | undefined;
  getOperationalState(): OperationalState | undefined;
}

export class ContextAssembler {
  constructor(
    private readonly logger: Logger,
    private readonly deps: ContextAssemblerDependencies,
    private readonly options: {
      maxToolIterations: number;
    },
  ) {}

  assemble(input: AssembleContextInput): ContextBundle {
    const memorySummary = this.deps.getMemorySummary();
    const profile = this.deps.getProfile();
    const operationalState = this.deps.getOperationalState();
    const tools = this.deps.selectToolsForPrompt(input.activeUserPrompt);
    const baseMessages = this.deps.buildBaseMessages(
      input.userPrompt,
      input.orchestration,
      input.preferences,
    );
    const messages: ConversationMessage[] = [
      ...baseMessages,
      ...(memorySummary
        ? [{
            role: "system" as const,
            content: `Memória operacional atual do usuário:\n${memorySummary}`,
          }]
        : []),
      {
        role: "user",
        content: input.userPrompt,
      },
    ];

    this.logger.info("Assembled turn context bundle", {
      requestId: input.requestId,
      toolsAvailable: tools.length,
      hasMemorySummary: Boolean(memorySummary),
      hasProfile: Boolean(profile),
      hasOperationalState: Boolean(operationalState),
      recentMessages: input.recentMessages?.length ?? 0,
      maxToolIterations: this.options.maxToolIterations,
    });

    return {
      requestId: input.requestId,
      userPrompt: input.userPrompt,
      activeUserPrompt: input.activeUserPrompt,
      orchestration: input.orchestration,
      preferences: input.preferences,
      recentMessages: input.recentMessages ?? [],
      profile,
      operationalState,
      memorySummary,
      messages,
      tools,
      maxToolIterations: this.options.maxToolIterations,
    };
  }
}
