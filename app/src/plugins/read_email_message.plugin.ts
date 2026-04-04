import { defineToolPlugin } from "../types/plugin.js";

interface ReadEmailMessageParameters {
  uid: string;
  account?: string;
}

export default defineToolPlugin<ReadEmailMessageParameters>({
  name: "read_email_message",
  description:
    "Reads a single email by UID from the configured inbox in read-only mode and returns the normalized text body.",
  parameters: {
    type: "object",
    properties: {
      uid: {
        type: "string",
        description: "Identifier of the email message to read.",
      },
      account: {
        type: "string",
        description: "Optional email account alias. Defaults to primary.",
      },
    },
    required: ["uid"],
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
      };
    }

    const email = await reader.readMessage(parameters.uid);
    return {
      ok: true,
      account,
      status,
      email,
    };
  },
});
