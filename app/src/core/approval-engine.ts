import type { Logger } from "../types/logger.js";
import type { ApprovalInboxItemRecord, ApprovalItemStatus, CreateApprovalInboxItemInput } from "../types/approval-inbox.js";
import type { CapabilityDefinition } from "../types/capability.js";
import { ApprovalInboxStore } from "./approval-inbox.js";
import { ApprovalPolicyService } from "./approval-policy.js";

export interface ApprovalRequestInput extends CreateApprovalInboxItemInput {
  capability?: CapabilityDefinition | null;
}

export interface ApprovalRequestResult {
  approvalRequired: boolean;
  approvalItem?: ApprovalInboxItemRecord;
  status: "approved" | "pending";
  reason: string;
}

export class ApprovalEngine {
  constructor(
    private readonly store: ApprovalInboxStore,
    private readonly policy: ApprovalPolicyService,
    private readonly logger: Logger,
  ) {}

  request(input: ApprovalRequestInput): ApprovalRequestResult {
    const rule = this.policy.resolve({
      actionKind: input.actionKind,
      capability: input.capability,
    });

    if (!rule.requiresApproval) {
      this.logger.info("Approval bypassed by policy", {
        actionKind: input.actionKind,
        subject: input.subject,
        risk: rule.risk,
      });
      return {
        approvalRequired: false,
        status: "approved",
        reason: rule.rationale,
      };
    }

    const approvalItem = this.store.createPending(input);
    this.logger.info("Approval requested", {
      approvalId: approvalItem.id,
      actionKind: approvalItem.actionKind,
      subject: approvalItem.subject,
      risk: rule.risk,
    });
    return {
      approvalRequired: true,
      approvalItem,
      status: "pending",
      reason: rule.rationale,
    };
  }

  getLatestPending(chatId: number): ApprovalInboxItemRecord | null {
    return this.store.getLatestPending(chatId);
  }

  getById(id: number): ApprovalInboxItemRecord | null {
    return this.store.getById(id);
  }

  listPending(chatId: number, limit = 10): ApprovalInboxItemRecord[] {
    return this.store.listPending(chatId, limit);
  }

  listPendingAll(limit = 10): ApprovalInboxItemRecord[] {
    return this.store.listPendingAll(limit);
  }

  updateStatus(id: number, status: ApprovalItemStatus): ApprovalInboxItemRecord | null {
    return this.store.updateStatus(id, status);
  }

  updateDraftPayload(id: number, draftPayload: string): ApprovalInboxItemRecord | null {
    return this.store.updateDraftPayload(id, draftPayload);
  }

  markLatestPending(chatId: number, status: "discarded" | "executed" | "failed" | "superseded"): void {
    const pending = this.store.getLatestPending(chatId);
    if (!pending) {
      return;
    }
    this.store.updateStatus(pending.id, status);
  }
}
