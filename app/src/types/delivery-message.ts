import type { BriefingAudience, BriefingDeliveryChannel } from "./briefing-profile.js";

export type DeliveryChannel = BriefingDeliveryChannel | "web";
export type DeliveryDisposition = "ready" | "draft_only" | "preview_only" | "blocked";

export interface PreparedDeliveryMessage {
  profileId: string;
  profileName: string;
  channel: DeliveryChannel;
  audience: BriefingAudience;
  recipients: string[];
  subject?: string;
  body: string;
  disposition: DeliveryDisposition;
  requiresApproval: boolean;
  reason?: string;
  createdAt: string;
}

export interface DeliveryAuditRecord {
  id: number;
  profileId: string;
  channel: DeliveryChannel;
  audience: BriefingAudience;
  disposition: DeliveryDisposition;
  recipientCount: number;
  status: "prepared" | "delivered" | "blocked" | "drafted" | "previewed";
  subject?: string;
  createdAt: string;
  metadata?: Record<string, string>;
}
