import type { EmailConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";
import { GoogleWorkspaceAccountsService } from "../google/google-workspace-accounts.js";
import {
  GOOGLE_GMAIL_READ_SCOPES,
  GOOGLE_GMAIL_SEND_SCOPES,
  type GoogleWorkspaceAuthService,
} from "../google/google-auth.js";
import { GmailReaderService } from "./gmail-reader.js";
import { GmailWriterService } from "./gmail-writer.js";
import { EmailReaderService, type EmailReader } from "./email-reader.js";
import { EmailWriterService, type EmailWriter } from "./email-writer.js";

interface EmailAccountRuntime {
  alias: string;
  reader: EmailReaderService;
  writer: EmailWriterService;
  gmailReader?: GmailReaderService;
  gmailWriter?: GmailWriterService;
  googleAuth?: GoogleWorkspaceAuthService;
}

export class EmailAccountsService {
  private readonly accounts = new Map<string, EmailAccountRuntime>();
  private readonly readerDelegates = new Map<string, EmailReader>();
  private readonly writerDelegates = new Map<string, EmailWriter>();

  constructor(
    configs: Record<string, EmailConfig>,
    googleWorkspaces: GoogleWorkspaceAccountsService,
    logger: Logger,
  ) {
    for (const [rawAlias, config] of Object.entries(configs)) {
      const alias = this.normalizeAlias(rawAlias);
      const googleAuth = googleWorkspaces.hasAlias(alias) ? googleWorkspaces.getAuth(alias) : undefined;
      this.accounts.set(alias, {
        alias,
        reader: new EmailReaderService(config, logger.child({ scope: "email", account: alias })),
        writer: new EmailWriterService(config, logger.child({ scope: "email-writer", account: alias })),
        gmailReader: googleAuth
          ? new GmailReaderService(config, googleAuth, logger.child({ scope: "gmail-reader", account: alias }))
          : undefined,
        gmailWriter: googleAuth
          ? new GmailWriterService(config, googleAuth, logger.child({ scope: "gmail-writer", account: alias }))
          : undefined,
        googleAuth,
      });
    }

    if (!this.accounts.has("primary")) {
      throw new Error("EmailAccountsService requires a primary account.");
    }
  }

  getAliases(): string[] {
    return [...this.accounts.keys()];
  }

  resolveAlias(alias?: string): string {
    const normalized = this.normalizeAlias(alias ?? "primary");
    return this.accounts.has(normalized) ? normalized : "primary";
  }

  getReader(alias?: string): EmailReader {
    const resolved = this.resolveAlias(alias);
    const cached = this.readerDelegates.get(resolved);
    if (cached) {
      return cached;
    }

    const delegate: EmailReader = {
      getStatus: async () => this.selectReader(resolved).getStatus(),
      listRecentMessages: async (input) => this.selectReader(resolved).listRecentMessages(input),
      scanRecentMessages: async (input) => this.selectReader(resolved).scanRecentMessages(input),
      readMessage: async (uid) => this.selectReader(resolved).readMessage(uid),
    };
    this.readerDelegates.set(resolved, delegate);
    return delegate;
  }

  getWriter(alias?: string): EmailWriter {
    const resolved = this.resolveAlias(alias);
    const cached = this.writerDelegates.get(resolved);
    if (cached) {
      return cached;
    }

    const delegate: EmailWriter = {
      getStatus: async () => this.selectWriter(resolved).getStatus(),
      sendReply: async (original, body, input) => this.selectWriter(resolved).sendReply(original, body, input),
      sendMessage: async (input) => this.selectWriter(resolved).sendMessage(input),
      getReplyPermission: (original) => this.selectWriter(resolved).getReplyPermission(original),
    };
    this.writerDelegates.set(resolved, delegate);
    return delegate;
  }

  private getAccount(alias?: string): EmailAccountRuntime {
    const resolved = this.resolveAlias(alias);
    const account = this.accounts.get(resolved);
    if (!account) {
      throw new Error(`Unknown email account alias: ${resolved}`);
    }
    return account;
  }

  private selectReader(alias: string): EmailReader {
    const account = this.getAccount(alias);
    const auth = account.googleAuth;
    if (account.gmailReader && auth && auth.getStatus().authenticated && auth.hasGrantedScopes(GOOGLE_GMAIL_READ_SCOPES)) {
      return account.gmailReader;
    }
    return account.reader;
  }

  private selectWriter(alias: string): EmailWriter {
    const account = this.getAccount(alias);
    const auth = account.googleAuth;
    if (account.gmailWriter && auth && auth.getStatus().authenticated && auth.hasGrantedScopes(GOOGLE_GMAIL_SEND_SCOPES)) {
      return account.gmailWriter;
    }
    return account.writer;
  }

  private normalizeAlias(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }
}
