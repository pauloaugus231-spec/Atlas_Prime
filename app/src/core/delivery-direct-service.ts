import type { AgentRunResult } from "./agent-core.js";
import type { ConversationMessage } from "../types/llm.js";
import type { Logger } from "../types/logger.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type { UserPreferences } from "../types/user-preferences.js";
import type { DeliveryChannel, PreparedDeliveryMessage } from "../types/delivery-message.js";

interface ChannelDeliveryLike {
  prepareBriefing(input?: { profileId?: string; prompt?: string; channelOverride?: DeliveryChannel }): Promise<PreparedDeliveryMessage>;
  renderChannelStatus(): string;
}

export interface DeliveryDirectServiceDependencies {
  logger: Logger;
  delivery: ChannelDeliveryLike;
  buildBaseMessages: (
    userPrompt: string,
    orchestration: OrchestrationContext,
    preferences?: UserPreferences,
  ) => ConversationMessage[];
}

export interface DeliveryDirectInput {
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

function detectChannel(prompt: string): DeliveryChannel | undefined {
  const normalized = normalize(prompt);
  if (normalized.includes("whatsapp")) return "whatsapp";
  if (normalized.includes("email") || normalized.includes("e-mail")) return "email";
  if (normalized.includes("web")) return "web";
  if (normalized.includes("telegram")) return "telegram";
  return undefined;
}

function buildPreparedReply(prepared: PreparedDeliveryMessage): string {
  return [
    `Entrega preparada: ${prepared.profileName}`,
    `- Canal: ${prepared.channel}`,
    `- Disposição: ${prepared.disposition}`,
    `- Aprovação: ${prepared.requiresApproval ? "sim" : "não"}`,
    `- Destinatários: ${prepared.recipients.join(", ")}`,
    ...(prepared.subject ? [`- Assunto: ${prepared.subject}`] : []),
    ...(prepared.reason ? [`- Motivo/política: ${prepared.reason}`] : []),
    "",
    prepared.body,
  ].join("\n");
}

export class DeliveryDirectService {
  constructor(private readonly deps: DeliveryDirectServiceDependencies) {}

  async tryRun(input: DeliveryDirectInput): Promise<AgentRunResult | null> {
    const normalized = normalize(input.userPrompt);
    if (normalized.includes("canais de entrega") || normalized.includes("status de entrega") || normalized.includes("multicanal")) {
      return {
        requestId: input.requestId,
        reply: this.deps.delivery.renderChannelStatus(),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const wantsPreview = normalized.includes("previa do briefing")
      || normalized.includes("prévia do briefing")
      || normalized.includes("como ficaria o briefing")
      || normalized.includes("entregue o briefing")
      || normalized.includes("briefing por ");
    if (!wantsPreview) {
      return null;
    }

    const prepared = await this.deps.delivery.prepareBriefing({
      prompt: input.userPrompt,
      channelOverride: detectChannel(input.userPrompt),
    });
    return {
      requestId: input.requestId,
      reply: buildPreparedReply(prepared),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [],
    };
  }
}
