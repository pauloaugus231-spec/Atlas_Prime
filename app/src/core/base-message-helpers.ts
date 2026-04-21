import type { ConversationMessage } from "../types/llm.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type { UserPreferences } from "../types/user-preferences.js";
import { buildOrchestrationSystemMessage } from "./orchestration.js";
import { buildSystemPrompt } from "./system-prompt.js";

export function buildBaseMessages(
  userPrompt: string,
  orchestration: OrchestrationContext,
  preferences?: UserPreferences,
): ConversationMessage[] {
  return [
    {
      role: "system",
      content: buildSystemPrompt(),
    },
    {
      role: "system",
      content: buildOrchestrationSystemMessage(orchestration),
    },
    ...(preferences
      ? [
          {
            role: "system" as const,
            content: [
              `Preferências atuais do usuário:`,
              `- estilo de resposta: ${preferences.responseStyle}`,
              `- tamanho preferido: ${preferences.responseLength}`,
              `- sugerir próxima ação: ${preferences.proactiveNextStep ? "sim" : "não"}`,
              `- nome preferido do agente: ${preferences.preferredAgentName}`,
            ].join("\n"),
          },
        ]
      : []),
    {
      role: "user",
      content: userPrompt,
    },
  ];
}
