import type { ApprovalInboxItemRecord, ApprovalItemStatus } from "../types/approval-inbox.js";
import type { Logger } from "../types/logger.js";
import type { ApprovalEngine } from "./approval-engine.js";
import {
  buildPendingActionSubject,
  parsePendingActionDraftPayload,
  type PendingActionDraft,
} from "./draft-action-service.js";

export type DraftApprovalTerminalStatus = Extract<
  ApprovalItemStatus,
  "discarded" | "executed" | "failed" | "superseded"
>;

export interface PersistDraftApprovalInput {
  chatId: number;
  channel: string;
  draft: PendingActionDraft;
}

export interface HydrateDraftApprovalOptions {
  windowMs?: number;
  includeKinds?: PendingActionDraft["kind"][];
  excludeKinds?: PendingActionDraft["kind"][];
  blockIfUpdatedAfter?: number | string | Date;
}

export type LoadApprovalDraftResult =
  | { kind: "not_found" }
  | { kind: "chat_mismatch"; approval: ApprovalInboxItemRecord }
  | { kind: "not_pending"; approval: ApprovalInboxItemRecord }
  | { kind: "invalid_draft"; approval: ApprovalInboxItemRecord }
  | { kind: "ok"; approval: ApprovalInboxItemRecord; draft: PendingActionDraft };

function toTimestamp(value: number | string | Date | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : Number.NaN;
  }
  if (typeof value === "string") {
    return Date.parse(value);
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  return Number.NaN;
}

function matchesDraftKind(
  draft: PendingActionDraft,
  options: Pick<HydrateDraftApprovalOptions, "includeKinds" | "excludeKinds">,
): boolean {
  if (options.includeKinds?.length && !options.includeKinds.includes(draft.kind)) {
    return false;
  }
  if (options.excludeKinds?.length && options.excludeKinds.includes(draft.kind)) {
    return false;
  }
  return true;
}

export class DraftApprovalService {
  private readonly pendingDrafts = new Map<number, PendingActionDraft>();

  constructor(
    private readonly approvals: ApprovalEngine,
    private readonly logger: Logger,
  ) {}

  peek(chatId: number): PendingActionDraft | undefined {
    return this.pendingDrafts.get(chatId);
  }

  has(chatId: number): boolean {
    return this.pendingDrafts.has(chatId);
  }

  remember(chatId: number, draft: PendingActionDraft): PendingActionDraft {
    this.pendingDrafts.set(chatId, draft);
    return draft;
  }

  clear(chatId: number, status?: DraftApprovalTerminalStatus): void {
    this.pendingDrafts.delete(chatId);
    if (status) {
      this.approvals.markLatestPending(chatId, status);
    }
  }

  markLatestPending(chatId: number, status: DraftApprovalTerminalStatus): void {
    this.approvals.markLatestPending(chatId, status);
  }

  persist(input: PersistDraftApprovalInput): ApprovalInboxItemRecord {
    this.remember(input.chatId, input.draft);
    const result = this.approvals.request({
      chatId: input.chatId,
      channel: input.channel,
      actionKind: input.draft.kind,
      subject: buildPendingActionSubject(input.draft),
      draftPayload: JSON.stringify(input.draft),
    });
    if (!result.approvalItem) {
      throw new Error(`Approval request for ${input.draft.kind} was not persisted.`);
    }
    return result.approvalItem;
  }

  listPendingApprovals(chatId: number, limit = 10): ApprovalInboxItemRecord[] {
    return this.approvals.listPending(chatId, limit);
  }

  getApprovalById(id: number): ApprovalInboxItemRecord | null {
    return this.approvals.getById(id);
  }

  updateApprovalStatus(id: number, status: ApprovalItemStatus): ApprovalInboxItemRecord | null {
    return this.approvals.updateStatus(id, status);
  }

  loadApprovalDraft(approvalId: number, options: {
    expectedChatId?: number;
    requirePending?: boolean;
  } = {}): LoadApprovalDraftResult {
    const approval = this.approvals.getById(approvalId);
    if (!approval) {
      return { kind: "not_found" };
    }

    if (options.expectedChatId !== undefined && approval.chatId !== options.expectedChatId) {
      return { kind: "chat_mismatch", approval };
    }

    if (options.requirePending !== false && approval.status !== "pending") {
      return { kind: "not_pending", approval };
    }

    const draft = parsePendingActionDraftPayload(approval.draftPayload);
    if (!draft) {
      return { kind: "invalid_draft", approval };
    }

    return {
      kind: "ok",
      approval,
      draft,
    };
  }

  hydrateLatest(chatId: number, options: HydrateDraftApprovalOptions = {}): PendingActionDraft | undefined {
    const cached = this.pendingDrafts.get(chatId);
    if (cached && matchesDraftKind(cached, options)) {
      return cached;
    }

    const latestApproval = this.approvals.getLatestPending(chatId);
    if (!latestApproval) {
      return undefined;
    }

    const updatedAt = toTimestamp(latestApproval.updatedAt || latestApproval.createdAt);
    if (Number.isFinite(updatedAt) && typeof options.windowMs === "number" && Date.now() - updatedAt > options.windowMs) {
      return undefined;
    }

    const blockedAfter = toTimestamp(options.blockIfUpdatedAfter);
    if (Number.isFinite(updatedAt) && Number.isFinite(blockedAfter) && blockedAfter > updatedAt) {
      return undefined;
    }

    const draft = parsePendingActionDraftPayload(latestApproval.draftPayload);
    if (!draft || !matchesDraftKind(draft, options)) {
      return undefined;
    }

    this.pendingDrafts.set(chatId, draft);
    this.logger.info("Hydrated pending draft from approval inbox", {
      chatId,
      approvalId: latestApproval.id,
      kind: draft.kind,
      channel: latestApproval.channel,
    });
    return draft;
  }
}
