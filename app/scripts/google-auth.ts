import { createServer } from "node:http";
import { once } from "node:events";
import { URL } from "node:url";
import { loadConfig } from "../src/config/load-config.js";
import { GoogleWorkspaceAccountsService } from "../src/integrations/google/google-workspace-accounts.js";
import { GOOGLE_YOUTUBE_UPLOAD_SCOPES } from "../src/integrations/google/google-auth.js";
import { createLogger } from "../src/utils/logger.js";

function readFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config = loadConfig();
  const logger = createLogger(config.runtime.logLevel);
  const account = readFlagValue(args, "--account")?.trim() || "primary";
  const googleAccounts = new GoogleWorkspaceAccountsService(
    config.googleAccounts,
    logger.child({ scope: "google-auth-cli", account }),
  );
  const auth = googleAccounts.getAuth(account);
  const workspace = googleAccounts.getWorkspace(account);
  const scopeProfile = readFlagValue(args, "--profile")?.trim();

  const status = auth.getStatus();
  if (!status.enabled) {
    throw new Error(`Google integration is disabled for account ${account}. Set GOOGLE_ENABLED=true or GOOGLE_ACCOUNT_<ALIAS>_ENABLED=true in .env first.`);
  }
  if (!status.configured) {
    throw new Error(status.message);
  }

  const scopes = scopeProfile === "youtube"
    ? [...auth.getRequestedScopes(), ...GOOGLE_YOUTUBE_UPLOAD_SCOPES]
    : auth.getRequestedScopes();
  const authUrl = auth.createAuthUrl(scopes);
  const callbackUrl = new URL(status.redirectUri as string);
  const listenPort = callbackUrl.port ? Number.parseInt(callbackUrl.port, 10) : status.oauthPort;
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", status.redirectUri);
      if (requestUrl.pathname !== callbackUrl.pathname) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      const error = requestUrl.searchParams.get("error");
      const code = requestUrl.searchParams.get("code");
      if (error) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end(`Google OAuth returned an error: ${error}`);
        server.close();
        return;
      }
      if (!code) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Missing authorization code.");
        return;
      }

      await auth.exchangeCodeForTokens(code);
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Google authentication concluída. Pode voltar ao terminal.");
      server.close();
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : String(error));
      server.close();
    }
  });

  server.listen(listenPort, "0.0.0.0");
  await once(server, "listening");

  console.log([
    "Google OAuth pronto.",
    `Conta selecionada: ${googleAccounts.resolveAlias(account)}`,
    `Abra esta URL no navegador do Mac:`,
    authUrl,
    "",
    `Callback esperado em: ${status.redirectUri}`,
    `Token sera salvo em: ${workspace.getStatus().tokenPath}`,
    `Perfil de escopo: ${scopeProfile ?? "default"}`,
    "",
    "Quando a autenticacao terminar, a janela do navegador mostrara uma confirmacao simples e o processo encerrara.",
  ].join("\n"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
