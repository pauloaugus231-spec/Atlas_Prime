import type { ApprovalInboxItemRecord } from "../types/approval-inbox.js";
import type { ContactProfileRecord } from "../types/contact-intelligence.js";
import type { MemoryEntityRecord } from "../types/memory-entities.js";
import type { WorkflowPlanRecord } from "../types/workflow.js";
import { MemoryEntityStore } from "./memory-entity-store.js";

function compactState<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

export class EntityLinker {
  constructor(private readonly entities: MemoryEntityStore) {}

  upsertApproval(item: ApprovalInboxItemRecord): MemoryEntityRecord {
    return this.entities.upsert({
      id: `approval:${item.id}`,
      kind: "approval",
      title: item.subject,
      tags: [item.channel, item.actionKind, item.status],
      state: compactState({
        approvalId: item.id,
        chatId: item.chatId,
        channel: item.channel,
        actionKind: item.actionKind,
        subject: item.subject,
        draftPayload: item.draftPayload,
        status: item.status,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }),
    });
  }

  upsertWorkflowRun(plan: WorkflowPlanRecord, lastEvent?: string | null): MemoryEntityRecord {
    return this.entities.upsert({
      id: `workflow_run:${plan.id}`,
      kind: "workflow_run",
      title: plan.title,
      tags: [
        "workflow",
        plan.primaryDomain,
        plan.status,
        ...plan.secondaryDomains.slice(0, 3),
      ],
      state: compactState({
        workflowId: plan.id,
        objective: plan.objective,
        executiveSummary: plan.executiveSummary,
        status: plan.status,
        primaryDomain: plan.primaryDomain,
        secondaryDomains: plan.secondaryDomains,
        deliverables: plan.deliverables,
        nextAction: plan.nextAction,
        stepCount: plan.steps.length,
        steps: plan.steps.map((step) => ({
          stepNumber: step.stepNumber,
          title: step.title,
          status: step.status,
          ownerDomain: step.ownerDomain,
        })),
        lastEvent: lastEvent?.trim() || undefined,
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt,
      }),
    });
  }

  upsertContact(contact: ContactProfileRecord): MemoryEntityRecord {
    return this.entities.upsert({
      id: `contact:${contact.channel}:${contact.identifier}`,
      kind: "contact",
      title: contact.displayName?.trim() || contact.identifier,
      tags: [
        contact.channel,
        contact.relationship,
        contact.persona,
        contact.priority,
        ...(contact.tags ?? []).slice(0, 6),
      ],
      state: compactState({
        contactId: contact.id,
        channel: contact.channel,
        identifier: contact.identifier,
        displayName: contact.displayName,
        relationship: contact.relationship,
        persona: contact.persona,
        priority: contact.priority,
        company: contact.company,
        preferredTone: contact.preferredTone,
        notes: contact.notes,
        source: contact.source,
        createdAt: contact.createdAt,
        updatedAt: contact.updatedAt,
      }),
    });
  }
}
