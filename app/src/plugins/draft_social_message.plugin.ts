import { SOCIAL_MESSAGE_INTENTS, SOCIAL_MESSAGE_TONES } from "../types/social-assistant.js";
import { defineToolPlugin } from "../types/plugin.js";

interface DraftSocialMessageParameters {
  recipient_name?: string;
  intent: (typeof SOCIAL_MESSAGE_INTENTS)[number];
  tone?: (typeof SOCIAL_MESSAGE_TONES)[number];
  subject_context: string;
  next_step?: string;
  sign_off?: string;
}

function openingForTone(tone: (typeof SOCIAL_MESSAGE_TONES)[number], recipientName?: string): string {
  const safeName = recipientName?.trim();
  if (tone === "acolhedor") {
    return safeName ? `Olá, ${safeName}. Espero que esteja bem.` : "Olá. Espero que esteja bem.";
  }
  if (tone === "objetivo") {
    return safeName ? `Olá, ${safeName}.` : "Olá.";
  }
  return safeName ? `Prezada(o) ${safeName},` : "Prezada(o),";
}

function bodyForIntent(intent: (typeof SOCIAL_MESSAGE_INTENTS)[number], subjectContext: string, nextStep?: string): string {
  switch (intent) {
    case "encaminhar":
      return `Escrevo para registrar e encaminhar a seguinte demanda: ${subjectContext}.${nextStep ? ` Como proximo passo, ${nextStep}.` : ""}`;
    case "follow_up":
      return `Retomo o contato sobre ${subjectContext}.${nextStep ? ` Proponho como proximo passo ${nextStep}.` : ""}`;
    case "convite":
      return `Gostaria de convidar voce para tratar de ${subjectContext}.${nextStep ? ` Caso seja possivel, ${nextStep}.` : ""}`;
    case "cobranca":
      return `Registro a necessidade de retorno sobre ${subjectContext}.${nextStep ? ` Peço, por gentileza, ${nextStep}.` : ""}`;
    case "informar":
    default:
      return `Escrevo para informar sobre ${subjectContext}.${nextStep ? ` Como encaminhamento, ${nextStep}.` : ""}`;
  }
}

function closingForTone(tone: (typeof SOCIAL_MESSAGE_TONES)[number], signOff?: string): string {
  const signature = signOff?.trim();
  const base = tone === "formal" ? "Atenciosamente," : tone === "acolhedor" ? "Com cuidado e atencao," : "Aguardo retorno,";
  return signature ? `${base}\n${signature}` : base;
}

export default defineToolPlugin<DraftSocialMessageParameters>({
  name: "draft_social_message",
  description:
    "Creates a careful social-work message draft for human review without sending it anywhere.",
  parameters: {
    type: "object",
    properties: {
      recipient_name: { type: "string" },
      intent: { type: "string", enum: [...SOCIAL_MESSAGE_INTENTS] },
      tone: { type: "string", enum: [...SOCIAL_MESSAGE_TONES], default: "formal" },
      subject_context: { type: "string" },
      next_step: { type: "string" },
      sign_off: { type: "string" },
    },
    required: ["intent", "subject_context"],
    additionalProperties: false,
  },
  execute(parameters) {
    const tone = parameters.tone ?? "formal";
    const draft = [
      openingForTone(tone, parameters.recipient_name),
      "",
      bodyForIntent(parameters.intent, parameters.subject_context, parameters.next_step),
      "",
      closingForTone(tone, parameters.sign_off),
    ].join("\n");

    return {
      ok: true,
      draft,
      requires_human_review: true,
      send_allowed: false,
    };
  },
});
