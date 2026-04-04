import { defineToolPlugin } from "../types/plugin.js";

interface SendEmailReplyParameters {
  uid: string;
  body: string;
  subject_override?: string;
  account?: string;
}

export default defineToolPlugin<SendEmailReplyParameters>({
  name: "send_email_reply",
  description:
    "Sends a controlled reply to a previously read email. Use only after the user explicitly confirms they want the email sent.",
  exposeToModel: false,
  parameters: {
    type: "object",
    properties: {
      uid: {
        type: "string",
        description: "Identifier of the original email that will receive the reply.",
      },
      body: {
        type: "string",
        description: "Final plain-text body of the email reply to send.",
      },
      subject_override: {
        type: "string",
        description: "Optional subject override for the reply.",
      },
      account: {
        type: "string",
        description: "Optional email account alias. Defaults to primary.",
      },
    },
    required: ["uid", "body"],
    additionalProperties: false,
  },
  async execute(parameters, context) {
    const account = context.emailAccounts.resolveAlias(parameters.account);
    const reader = context.emailAccounts.getReader(account);
    const writer = context.emailAccounts.getWriter(account);
    const readStatus = await reader.getStatus();
    const deliveryStatus = await writer.getStatus();

    if (!readStatus.ready || !deliveryStatus.ready) {
      return {
        ok: false,
        account,
        status: readStatus,
        delivery: deliveryStatus,
      };
    }

    const original = await reader.readMessage(parameters.uid);
    const replyPermission = writer.getReplyPermission(original);
    if (!replyPermission.allowed) {
      return {
        ok: false,
        account,
        status: readStatus,
        delivery: deliveryStatus,
        original: {
          uid: original.uid,
          subject: original.subject,
          from: original.from,
          replyTo: original.replyTo,
          messageId: original.messageId,
        },
        replyPermission,
      };
    }

    const result = await writer.sendReply(original, parameters.body, {
      subjectOverride: parameters.subject_override,
    });

    return {
      ok: true,
      account,
      status: readStatus,
      delivery: deliveryStatus,
      original: {
        uid: original.uid,
        subject: original.subject,
        from: original.from,
        replyTo: original.replyTo,
        messageId: original.messageId,
      },
      replyPermission,
      sent: result,
    };
  },
});
