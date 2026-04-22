import type { AppConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";
import { EmailAccountsService } from "../../integrations/email/email-accounts.js";
import { ExternalReasoningClient } from "../../integrations/external-reasoning/external-reasoning-client.js";
import { GoogleWorkspaceAuthService } from "../../integrations/google/google-auth.js";
import { GoogleMapsService } from "../../integrations/google/google-maps.js";
import { GoogleWorkspaceAccountsService } from "../../integrations/google/google-workspace-accounts.js";
import { GoogleWorkspaceService } from "../../integrations/google/google-workspace.js";
import { PexelsMediaService } from "../../integrations/media/pexels.js";
import { SupabaseMacCommandQueue } from "../../integrations/supabase/mac-command-queue.js";
import { AccountConnectionStore } from "../account-linking/account-connection-store.js";
import { AccountLinkingService } from "../account-linking/account-linking-service.js";
import { ConnectionSessionStore } from "../account-linking/connection-session-store.js";
import { OauthProviderRegistry } from "../account-linking/oauth-provider-registry.js";
import { ProviderPermissions } from "../account-linking/provider-permissions.js";
import { TokenVault } from "../account-linking/token-vault.js";
import { CommunicationRouter } from "../contact-intelligence.js";
import { FounderOpsService } from "../founder-ops.js";
import { WorkflowExecutionRuntime } from "../execution-runtime.js";
import type { IntelligenceLayer, IntegrationsLayer, StorageLayer } from "./types.js";

export function createIntegrationsLayer(
  config: AppConfig,
  logger: Logger,
  storage: Pick<StorageLayer, "contacts" | "workflows">,
  intelligence: Pick<IntelligenceLayer, "entityLinker">,
): IntegrationsLayer {
  const communicationRouter = new CommunicationRouter(storage.contacts);
  const workflowRuntime = new WorkflowExecutionRuntime(
    storage.workflows,
    logger.child({ scope: "workflow-runtime" }),
    intelligence.entityLinker,
  );
  const macCommandQueue = new SupabaseMacCommandQueue(
    config.supabaseMacQueue,
    logger.child({ scope: "supabase-mac-queue" }),
  );
  const googleAuth = new GoogleWorkspaceAuthService(
    config.google,
    logger.child({ scope: "google-auth" }),
  );
  const googleWorkspace = new GoogleWorkspaceService(
    config.google,
    googleAuth,
    logger.child({ scope: "google-workspace" }),
  );
  const googleWorkspaces = new GoogleWorkspaceAccountsService(
    config.googleAccounts,
    logger.child({ scope: "google-workspace-accounts" }),
  );
  const googleMaps = new GoogleMapsService(
    config.googleMaps,
    logger.child({ scope: "google-maps" }),
  );
  const externalReasoning = new ExternalReasoningClient(
    config.externalReasoning,
    logger.child({ scope: "external-reasoning" }),
  );
  const founderOps = new FounderOpsService(
    config.altiva,
    logger.child({ scope: "founder-ops" }),
  );
  const pexelsMedia = new PexelsMediaService(
    config.media,
    logger.child({ scope: "pexels-media" }),
  );
  const emailAccounts = new EmailAccountsService(
    config.emailAccounts,
    googleWorkspaces,
    logger.child({ scope: "email-accounts" }),
  );
  const connectionSessions = new ConnectionSessionStore(
    config.paths.accountLinkingDbPath,
    logger.child({ scope: "connection-sessions" }),
  );
  const accountConnections = new AccountConnectionStore(
    config.paths.accountLinkingDbPath,
    logger.child({ scope: "account-connections" }),
  );
  const tokenVault = new TokenVault(
    config.paths.accountLinkingDbPath,
    config.runtime.tokenVaultSecret,
    logger.child({ scope: "token-vault" }),
  );
  const providerPermissions = new ProviderPermissions();
  const oauthProviders = new OauthProviderRegistry(
    googleAuth,
    providerPermissions,
  );
  const accountLinking = new AccountLinkingService(
    config,
    connectionSessions,
    accountConnections,
    oauthProviders,
    providerPermissions,
    tokenVault,
    logger.child({ scope: "account-linking" }),
  );

  return {
    communicationRouter,
    workflowRuntime,
    macCommandQueue,
    googleAuth,
    googleWorkspace,
    googleWorkspaces,
    googleMaps,
    externalReasoning,
    founderOps,
    pexelsMedia,
    emailAccounts,
    email: emailAccounts.getReader("primary"),
    emailWriter: emailAccounts.getWriter("primary"),
    connectionSessions,
    accountConnections,
    tokenVault,
    providerPermissions,
    oauthProviders,
    accountLinking,
  };
}
