import { simpleParser } from "mailparser";
import type { EmailConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";
import {
  GOOGLE_GMAIL_READ_SCOPES,
  type GoogleAuthStatus,
  type GoogleWorkspaceAuthService,
} from "../google/google-auth.js";
import {
  formatAddresses,
  normalizeText,
  parsedMailText,
  type EmailAvailabilityStatus,
  type EmailMessageContent,
  type EmailMessageSummary,
  type EmailReader,
} from "./email-reader.js";

interface GmailLabelResponse {
  messagesTotal?: number;
  messagesUnread?: number;
}

interface GmailListResponse {
  messages?: Array<{
    id?: string;
    threadId?: string;
  }>;
}

interface GmailMessageHeadersResponse {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  payload?: {
    headers?: Array<{ name?: string; value?: string }>;
  };
}

interface GmailMessageRawResponse {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  raw?: string;
}

function base64UrlDecode(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, "base64");
}

function formatAfterDate(hoursAgo: number): string {
  const date = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function buildMailboxQuery(mailbox: string): string[] {
  const normalized = mailbox.trim().toLowerCase();
  if (!normalized || normalized === "inbox") {
    return ["in:inbox"];
  }
  return [`label:${JSON.stringify(mailbox.trim())}`];
}

function extractParsedAddresses(
  value: unknown,
): Array<{ name?: string; address?: string }> | undefined {
  if (!value || typeof value !== "object" || !("value" in value)) {
    return undefined;
  }

  const addresses = (value as { value?: Array<{ name?: string; address?: string }> }).value;
  return Array.isArray(addresses) ? addresses : undefined;
}

async function mapWithConcurrency<T, TResult>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<TResult>,
): Promise<TResult[]> {
  const results: TResult[] = new Array(items.length);
  let nextIndex = 0;

  const run = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex] as T);
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => run()),
  );
  return results;
}

export class GmailReaderService implements EmailReader {
  constructor(
    private readonly config: EmailConfig,
    private readonly auth: GoogleWorkspaceAuthService,
    private readonly logger: Logger,
  ) {}

  async getStatus(): Promise<EmailAvailabilityStatus> {
    if (!this.config.enabled) {
      return {
        enabled: false,
        configured: false,
        ready: false,
        mailbox: this.config.mailbox,
        message: "Email integration is disabled. Set EMAIL_ENABLED=true to enable inbox access.",
      };
    }

    const authStatus = this.auth.getStatus();
    if (!authStatus.enabled || !authStatus.configured || !authStatus.authenticated) {
      return this.buildUnavailableStatus(
        authStatus,
        "Gmail API is not authenticated for this account. Re-run npm run google:auth after adding Gmail scopes.",
      );
    }

    if (!this.auth.hasGrantedScopes(GOOGLE_GMAIL_READ_SCOPES)) {
      return this.buildUnavailableStatus(
        authStatus,
        "Gmail read scope is not granted. Re-run npm run google:auth to grant gmail.readonly.",
      );
    }

    const inboxLabel = await this.fetchJson<GmailLabelResponse>(
      "https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX",
    );

    return {
      enabled: true,
      configured: true,
      ready: true,
      mailbox: this.config.mailbox,
      username: this.config.username,
      message: "Email integration ready via Gmail API.",
      messages: inboxLabel.messagesTotal,
      unseen: inboxLabel.messagesUnread,
    };
  }

  async listRecentMessages(input?: {
    limit?: number;
    unreadOnly?: boolean;
    sinceHours?: number;
  }): Promise<EmailMessageSummary[]> {
    this.assertReady();
    const limit = Math.min(Math.max(input?.limit ?? this.config.maxMessages, 1), this.config.maxMessages);
    const sinceHours = Math.max(input?.sinceHours ?? this.config.lookbackHours, 1);
    const unreadOnly = input?.unreadOnly ?? true;
    const queryParts = [
      ...buildMailboxQuery(this.config.mailbox),
      `after:${formatAfterDate(sinceHours)}`,
      ...(unreadOnly ? ["is:unread"] : []),
    ];

    return this.fetchRecentSummaries(limit, queryParts.join(" "));
  }

  async scanRecentMessages(input?: {
    scanLimit?: number;
    unreadOnly?: boolean;
    sinceHours?: number;
  }): Promise<EmailMessageSummary[]> {
    this.assertReady();
    const scanLimit = Math.min(Math.max(input?.scanLimit ?? Math.max(this.config.maxMessages * 12, 120), 1), 250);
    const sinceHours = Math.max(input?.sinceHours ?? Math.max(this.config.lookbackHours, 24), 1);
    const unreadOnly = input?.unreadOnly ?? false;
    const queryParts = [
      ...buildMailboxQuery(this.config.mailbox),
      `after:${formatAfterDate(sinceHours)}`,
      ...(unreadOnly ? ["is:unread"] : []),
    ];

    return this.fetchRecentSummaries(scanLimit, queryParts.join(" "));
  }

