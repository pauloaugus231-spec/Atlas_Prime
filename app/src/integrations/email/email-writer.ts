import nodemailer from "nodemailer";
import type { SentMessageInfo } from "nodemailer";
import type { EmailConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";
import type { EmailMessageContent } from "./email-reader.js";

export interface EmailDeliveryStatus {
  enabled: boolean;
  configured: boolean;
  ready: boolean;
  host?: string;
  username?: string;
  fromAddress?: string;
  replyAllowlistConfigured?: boolean;
  replyAllowedSenders?: string[];
  replyAllowedDomains?: string[];
  message: string;
}

export interface EmailSendResult {
  ok: true;
  subject: string;
  to: string[];
  messageId: string;
  envelope: {
    from?: string;
    to?: string[];
  };
  accepted: string[];
  rejected: string[];
  response: string;
}

export interface EmailMessageSendInput {
  to: string[];
  subject: string;
  body: string;
}

export interface ReplyPermissionStatus {
  allowed: boolean;
  recipients: string[];
  policyConfigured: boolean;
  reason?: string;
}

export interface EmailWriter {
  getStatus(): Promise<EmailDeliveryStatus>;
  sendReply(
    original: EmailMessageContent,
    body: string,
    input?: {
      subjectOverride?: string;
    },
  ): Promise<EmailSendResult>;
  sendMessage(input: EmailMessageSendInput): Promise<EmailSendResult>;
  getReplyPermission(original: EmailMessageContent): ReplyPermissionStatus;
}

function normalizeReplySubject(subject: string): string {
  const trimmed = subject.trim() || "(sem assunto)";
  if (/^re\s*:/i.test(trimmed)) {
    return trimmed;
  }
  return `Re: ${trimmed}`;
}

function normalizeResponseList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => String(value).trim())
    .filter(Boolean);
}

function buildFromHeader(fromName: string | undefined, fromAddress: string): string {
  const name = fromName?.trim();
  if (!name) {
    return fromAddress;
  }
  return `${name} <${fromAddress}>`;
}

function extractEmailAddress(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const bracketMatch = trimmed.match(/<([^>]+)>/);
  const candidate = bracketMatch?.[1]?.trim() || trimmed;
  return candidate.includes("@") ? candidate.toLowerCase() : undefined;
}

function extractDomain(value: string): string | undefined {
  const address = extractEmailAddress(value);
  if (!address) {
    return undefined;
  }

  const [, domain] = address.split("@");
  return domain?.toLowerCase();
}

export class EmailWriterService implements EmailWriter {
  constructor(
    private readonly config: EmailConfig,
    private readonly logger: Logger,
  ) {}

  async getStatus(): Promise<EmailDeliveryStatus> {
    if (!this.config.writeEnabled) {
      return {
        enabled: false,
        configured: false,
        ready: false,
        host: this.config.smtpHost,
        username: this.config.smtpUsername,
        fromAddress: this.config.fromAddress,
        replyAllowlistConfigured:
          this.config.replyAllowedSenders.length > 0 || this.config.replyAllowedDomains.length > 0,
        replyAllowedSenders: this.config.replyAllowedSenders,
        replyAllowedDomains: this.config.replyAllowedDomains,
        message: "Email delivery is disabled. Set EMAIL_WRITE_ENABLED=true to enable SMTP sending.",
      };
    }

    if (!this.isConfigured()) {
      return {
        enabled: true,
        configured: false,
        ready: false,
        host: this.config.smtpHost,
        username: this.config.smtpUsername,
        fromAddress: this.config.fromAddress,
        replyAllowlistConfigured:
          this.config.replyAllowedSenders.length > 0 || this.config.replyAllowedDomains.length > 0,
        replyAllowedSenders: this.config.replyAllowedSenders,
        replyAllowedDomains: this.config.replyAllowedDomains,
        message:
          "Email delivery is enabled but incomplete. Configure EMAIL_SMTP_HOST, EMAIL_SMTP_USERNAME, EMAIL_SMTP_PASSWORD and EMAIL_FROM_ADDRESS.",
      };
    }

    return this.withTransport(async (transport) => {
      await transport.verify();
      return {
        enabled: true,
        configured: true,
        ready: true,
        host: this.config.smtpHost,
        username: this.config.smtpUsername,
        fromAddress: this.config.fromAddress,
        replyAllowlistConfigured:
          this.config.replyAllowedSenders.length > 0 || this.config.replyAllowedDomains.length > 0,
        replyAllowedSenders: this.config.replyAllowedSenders,
        replyAllowedDomains: this.config.replyAllowedDomains,
        message: "Email delivery ready in controlled send mode.",
      } satisfies EmailDeliveryStatus;
    });
  }

