import type { BriefingProfileService } from "../briefing-profile-service.js";
import { DeliveryPolicy } from "./delivery-policy.js";
import { DeliveryAuditStore } from "./delivery-audit-store.js";
import { EmailBriefRenderer } from "./channel-renderers/email-brief-renderer.js";
import { TelegramBriefRenderer } from "./channel-renderers/telegram-brief-renderer.js";
import { WebBriefRenderer } from "./channel-renderers/web-brief-renderer.js";
import { WhatsAppBriefRenderer } from "./channel-renderers/whatsapp-brief-renderer.js";
import type { PreparedDeliveryMessage, DeliveryChannel } from "../../types/delivery-message.js";
import type { Logger } from "../../types/logger.js";

export class ChannelDeliveryService {
  private readonly policy = new DeliveryPolicy();
  private readonly telegramRenderer = new TelegramBriefRenderer();
  private readonly emailRenderer = new EmailBriefRenderer();
  private readonly whatsappRenderer = new WhatsAppBriefRenderer();
  private readonly webRenderer = new WebBriefRenderer();

  constructor(
    private readonly briefingProfiles: BriefingProfileService,
    private readonly audit: DeliveryAuditStore,
    private readonly logger: Logger,
  ) {}

  async prepareBriefing(input?: {
    profileId?: string;
    prompt?: string;
    channelOverride?: DeliveryChannel;
  }): Promise<PreparedDeliveryMessage> {
    const rendered = await this.briefingProfiles.render({
      ...(input?.profileId ? { profileId: input.profileId } : {}),
      ...(input?.prompt ? { prompt: input.prompt } : {}),
    });
    const channel = input?.channelOverride ?? rendered.profile.deliveryChannel;
    const recipients = rendered.profile.audience === "team"
      ? rendered.profile.targetRecipientIds.filter(Boolean)
      : ["self"];
    const decision = this.policy.decide({
      channel,
      audience: rendered.profile.audience,
      recipientCount: recipients.filter((item) => item !== "self").length,
    });

    let subject: string | undefined;
    let body: string;
    if (channel === "telegram") {
      body = this.telegramRenderer.render(rendered.reply);
    } else if (channel === "email") {
      const email = this.emailRenderer.render(rendered.profile.name, rendered.reply);
      subject = email.subject;
      body = email.body;
    } else if (channel === "whatsapp") {
      body = this.whatsappRenderer.render(rendered.reply);
    } else {
      body = this.webRenderer.render(rendered.profile.name, rendered.reply);
    }

    const prepared: PreparedDeliveryMessage = {
      profileId: rendered.profile.id,
      profileName: rendered.profile.name,
      channel,
      audience: rendered.profile.audience,
      recipients,
      ...(subject ? { subject } : {}),
      body,
      disposition: decision.disposition,
      requiresApproval: decision.requiresApproval,
      ...(decision.reason ? { reason: decision.reason } : {}),
      createdAt: new Date().toISOString(),
    };

    this.audit.record({
      profileId: prepared.profileId,
      channel: prepared.channel,
      audience: prepared.audience,
      disposition: prepared.disposition,
      recipientCount: prepared.recipients.filter((item) => item !== "self").length,
      status: prepared.disposition === "ready" ? "prepared" : prepared.disposition === "blocked" ? "blocked" : prepared.disposition === "draft_only" ? "drafted" : "previewed",
      ...(prepared.subject ? { subject: prepared.subject } : {}),
      metadata: prepared.reason ? { reason: prepared.reason } : undefined,
    });

    this.logger.debug("Prepared delivery message", {
      profileId: prepared.profileId,
      channel: prepared.channel,
      disposition: prepared.disposition,
      requiresApproval: prepared.requiresApproval,
    });
    return prepared;
  }

  listRecentAudits(limit = 20) {
    return this.audit.listRecent(limit);
  }

  renderChannelStatus(): string {
    const recent = this.audit.listRecent(6);
    return [
      "Entrega multicanal:",
      "- Telegram: pronto para entrega automática controlada.",
      "- Email: rascunho/aprovação forte.",
      "- WhatsApp: rascunho controlado.",
      "- Web: prévia local.",
      ...recent.map((item) => `- ${item.channel} | ${item.status} | ${item.disposition}`),
    ].join("\n");
  }
}
