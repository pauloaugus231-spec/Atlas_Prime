import { randomUUID } from "node:crypto";
import type { ApprovalInboxItemRecord } from "../../../types/approval-inbox.js";
import type { AutonomyCollector, AutonomyCollectorInput, AutonomyObservation } from "../../../types/autonomy.js";

interface ApprovalReader {
  listPendingAll(limit?: number): ApprovalInboxItemRecord[];
}

function sourceKindFromChannel(channel: string): AutonomyObservation["sourceKind"] {
  if (channel === "telegram") {
    return "telegram";
  }
  if (channel === "whatsapp") {
    return "whatsapp";
  }
  if (channel === "email") {
    return "email";
  }
  return "system";
}

export class ApprovalCollector implements AutonomyCollector {
  readonly name = "approval-inbox";

  constructor(private readonly approvals: ApprovalReader) {}

  collect(input: AutonomyCollectorInput): AutonomyObservation[] {
    return this.approvals.listPendingAll(10).map((item) => ({
      id: randomUUID(),
      fingerprint: `approval_waiting:item:${item.id}`,
      kind: "approval_waiting",
      sourceKind: sourceKindFromChannel(item.channel),
      sourceId: String(item.id),
      sourceTrust: "owned_account",
      title: `Aprovação pendente: ${item.subject}`,
      summary: `Ação ${item.actionKind} ainda aguarda aprovação no canal ${item.channel}.`,
      evidence: [`approval:${item.id}`, `action:${item.actionKind}`, `channel:${item.channel}`],
      observedAt: input.now,
    }));
  }
}
