import type { BriefingAudience } from "../../types/briefing-profile.js";
import type { DeliveryChannel, DeliveryDisposition } from "../../types/delivery-message.js";

export interface DeliveryPolicyDecision {
  disposition: DeliveryDisposition;
  requiresApproval: boolean;
  reason?: string;
}

export class DeliveryPolicy {
  decide(input: {
    channel: DeliveryChannel;
    audience: BriefingAudience;
    recipientCount: number;
  }): DeliveryPolicyDecision {
    if (input.channel === "web") {
      return {
        disposition: "preview_only",
        requiresApproval: false,
        reason: "Canal web fica em modo de prévia local.",
      };
    }

    if (input.channel === "telegram") {
      if (input.audience === "team" && input.recipientCount === 0) {
        return {
          disposition: "blocked",
          requiresApproval: false,
          reason: "Briefing de equipe no Telegram exige destinatários configurados.",
        };
      }
      return {
        disposition: "ready",
        requiresApproval: false,
      };
    }

    if (input.channel === "email") {
      return {
        disposition: input.recipientCount > 0 ? "draft_only" : "preview_only",
        requiresApproval: true,
        reason: "Email segue em modo rascunho/aprovação forte.",
      };
    }

    return {
      disposition: input.recipientCount > 0 ? "draft_only" : "preview_only",
      requiresApproval: true,
      reason: "WhatsApp segue em modo controlado com aprovação humana.",
    };
  }
}
