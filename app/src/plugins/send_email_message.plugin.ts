import { defineToolPlugin } from "../types/plugin.js";

interface SendEmailMessageParameters {
  to: string[];
  subject: string;
  body: string;
  account?: string;
}

export default defineToolPlugin<SendEmailMessageParameters>({
  name: "send_email_message",
  description:
    "Sends a controlled plain-text email message to explicit recipients. Use only for deliberate user-approved sends.",
  exposeToModel: false,
  parameters: {
    type: "object",
    properties: {
      to: {
        type: "array",
        items: {
          type: "string",
        },
        minItems: 1,
        description: "Explicit recipient email addresses.",
      },
      subject: {
        type: "string",
        description: "Subject line for the email message.",
      },
      body: {
        type: "string",
        description: "Final plain-text body of the email message.",
      },
      account: {
        type: "string",
        description: "Optional email account alias. Defaults to primary.",
      },
    },
    required: ["to", "subject", "body"],
    additionalProperties: false,
  },
  async execute(parameters, context) {
    const account = context.emailAccounts.resolveAlias(parameters.account);
    const writer = context.emailAccounts.getWriter(account);
    const deliveryStatus = await writer.getStatus();
    if (!deliveryStatus.ready) {
      return {
        ok: false,
        account,
        delivery: deliveryStatus,
      };
    }

    const sent = await writer.sendMessage({
      to: parameters.to,
      subject: parameters.subject,
      body: parameters.body,
    });

    return {
      ok: true,
      account,
      delivery: deliveryStatus,
      sent,
    };
  },
});
