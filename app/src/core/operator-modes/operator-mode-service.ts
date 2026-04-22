import { BrowserPolicy } from "./browser-policy.js";
import { BrowserTaskStore } from "./browser-task-store.js";
import { VoiceActionConfirmationService } from "./voice-action-confirmation.js";
import type { Logger } from "../../types/logger.js";
import type { ReadableRootKey } from "../file-access-policy.js";

interface SafeExecLike {
  getStatus(): Record<string, unknown>;
}

interface ProjectOpsLike {
  scanProject(input: { root: ReadableRootKey; path?: string }): Promise<Record<string, unknown>>;
}

export class OperatorModeService {
  private readonly browserPolicy = new BrowserPolicy();
  private readonly voiceConfirmations = new VoiceActionConfirmationService();

  constructor(
    private readonly browserTasks: BrowserTaskStore,
    private readonly safeExec: SafeExecLike,
    private readonly projectOps: ProjectOpsLike,
    private readonly logger: Logger,
  ) {}

  async renderOverview(): Promise<string> {
    const safeExecStatus = this.safeExec.getStatus();
    const tasks = this.browserTasks.list(5);
    return [
      "Modo operador:",
      `- Safe exec: ${safeExecStatus.enabled ? "ativo" : "desativado"}`,
      `- Browser tasks abertas: ${tasks.length}`,
      "- Voz: confirmações curtas prontas para interpretar.",
      ...tasks.slice(0, 3).map((item) => `- Browser: ${item.intent} | ${item.mode} | ${item.status}`),
    ].join("\n");
  }

  createBrowserTask(input: { url: string; intent: string; sourceChannel: string }) {
    const policy = this.browserPolicy.classify(input.intent);
    return this.browserTasks.create({
      url: input.url,
      intent: input.intent,
      mode: policy.mode,
      requiresApproval: policy.requiresApproval,
      sourceChannel: input.sourceChannel,
    });
  }

  renderBrowserTasks(): string {
    const tasks = this.browserTasks.list(10);
    if (tasks.length === 0) {
      return "Nenhuma tarefa de navegador foi preparada ainda.";
    }
    return [
      "Tarefas de navegador:",
      ...tasks.map((item) => `- ${item.intent} | ${item.mode} | ${item.status}${item.requiresApproval ? " | exige aprovação" : ""}`),
    ].join("\n");
  }

  parseVoiceConfirmation(text: string): string {
    const parsed = this.voiceConfirmations.parse(text);
    if (parsed.decision === "unknown") {
      return "Não identifiquei uma confirmação de voz operacional clara nesse texto.";
    }
    if (parsed.decision === "cancel") {
      return "Confirmação de voz interpretada como cancelamento da ação pendente.";
    }
    return `Confirmação de voz interpretada como aprovação para ${parsed.action ?? "continuar"}.`;
  }

  async renderProjectOverview(root: ReadableRootKey = "workspace"): Promise<string> {
    const project = await this.projectOps.scanProject({ root, path: "." });
    return [
      "Projeto no modo operador:",
      `- Nome: ${String(project.project_name ?? "desconhecido")}`,
      `- Tipos: ${Array.isArray(project.project_types) ? project.project_types.join(", ") : "n/d"}`,
      `- Caminho: ${String(project.absolute_path ?? "n/d")}`,
    ].join("\n");
  }
}
