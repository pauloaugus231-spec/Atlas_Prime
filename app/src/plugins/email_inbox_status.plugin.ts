import { defineToolPlugin } from "../types/plugin.js";

interface EmailInboxStatusParameters {
  account?: string;
}

export default defineToolPlugin<EmailInboxStatusParameters>({
  name: "email_inbox_status",
  description:
    "Checks whether email reading and controlled email delivery are configured and returns the current status.",
  parameters: {
    type: "object",
    properties: {
      account: {
        type: "string",
        description: "Optional email account alias. Defaults to primary.",
      },
    },
    additionalProperties: false,
  },
  async execute(parameters, context) {
    const account = context.emailAccounts.resolveAlias(parameters.account);
    const reader = context.emailAccounts.getReader(account);
    const writer = context.emailAccounts.getWriter(account);
    const status = await reader.getStatus();
    const delivery = await writer.getStatus();
    return {
      ok: status.ready,
      account,
      accounts: context.emailAccounts.getAliases(),
      status,
      delivery,
    };
  },
});
