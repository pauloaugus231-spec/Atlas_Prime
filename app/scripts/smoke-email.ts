import { setTimeout as delay } from "node:timers/promises";
import nodemailer from "nodemailer";
import { EmailReaderService } from "../src/integrations/email/email-reader.ts";
import { EmailWriterService } from "../src/integrations/email/email-writer.ts";
import { createLogger } from "../src/utils/logger.ts";
import type { EmailConfig } from "../src/types/config.ts";

interface EtherealAccount {
  user: string;
  pass: string;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
  };
  imap: {
    host: string;
    port: number;
    secure: boolean;
  };
}

function buildEmailConfig(account: EtherealAccount, fromName: string, writeEnabled: boolean): EmailConfig {
  return {
    enabled: true,
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.secure,
    username: account.user,
    password: account.pass,
    mailbox: "INBOX",
    lookbackHours: 24,
    maxMessages: 10,
    maxSourceBytes: 200000,
    maxTextChars: 12000,
    writeEnabled,
    smtpHost: account.smtp.host,
    smtpPort: account.smtp.port,
    smtpSecure: account.smtp.secure,
    smtpUsername: account.user,
    smtpPassword: account.pass,
    fromName,
    fromAddress: account.user,
  };
}

async function waitForMessage(reader: EmailReaderService, matcher: (subject: string) => boolean) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const emails = await reader.listRecentMessages({
      limit: 10,
      unreadOnly: false,
      sinceHours: 24,
    });
    const match = emails.find((email) => matcher(email.subject));
    if (match) {
      return match.uid;
    }
    await delay(1500);
  }

  throw new Error("Timed out while waiting for test email delivery.");
}

async function main() {
  const logger = createLogger("info");
  const sender = (await nodemailer.createTestAccount()) as EtherealAccount;
  const receiver = (await nodemailer.createTestAccount()) as EtherealAccount;

  const senderTransport = nodemailer.createTransport({
    host: sender.smtp.host,
    port: sender.smtp.port,
    secure: sender.smtp.secure,
    auth: {
      user: sender.user,
      pass: sender.pass,
    },
  });

  const receiverReader = new EmailReaderService(
    buildEmailConfig(receiver, "Receiver Bot", true),
    logger.child({ scope: "receiver-reader" }),
  );
  const receiverWriter = new EmailWriterService(
    buildEmailConfig(receiver, "Receiver Bot", true),
    logger.child({ scope: "receiver-writer" }),
  );
  const senderReader = new EmailReaderService(
    buildEmailConfig(sender, "Sender User", false),
    logger.child({ scope: "sender-reader" }),
  );

  const seedSubject = `Projeto SaaS - oportunidade #${Date.now()}`;
  await senderTransport.sendMail({
    from: `Lead Dev <${sender.user}>`,
    to: receiver.user,
    subject: seedSubject,
    text: [
      "Olá,",
      "",
      "Quero saber se você tem interesse em conversar esta semana sobre um micro-SaaS para automação.",
      "Se fizer sentido, me responda com uma proposta objetiva e próximos passos.",
      "",
      "Abraço,",
      "Lead Dev",
    ].join("\n"),
  });
  senderTransport.close();

  const receivedUid = await waitForMessage(receiverReader, (subject) => subject === seedSubject);
  const original = await receiverReader.readMessage(receivedUid);
  const receiverReadStatus = await receiverReader.getStatus();
  const receiverWriteStatus = await receiverWriter.getStatus();

  const reply = [
    "Olá,",
    "",
    "Sim, quero conversar sobre essa oportunidade e entendi o contexto como profissional dev com foco em validação rápida.",
    "Posso te devolver ainda esta semana uma proposta objetiva com escopo inicial, prazo curto e próximos passos para um MVP enxuto.",
    "Se fizer sentido, me envie sua disponibilidade e o principal resultado que você quer acelerar.",
    "",
    "Atenciosamente,",
    "Paulo Augusto",
  ].join("\n");

  const sendResult = await receiverWriter.sendReply(original, reply);
  const replyUid = await waitForMessage(senderReader, (subject) => /^re:/i.test(subject));
  const receivedReply = await senderReader.readMessage(replyUid);

  process.env.EMAIL_ENABLED = "true";
  process.env.OLLAMA_BASE_URL = "http://localhost:11434";
  process.env.EMAIL_IMAP_HOST = receiver.imap.host;
  process.env.EMAIL_IMAP_PORT = String(receiver.imap.port);
  process.env.EMAIL_IMAP_SECURE = String(receiver.imap.secure);
  process.env.EMAIL_IMAP_USERNAME = receiver.user;
  process.env.EMAIL_IMAP_PASSWORD = receiver.pass;
  process.env.EMAIL_IMAP_MAILBOX = "INBOX";
  process.env.EMAIL_LOOKBACK_HOURS = "24";
  process.env.EMAIL_MAX_MESSAGES = "10";
  process.env.EMAIL_MAX_SOURCE_BYTES = "200000";
  process.env.EMAIL_MAX_TEXT_CHARS = "12000";
  process.env.EMAIL_WRITE_ENABLED = "true";
  process.env.EMAIL_SMTP_HOST = receiver.smtp.host;
  process.env.EMAIL_SMTP_PORT = String(receiver.smtp.port);
  process.env.EMAIL_SMTP_SECURE = String(receiver.smtp.secure);
  process.env.EMAIL_SMTP_USERNAME = receiver.user;
  process.env.EMAIL_SMTP_PASSWORD = receiver.pass;
  process.env.EMAIL_FROM_NAME = "Receiver Bot";
  process.env.EMAIL_FROM_ADDRESS = receiver.user;

  const { createAgentCore } = await import("../src/core/create-agent-core.ts");
  const { core } = await createAgentCore();
  const draftResult = await core.runUserPrompt(
    [
      "Contexto do Telegram:",
      "chat_type=private",
      "chat_id=999",
      "user_id=999",
      "",
      "Mensagem atual do usuário:",
      `Leia o email UID ${receivedUid}, considere o contexto profissional dev e redija uma resposta elegante dizendo que sim, quero conversar, mas não envie ainda.`,
    ].join("\n"),
  );

  console.log(
    JSON.stringify(
      {
        receiverReadStatus,
        receiverWriteStatus,
        original: {
          uid: original.uid,
          subject: original.subject,
          from: original.from,
          textPreview: original.text.slice(0, 200),
        },
        sendResult: {
          subject: sendResult.subject,
          to: sendResult.to,
          messageId: sendResult.messageId,
        },
        receivedReply: {
          uid: receivedReply.uid,
          subject: receivedReply.subject,
          from: receivedReply.from,
          textPreview: receivedReply.text.slice(0, 240),
        },
        coreDraftReply: draftResult.reply,
        coreDraftToolExecutions: draftResult.toolExecutions,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
