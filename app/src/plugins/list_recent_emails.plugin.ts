import { defineToolPlugin } from "../types/plugin.js";

interface ListRecentEmailsParameters {
  account?: string;
  limit?: number;
  unread_only?: boolean;
  since_hours?: number;
}

export default defineToolPlugin<ListRecentEmailsParameters>({
  name: "list_recent_emails",
  description:
    "Lists recent emails from the configured inbox in read-only mode, including sender, subject and preview.",
  parameters: {
    type: "object",
    properties: {
      limit: {
        type: "integer",
        description: "Maximum number of emails to fetch.",
        default: 10,
      },
      account: {
        type: "string",
        description: "Optional email account alias. Defaults to primary.",
      },
      unread_only: {
        type: "boolean",
        description: "Whether only unread emails should be listed.",
        default: true,
      },
      since_hours: {
        type: "integer",
        description: "Lookback window in hours.",
        default: 72,
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
        emails: [],
      };
    }

    const emails = await reader.listRecentMessages({
      limit: parameters.limit,
      unreadOnly: parameters.unread_only,
      sinceHours: parameters.since_hours,
    });

    return {
      ok: true,
      account,
      status,
      total: emails.length,
      emails,
    };
  },
});
