import { defineToolPlugin } from "../types/plugin.js";
import { summarizeEmailForOperations } from "../integrations/email/email-analysis.js";

interface TriageInboxParameters {
  account?: string;
  limit?: number;
  unread_only?: boolean;
  since_hours?: number;
}

export default defineToolPlugin<TriageInboxParameters>({
  name: "triage_inbox",
  description:
    "Classifies recent inbox emails by category and priority, returning an operational triage list.",
  parameters: {
    type: "object",
    properties: {
      limit: {
        type: "integer",
        description: "Maximum number of emails to analyze.",
        default: 10,
        minimum: 1,
        maximum: 20,
      },
      account: {
        type: "string",
        description: "Optional email account alias. Defaults to primary.",
      },
      unread_only: {
        type: "boolean",
        description: "Whether to analyze only unread emails.",
        default: true,
      },
      since_hours: {
        type: "integer",
        description: "Lookback window in hours.",
        default: 168,
        minimum: 1,
        maximum: 720,
      },
    },
    additionalProperties: false,
  },
  async execute(parameters, context) {
    const account = context.emailAccounts.resolveAlias(parameters.account);
    const reader = context.emailAccounts.getReader(account);
    const status = await reader.getStatus();
    if (!status.ready) {
      return {
        ok: false,
        account,
        status,
        items: [],
      };
    }

    const emails = await reader.listRecentMessages({
      limit: parameters.limit,
      unreadOnly: parameters.unread_only,
      sinceHours: parameters.since_hours,
    });
    const weight = { alta: 0, media: 1, baixa: 2 } as const;
    const items = emails
      .map((email) => {
        const triage = summarizeEmailForOperations({
          subject: email.subject,
          from: email.from,
          text: email.preview,
        });
        return {
          uid: email.uid,
          date: email.date,
          subject: email.subject,
          from: email.from,
          category: triage.category,
          priority: triage.priority,
          status: triage.status,
          action: triage.action,
        };
      })
      .sort((left, right) => {
        const delta = weight[left.priority as keyof typeof weight] - weight[right.priority as keyof typeof weight];
        if (delta !== 0) {
          return delta;
        }
        return (right.date ?? "").localeCompare(left.date ?? "");
      });

    return {
      ok: true,
      account,
      status,
      total: items.length,
      items,
    };
  },
});
