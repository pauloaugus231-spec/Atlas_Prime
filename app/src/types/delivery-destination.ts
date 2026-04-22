import type { BriefingDeliveryChannel } from "./briefing-profile.js";

export type DeliveryDestinationKind = "telegram_chat" | "whatsapp_chat" | "email_recipient";
export type DeliveryDestinationAudience = "self" | "team" | "external";
export type DeliveryDestinationPrivacyLevel = "private" | "team_shareable" | "restricted" | "public";

export interface DeliveryDestination {
  id: string;
  userId: string;
  label: string;
  aliases: string[];
  kind: DeliveryDestinationKind;
  channel: BriefingDeliveryChannel;
  address: string;
  audience: DeliveryDestinationAudience;
  maxPrivacyLevel: DeliveryDestinationPrivacyLevel;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
