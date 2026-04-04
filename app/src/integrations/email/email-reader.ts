import { ImapFlow, type SearchObject } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import type { EmailConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";

export interface EmailAvailabilityStatus {
  enabled: boolean;
  configured: boolean;
  ready: boolean;
  mailbox: string;
  host?: string;
  username?: string;
  message: string;
  messages?: number;
  unseen?: number;
  recent?: number;
}

export interface EmailMessageSummary {
  uid: string;
  threadId?: string | null;
  subject: string;
  from: string[];
  to: string[];
  date: string | null;
  flags: string[];
  preview: string;
  messageId: string | null;
}

export interface EmailMessageContent extends EmailMessageSummary {
  cc: string[];
  replyTo: string[];
  text: string;
  truncated: boolean;
  references: string[];
}

export interface EmailReader {
  getStatus(): Promise<EmailAvailabilityStatus>;
  listRecentMessages(input?: {
    limit?: number;
    unreadOnly?: boolean;
    sinceHours?: number;
  }): Promise<EmailMessageSummary[]>;
  scanRecentMessages(input?: {
    scanLimit?: number;
    unreadOnly?: boolean;
    sinceHours?: number;
  }): Promise<EmailMessageSummary[]>;
  readMessage(uid: string): Promise<EmailMessageContent>;
}

export function normalizeText(value: string | undefined | null): string {
  if (!value) {
    return "";
  }
  return value.replace(/\s+/g, " ").trim();
}

export function formatAddresses(
  addresses?: Array<{ name?: string; address?: string }>,
): string[] {
  if (!addresses?.length) {
    return [];
  }

  return addresses
    .map((entry) => {
      const address = entry.address?.trim();
      const name = entry.name?.trim();
      if (name && address) {
        return `${name} <${address}>`;
      }
      return name || address || "";
    })
    .filter(Boolean);
}

export function parsedMailText(parsed: ParsedMail, maxChars: number): { text: string; truncated: boolean } {
  const html = typeof parsed.html === "string" ? parsed.html : "";
  const baseText = normalizeText(parsed.text ?? html);
  if (!baseText) {
    return {
      text: "",
      truncated: false,
    };
  }

  if (baseText.length <= maxChars) {
    return {
      text: baseText,
      truncated: false,
    };
  }

  return {
    text: `${baseText.slice(0, maxChars)}...`,
    truncated: true,
  };
}

export class EmailReaderService implements EmailReader {
  constructor(
    private readonly config: EmailConfig,
    private readonly logger: Logger,
  ) {}

  async getStatus(): Promise<EmailAvailabilityStatus> {
    if (!this.config.enabled) {
      return {
        enabled: false,
        configured: false,
        ready: false,
        mailbox: this.config.mailbox,
        message: "Email integration is disabled. Set EMAIL_ENABLED=true to enable read-only IMAP access.",
      };
    }

    if (!this.isConfigured()) {
      return {
        enabled: true,
        configured: false,
        ready: false,
        mailbox: this.config.mailbox,
        host: this.config.host,
        username: this.config.username,
        message: "Email integration is enabled but incomplete. Configure EMAIL_IMAP_HOST, EMAIL_IMAP_USERNAME and EMAIL_IMAP_PASSWORD.",
      };
    }

    return this.withClient(async (client) => {
      const status = await client.status(this.config.mailbox, {
        messages: true,
        recent: true,
        unseen: true,
        uidNext: true,
      });

      return {
        enabled: true,
        configured: true,
        ready: true,
        mailbox: this.config.mailbox,
        host: this.config.host,
        username: this.config.username,
        message: "Email integration ready in read-only mode.",
        messages: status.messages,
        unseen: status.unseen,
        recent: status.recent,
      } satisfies EmailAvailabilityStatus;
    });
  }

  async listRecentMessages(input?: {
    limit?: number;
    unreadOnly?: boolean;
    sinceHours?: number;
  }): Promise<EmailMessageSummary[]> {
    this.assertConfigured();
    const limit = Math.min(Math.max(input?.limit ?? this.config.maxMessages, 1), this.config.maxMessages);
    const sinceHours = Math.max(input?.sinceHours ?? this.config.lookbackHours, 1);
    const unreadOnly = input?.unreadOnly ?? true;

    return this.fetchRecentMessages({
      limit,
      unreadOnly,
      sinceHours,
    });
  }

  async scanRecentMessages(input?: {
    scanLimit?: number;
    unreadOnly?: boolean;
    sinceHours?: number;
  }): Promise<EmailMessageSummary[]> {
    this.assertConfigured();
    const scanLimit = Math.min(Math.max(input?.scanLimit ?? Math.max(this.config.maxMessages * 12, 120), 1), 250);
    const sinceHours = Math.max(input?.sinceHours ?? Math.max(this.config.lookbackHours, 24), 1);
    const unreadOnly = input?.unreadOnly ?? false;

    return this.fetchRecentMessages({
      limit: scanLimit,
      unreadOnly,
      sinceHours,
    });
  }

  async readMessage(uid: string): Promise<EmailMessageContent> {
    this.assertConfigured();

    return this.withMailbox(async (client) => {
      const message = await client.fetchOne(
        String(uid),
        {
          uid: true,
          envelope: true,
          flags: true,
          internalDate: true,
          source: {
            maxLength: this.config.maxSourceBytes,
          },
        },
        { uid: true },
      );

      if (!message) {
        throw new Error(`Email UID not found: ${uid}`);
      }

      const parsed = message.source ? await simpleParser(message.source) : undefined;
      const textPayload = parsed
        ? parsedMailText(parsed, this.config.maxTextChars)
        : { text: "", truncated: false };

      return {
        uid: String(message.uid),
        threadId: null,
        subject: message.envelope?.subject ?? "(sem assunto)",
        from: formatAddresses(message.envelope?.from),
        to: formatAddresses(message.envelope?.to),
        cc: formatAddresses(message.envelope?.cc),
        replyTo: formatAddresses(message.envelope?.replyTo),
        date: message.envelope?.date?.toISOString() ?? null,
        flags: [...(message.flags ?? new Set<string>())],
        preview: textPayload.text.slice(0, 240),
        messageId: message.envelope?.messageId ?? null,
        text: textPayload.text,
        truncated: textPayload.truncated,
        references: parsed?.references
          ? (Array.isArray(parsed.references) ? parsed.references : [parsed.references]).filter(Boolean)
          : [],
      };
    });
  }

  private isConfigured(): boolean {
    return Boolean(
      this.config.host &&
        this.config.username &&
        this.config.password &&
        this.config.mailbox,
    );
  }

  private assertConfigured(): void {
    if (!this.config.enabled) {
      throw new Error("Email integration is disabled. Set EMAIL_ENABLED=true to enable it.");
    }
    if (!this.isConfigured()) {
      throw new Error(
        "Email integration is not fully configured. Set EMAIL_IMAP_HOST, EMAIL_IMAP_USERNAME and EMAIL_IMAP_PASSWORD.",
      );
    }
  }

  private async withMailbox<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    return this.withClient(async (client) => {
      const lock = await client.getMailboxLock(this.config.mailbox, {
        readOnly: true,
        description: "read-only-email-access",
      });
      try {
        return await fn(client);
      } finally {
        lock.release();
      }
    });
  }

  private async withClient<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    this.assertConfigured();
    const host = this.config.host as string;
    const user = this.config.username as string;
    const pass = this.config.password as string;
    const client = new ImapFlow({
      host,
      port: this.config.port,
      secure: this.config.secure,
      auth: {
        user,
        pass,
      },
      logger: false,
      disableAutoIdle: true,
    });

    try {
      await client.connect();
      return await fn(client);
    } catch (error) {
      this.logger.error("Email reader failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      await client.logout().catch(() => {
        try {
          client.close();
        } catch {
          return undefined;
        }
        return undefined;
      });
    }
  }

  private async fetchRecentMessages(input: {
    limit: number;
    unreadOnly: boolean;
    sinceHours: number;
  }): Promise<EmailMessageSummary[]> {
    return this.withMailbox(async (client) => {
      const search: SearchObject = {
        since: new Date(Date.now() - input.sinceHours * 60 * 60 * 1000),
      };
      if (input.unreadOnly) {
        search.seen = false;
      }

      const uids = ((await client.search(search, { uid: true })) ?? []) as number[];
      if (!uids.length) {
        return [];
      }

      const selectedUids = uids.slice(-input.limit).reverse();
      const messages: EmailMessageSummary[] = [];

      for await (const message of client.fetch(
        selectedUids,
        {
          uid: true,
          envelope: true,
          flags: true,
          internalDate: true,
          source: {
            maxLength: this.config.maxSourceBytes,
          },
        },
        { uid: true },
      )) {
        const parsed = message.source ? await simpleParser(message.source) : undefined;
        const html = typeof parsed?.html === "string" ? parsed.html : "";
        const preview = normalizeText(parsed?.text ?? html).slice(0, 240);
        messages.push({
          uid: String(message.uid),
          threadId: null,
          subject: message.envelope?.subject ?? "(sem assunto)",
          from: formatAddresses(message.envelope?.from),
          to: formatAddresses(message.envelope?.to),
          date: message.envelope?.date?.toISOString() ?? null,
          flags: [...(message.flags ?? new Set<string>())],
          preview,
          messageId: message.envelope?.messageId ?? null,
        });
      }

      return messages.sort((left, right) => (right.date ?? "").localeCompare(left.date ?? ""));
    });
  }
}