  async sendReply(
    original: EmailMessageContent,
    body: string,
    input?: {
      subjectOverride?: string;
    },
  ): Promise<EmailSendResult> {
    this.assertConfigured();
    const trimmedBody = body.trim();
    if (!trimmedBody) {
      throw new Error("Reply body is required to send an email reply.");
    }

    const recipients = original.replyTo.length > 0 ? original.replyTo : original.from;
    if (!recipients.length) {
      throw new Error(`Unable to resolve reply recipient for email UID ${original.uid}.`);
    }
    const permission = this.getReplyPermission(original);
    if (!permission.allowed) {
      throw new Error(permission.reason ?? "Reply recipient is not allowed by the configured allowlist.");
    }

    const subject = normalizeReplySubject(input?.subjectOverride ?? original.subject);
    const references = [...original.references];
    if (original.messageId && !references.includes(original.messageId)) {
      references.push(original.messageId);
    }

    return this.withTransport(async (transport) => {
      const result = await transport.sendMail({
        from: buildFromHeader(this.config.fromName, this.config.fromAddress!),
        to: recipients,
        subject,
        text: trimmedBody,
        inReplyTo: original.messageId ?? undefined,
        references: references.length > 0 ? references : undefined,
        headers: {
          "X-Agent-Origin": "agente-ai-local",
        },
      });

      this.logger.info("Email reply sent", {
        uid: original.uid,
        to: recipients,
        subject,
        messageId: result.messageId,
      });

      return this.normalizeSendResult(result, subject, recipients);
    });
  }

  async sendMessage(input: EmailMessageSendInput): Promise<EmailSendResult> {
    this.assertConfigured();
    const recipients = input.to.map((value) => value.trim()).filter(Boolean);
    const subject = input.subject.trim();
    const body = input.body.trim();

    if (recipients.length === 0) {
      throw new Error("At least one recipient is required to send an email message.");
    }

    if (!subject) {
      throw new Error("Email subject is required.");
    }

    if (!body) {
      throw new Error("Email body is required.");
    }

    return this.withTransport(async (transport) => {
      const result = await transport.sendMail({
        from: buildFromHeader(this.config.fromName, this.config.fromAddress!),
        to: recipients,
        subject,
        text: body,
        headers: {
          "X-Agent-Origin": "agente-ai-local",
        },
      });

      this.logger.info("Email message sent", {
        to: recipients,
        subject,
        messageId: result.messageId,
      });

      return this.normalizeSendResult(result, subject, recipients);
    });
  }

  getReplyPermission(original: EmailMessageContent): ReplyPermissionStatus {
    const recipients = (original.replyTo.length > 0 ? original.replyTo : original.from)
      .map((value) => extractEmailAddress(value))
      .filter((value): value is string => Boolean(value));
    const policyConfigured =
      this.config.replyAllowedSenders.length > 0 || this.config.replyAllowedDomains.length > 0;

    if (!policyConfigured) {
      return {
        allowed: true,
        recipients,
        policyConfigured: false,
      };
    }

    if (recipients.length === 0) {
      return {
        allowed: false,
        recipients,
        policyConfigured: true,
        reason: "Reply recipient could not be resolved for allowlist validation.",
      };
    }

    const allowed = recipients.every((recipient) => {
      const domain = extractDomain(recipient);
      return (
        this.config.replyAllowedSenders.includes(recipient) ||
        (domain ? this.config.replyAllowedDomains.includes(domain) : false)
      );
    });

    return {
      allowed,
      recipients,
      policyConfigured: true,
      reason: allowed
        ? undefined
        : `Reply blocked by allowlist. Recipients: ${recipients.join(", ")}.`,
    };
  }

  private isConfigured(): boolean {
    return Boolean(
      this.config.smtpHost &&
        this.config.smtpUsername &&
        this.config.smtpPassword &&
        this.config.fromAddress,
    );
  }

  private assertConfigured(): void {
    if (!this.config.writeEnabled) {
      throw new Error("Email delivery is disabled. Set EMAIL_WRITE_ENABLED=true to enable sending.");
    }

    if (!this.isConfigured()) {
      throw new Error(
        "Email delivery is not fully configured. Set EMAIL_SMTP_HOST, EMAIL_SMTP_USERNAME, EMAIL_SMTP_PASSWORD and EMAIL_FROM_ADDRESS.",
      );
    }
  }

  private async withTransport<T>(fn: (transport: nodemailer.Transporter) => Promise<T>): Promise<T> {
    const transport = nodemailer.createTransport({
      host: this.config.smtpHost,
      port: this.config.smtpPort,
      secure: this.config.smtpSecure,
      auth: {
        user: this.config.smtpUsername,
        pass: this.config.smtpPassword,
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    });

    try {
      return await fn(transport);
    } finally {
      transport.close();
    }
  }

  private normalizeSendResult(
    result: SentMessageInfo,
    subject: string,
    recipients: string[],
  ): EmailSendResult {
    const envelope = result.envelope && typeof result.envelope === "object"
      ? {
          from:
            "from" in result.envelope && typeof result.envelope.from === "string"
              ? result.envelope.from
              : undefined,
          to:
            "to" in result.envelope
              ? normalizeResponseList((result.envelope as { to?: unknown }).to)
              : undefined,
        }
      : {};

    return {
      ok: true,
      subject,
      to: recipients,
      messageId: result.messageId,
      envelope,
      accepted: normalizeResponseList(result.accepted),
      rejected: normalizeResponseList(result.rejected),
      response: typeof result.response === "string" ? result.response : "",
    };
  }
}
