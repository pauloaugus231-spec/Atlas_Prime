import type { GoogleWorkspaceConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";
import { GoogleWorkspaceAuthService } from "./google-auth.js";
import { GoogleWorkspaceService } from "./google-workspace.js";

interface GoogleAccountRuntime {
  alias: string;
  auth: GoogleWorkspaceAuthService;
  workspace: GoogleWorkspaceService;
}

export class GoogleWorkspaceAccountsService {
  private readonly accounts = new Map<string, GoogleAccountRuntime>();

  constructor(
    configs: Record<string, GoogleWorkspaceConfig>,
    logger: Logger,
  ) {
    for (const [rawAlias, config] of Object.entries(configs)) {
      const alias = this.normalizeAlias(rawAlias);
      const auth = new GoogleWorkspaceAuthService(config, logger.child({ scope: "google-auth", account: alias }));
      const workspace = new GoogleWorkspaceService(config, auth, logger.child({ scope: "google-workspace", account: alias }));
      this.accounts.set(alias, {
        alias,
        auth,
        workspace,
      });
    }

    if (!this.accounts.has("primary")) {
      throw new Error("GoogleWorkspaceAccountsService requires a primary account.");
    }
  }

  getAliases(): string[] {
    return [...this.accounts.keys()];
  }

  hasAlias(alias?: string): boolean {
    const normalized = this.normalizeAlias(alias ?? "primary");
    return this.accounts.has(normalized);
  }

  resolveAlias(alias?: string): string {
    const normalized = this.normalizeAlias(alias ?? "primary");
    return this.accounts.has(normalized) ? normalized : "primary";
  }

  getAuth(alias?: string): GoogleWorkspaceAuthService {
    return this.getAccount(alias).auth;
  }

  getWorkspace(alias?: string): GoogleWorkspaceService {
    return this.getAccount(alias).workspace;
  }

  private getAccount(alias?: string): GoogleAccountRuntime {
    const resolved = this.resolveAlias(alias);
    const account = this.accounts.get(resolved);
    if (!account) {
      throw new Error(`Unknown Google account alias: ${resolved}`);
    }
    return account;
  }

  private normalizeAlias(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }
}
