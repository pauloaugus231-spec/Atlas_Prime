import type { AgentRunResult } from "./agent-core.js";
import type { ConversationMessage } from "../types/llm.js";
import type { Logger } from "../types/logger.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type { UserPreferences } from "../types/user-preferences.js";

interface OperatorModeLike {
  renderOverview(): Promise<string>;
  createBrowserTask(input: { url: string; intent: string; sourceChannel: string }): { intent: string; mode: string; requiresApproval: boolean };
  renderBrowserTasks(): string;
  parseVoiceConfirmation(text: string): string;
  renderProjectOverview(root?: "workspace" | "authorized_projects" | "authorized_dev"): Promise<string>;
}

export interface OperatorModeDirectServiceDependencies {
  logger: Logger;
  operatorModes: OperatorModeLike;
  buildBaseMessages: (
    userPrompt: string,
    orchestration: OrchestrationContext,
    preferences?: UserPreferences,
  ) => ConversationMessage[];
}

export interface OperatorModeDirectInput {
  userPrompt: string;
  requestId: string;
  orchestration: OrchestrationContext;
  preferences?: UserPreferences;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function extractUrl(prompt: string): string | undefined {
  return prompt.match(/https?:\/\/\S+/i)?.[0];
}

export class OperatorModeDirectService {
  constructor(private readonly deps: OperatorModeDirectServiceDependencies) {}

  async tryRun(input: OperatorModeDirectInput): Promise<AgentRunResult | null> {
    const normalized = normalize(input.userPrompt);
    if (normalized.includes("modo operador")) {
      return {
        requestId: input.requestId,
        reply: await this.deps.operatorModes.renderOverview(),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }
    if (normalized.includes("tarefas de navegador")) {
      return {
        requestId: input.requestId,
        reply: this.deps.operatorModes.renderBrowserTasks(),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }
    if (normalized.includes("tarefa de navegador") || normalized.includes("browser task")) {
      const url = extractUrl(input.userPrompt);
      if (!url) {
        return null;
      }
      const task = this.deps.operatorModes.createBrowserTask({
        url,
        intent: input.userPrompt.replace(url, "").trim() || "revisar página",
        sourceChannel: input.orchestration.route.primaryDomain,
      });
      return {
        requestId: input.requestId,
        reply: `Tarefa de navegador criada: ${task.intent} | modo ${task.mode}${task.requiresApproval ? " | exige aprovação" : ""}.`,
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }
    if (normalized.includes("confirmacao por voz") || normalized.includes("confirmação por voz") || normalized.startsWith("confirmo ")) {
      return {
        requestId: input.requestId,
        reply: this.deps.operatorModes.parseVoiceConfirmation(input.userPrompt),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }
    if (normalized.includes("visao do projeto") || normalized.includes("visão do projeto") || normalized.includes("projeto no modo operador")) {
      return {
        requestId: input.requestId,
        reply: await this.deps.operatorModes.renderProjectOverview(),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }
    return null;
  }
}
