import type { EmailConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";
import {
  GOOGLE_GMAIL_SEND_SCOPES,
  type GoogleWorkspaceAuthService,
} from "../google/google-auth.js";
import type { EmailMessageContent } from "./email-reader.js";
import type {
  EmailDeliveryStatus,
  EmailMessageSendInput,
  EmailSendResult,
  EmailWriter,
  ReplyPermissionStatus,
} from "./email-writer.js";

interface GmailProfileResponse {
  emailAddress?: string;
}

interface GmailSendResponse {
  id?: string;
  threadId?: string;
}

function normalizeReplySubject(subject: string): string {
  const trimmed = subject.trim() || "(sem assunto)";
  if (/^re\s*:/i.test(trimmed)) {
    return trimmed;
  }
  return `Re: ${trimmed}`;
}

function buildFromHeader(fromName: string | undefined, fromAddress: string): string {
  const normalizedAddress = fromAddress.replace(/[\r\n]+/g, " ").trim();
  const normalizedName = fromName?.replace(/[\r\n]+/g, " ").trim();
  if (!normalizedName) {
    return normalizedAddress;
  }

  const encodedName = /^[\x20-\x7E]+$/.test(normalizedName)
    ? normalizedName
    : `=?UTF-8?B?${Buffer.from(normalizedName, "utf8").toString("base64")}?=`;
  return `${encodedName} <${normalizedAddress}>`;
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

function encodeHeaderValue(value: string): string {
  const normalized = value.replace(/[\r\n]+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return /^[\x20-\x7E]+$/.test(normalized)
    ? normalized
    : `=?UTF-8?B?${Buffer.from(normalized, "utf8").toString("base64")}?=`;
}

function chunkBase64(value: string, size = 76): string {
  return value.match(new RegExp(`.{1,${size}}`, "g"))?.join("\r\n") ?? value;
}

function encodeRawMessage(message: string): string {
  return Buffer.from(message, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildMimeMessage(input: {
  from: string;
  to: string[];
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string[];
}): string {
  const headers = [
    `From: ${input.from}`,
    `To: ${input.to.join(", ")}`,
    `Subject: ${encodeHeaderValue(input.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "X-Agent-Origin: agente-ai-local",
  ];

  if (input.inReplyTo?.trim()) {
    headers.push(`In-Reply-To: ${input.inReplyTo.trim()}`);
  }

  const references = (input.references ?? []).map((item) => item.trim()).filter(Boolean);
  if (references.length > 0) {
    headers.push(`References: ${references.join(" ")}`);
  }

  const encodedBody = chunkBase64(Buffer.from(input.body, "utf8").toString("base64"));
  return `${headers.join("\r\n")}\r\n\r\n${encodedBody}`;
}

export class GmailWriterService implements EmailWriter {
  constructor(
    private readonly config: EmailConfig,
    private readonly auth: GoogleWorkspaceAuthService,
    private readonly logger: Logger,
  ) {}

  async getStatus(): Promise<EmailDeliveryStatus> {
    if (!this.config.writeEnabled) {
      return {
        enabled: false,
        configured: false,
        ready: false,
        username: this.config.username,
        fromAddress: this.config.fromAddress,
        replyAllowlistConfigured:
          this.config.replyAllowedSenders.length > 0 || this.config.replyAllowedDomains.length > 0,
        replyAllowedSenders: this.config.replyAllowedSenders,
        replyAllowedDomains: this.config.replyAllowedDomains,
        message: "Email delivery is disabled. Set EMAIL_WRITE_ENABLED=true to enable sending.",
      };
    }

    const authStatus = this.auth.getStatus();
    if (!authStatus.enabled || !authStatus.configured || !authStatus.authenticated) {
      return {
        enabled: true,
        configured: authStatus.configured,
        ready: false,
        username: this.config.username,
        fromAddress: this.config.fromAddress,
        replyAllowlistConfigured:
          this.config.replyAllowedSenders.length > 0 || this.config.replyAllowedDomains.length > 0,
        replyAllowedSenders: this.config.replyAllowedSenders,
        replyAllowedDomains: this.config.replyAllowedDomains,
        message: "Gmail API is not authenticated for this account. Re-run npm run google:auth.",
      };
    }

    if (!this.auth.hasGrantedScopes(GOOGLE_GMAIL_SEND_SCOPES)) {
      return {
        enabled: true,
        configured: true,
        ready: false,
        username: this.config.username,
        fromAddress: this.config.fromAddress,
        replyAllowlistConfigured:
          this.config.replyAllowedSenders.length > 0 || this.config.replyAllowedDomains.length > 0,
        replyAllowedSenders: this.config.replyAllowedSenders,
        replyAllowedDomains: this.config.replyAllowedDomains,
        message: "Gmail send scope is not granted. Re-run npm run google:auth to grant gmail.send.",
      };
    }

    const profile = await this.fetchJson<GmailProfileResponse>("https://gmail.googleapis.com/gmail/v1/users/me/profile");
    return {
      enabled: true,
      configured: true,
      ready: true,
      username: this.config.username,
      fromAddress: this.resolveFromAddress(profile.emailAddress),
      replyAllowlistConfigured:
        this.config.replyAllowedSenders.length > 0 || this.config.replyAllowedDomains.length > 0,
      replyAllowedSenders: this.config.replyAllowedSenders,
      replyAllowedDomains: this.config.replyAllowedDomains,
      message: "Email delivery ready via Gmail API.",
    };
  }

  async sendReply(
    original: EmailMessageContent,
    body: string,
    input?: {
      subjectOverride?: string;
    },
  ): Promise<EmailSendResult> {
    this.assertReady();
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

    const response = await this.fetchJson<GmailSendResponse>(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        body: JSON.stringify({
          raw: encodeRawMessage(
            buildMimeMessage({
              from: buildFromHeader(this.config.fromName, this.requireFromAddress()),
              to: recipients,
              subject,
              body: trimmedBody,
              inReplyTo: original.messageId ?? undefined,
              references,
            }),
          ),
          ...(original.threadId?.trim() ? { threadId: original.threadId.trim() } : {}),
        }),
      },
    );

    this.logger.info("Email reply sent via Gmail API", {
      uid: original.uid,
      to: recipients,
      subject,
      messageId: response.id,
      threadId: response.threadId ?? original.threadId ?? null,
    });

    return {
      ok: true,
      subject,
      to: recipients,
      messageId: response.id ?? "",
      envelope: {
        from: this.requireFromAddress(),
        to: recipients.map((value) => extractEmailAddress(value) ?? value),
      },
      accepted: recipients.map((value) => extractEmailAddress(value) ?? value),
      rejected: [],
      response: "gmail-api",
    };
  }

  async sendMessage(input: EmailMessageSendInput): Promise<EmailSendResult> {
    this.assertReady();
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

    const response = await this.fetchJson<GmailSendResponse>(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        body: JSON.stringify({
          raw: encodeRawMessage(
            buildMimeMessage({
              from: buildFromHeader(this.config.fromName, this.requireFromAddress()),
              to: recipients,
              subject,
              body,
            }),
          ),
        }),
      },
    );

    this.logger.info("Email message sent via Gmail API", {
      to: recipients,
      subject,
      messageId: response.id,
      threadId: response.threadId ?? null,
    });

    return {
      ok: true,
      subject,
      to: recipients,
      messageId: response.id ?? "",
      envelope: {
        from: this.requireFromAddress(),
        to: recipients,
      },
      accepted: recipients,
      rejected: [],
      response: "gmail-api",
    };
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
      reason: allowed ? undefined : `Reply blocked by allowlist. Recipients: ${recipients.join(", ")}.`,
    };
  }

  private assertReady(): void {
    if (!this.config.writeEnabled) {
      throw new Error("Email delivery is disabled. Set EMAIL_WRITE_ENABLED=true to enable sending.");
    }

    const authStatus = this.auth.getStatus();
    if (!authStatus.enabled || !authStatus.configured || !authStatus.authenticated) {
      throw new Error("Gmail API is not authenticated for this account. Re-run npm run google:auth.");
    }

    if (!this.auth.hasGrantedScopes(GOOGLE_GMAIL_SEND_SCOPES)) {
      throw new Error("Gmail send scope is not granted. Re-run npm run google:auth to grant gmail.send.");
    }

    this.requireFromAddress();
  }

  private resolveFromAddress(profileEmail?: string): string | undefined {
    return this.config.fromAddress?.trim() ||
      this.config.smtpUsername?.trim() ||
      this.config.username?.trim() ||
      profileEmail?.trim();
  }

  private requireFromAddress(): string {
    const fromAddress = this.resolveFromAddress();
    if (!fromAddress) {
      throw new Error("No from address is configured for Gmail sending.");
    }
    return fromAddress;
  }

  private async fetchJson<T>(
    url: string,
    input?: {
      method?: "GET" | "POST";
      body?: string;
    },
  ): Promise<T> {
    const accessToken = await this.auth.getAccessToken();
    const response = await fetch(url, {
      method: input?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(input?.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(input?.body ? { body: input.body } : {}),
    });

    const payload = (await response.json()) as T & { error?: { message?: string } };
    if (!response.ok) {
      this.logger.error("Gmail writer request failed", {
        url,
        status: response.status,
        message: payload.error?.message,
      });
      throw new Error(payload.error?.message || `Gmail request failed with status ${response.status}`);
    }

    return payload as T;
  }
}