  async readMessage(uid: string): Promise<EmailMessageContent> {
    this.assertReady();
    const response = await this.fetchJson<GmailMessageRawResponse>(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(uid)}?format=raw`,
    );

    if (!response.raw) {
      throw new Error(`Email UID not found: ${uid}`);
    }

    const parsed = await simpleParser(base64UrlDecode(response.raw));
    const textPayload = parsedMailText(parsed, this.config.maxTextChars);

    return {
      uid: response.id ?? uid,
      threadId: response.threadId ?? null,
      subject: parsed.subject ?? "(sem assunto)",
      from: formatAddresses(extractParsedAddresses(parsed.from)),
      to: formatAddresses(extractParsedAddresses(parsed.to)),
      cc: formatAddresses(extractParsedAddresses(parsed.cc)),
      replyTo: formatAddresses(extractParsedAddresses(parsed.replyTo)),
      date: parsed.date?.toISOString() ?? null,
      flags: response.labelIds ?? [],
      preview: textPayload.text.slice(0, 240),
      messageId: parsed.messageId ?? null,
      text: textPayload.text,
      truncated: textPayload.truncated,
      references: parsed.references
        ? (Array.isArray(parsed.references) ? parsed.references : [parsed.references]).filter(Boolean)
        : [],
    };
  }

  private async fetchRecentSummaries(limit: number, query: string): Promise<EmailMessageSummary[]> {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("maxResults", String(limit));
    if (query.trim()) {
      url.searchParams.set("q", query.trim());
    }

    const response = await this.fetchJson<GmailListResponse>(url.toString());
    const messages = (response.messages ?? []).filter((item): item is { id: string; threadId?: string } => Boolean(item.id));
    const summaries = await mapWithConcurrency(messages, 10, async (item) => this.fetchSummary(item.id, item.threadId));
    return summaries.filter((item): item is EmailMessageSummary => Boolean(item));
  }

  private async fetchSummary(id: string, fallbackThreadId?: string): Promise<EmailMessageSummary | null> {
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`);
    url.searchParams.set("format", "metadata");
    for (const header of ["Subject", "From", "To", "Date", "Message-ID"]) {
      url.searchParams.append("metadataHeaders", header);
    }

    const response = await this.fetchJson<GmailMessageHeadersResponse>(url.toString());
    const headerLines = (response.payload?.headers ?? [])
      .filter((header): header is { name: string; value: string } => Boolean(header.name && header.value))
      .map((header) => `${header.name}: ${header.value}`);
    const parsed = await simpleParser(`${headerLines.join("\r\n")}\r\n\r\n`);

    return {
      uid: response.id ?? id,
      threadId: response.threadId ?? fallbackThreadId ?? null,
      subject: parsed.subject ?? "(sem assunto)",
      from: formatAddresses(extractParsedAddresses(parsed.from)),
      to: formatAddresses(extractParsedAddresses(parsed.to)),
      date: parsed.date?.toISOString() ?? null,
      flags: response.labelIds ?? [],
      preview: normalizeText(response.snippet ?? ""),
      messageId: parsed.messageId ?? null,
    };
  }

  private buildUnavailableStatus(authStatus: GoogleAuthStatus, message: string): EmailAvailabilityStatus {
    return {
      enabled: true,
      configured: authStatus.configured,
      ready: false,
      mailbox: this.config.mailbox,
      username: this.config.username,
      message,
    };
  }

  private assertReady(): void {
    if (!this.config.enabled) {
      throw new Error("Email integration is disabled. Set EMAIL_ENABLED=true to enable it.");
    }

    const authStatus = this.auth.getStatus();
    if (!authStatus.enabled || !authStatus.configured || !authStatus.authenticated) {
      throw new Error("Gmail API is not authenticated for this account. Re-run npm run google:auth.");
    }

    if (!this.auth.hasGrantedScopes(GOOGLE_GMAIL_READ_SCOPES)) {
      throw new Error("Gmail read scope is not granted. Re-run npm run google:auth to grant gmail.readonly.");
    }
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const accessToken = await this.auth.getAccessToken();
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const payload = (await response.json()) as T & { error?: { message?: string } };
    if (!response.ok) {
      this.logger.error("Gmail reader request failed", {
        url,
        status: response.status,
        message: payload.error?.message,
      });
      throw new Error(payload.error?.message || `Gmail request failed with status ${response.status}`);
    }

    return payload as T;
  }
}
