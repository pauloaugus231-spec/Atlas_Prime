import type { AccountConnection } from "../../types/account-connection.js";
import type { ConnectionSession } from "../../types/connection-session.js";
import type { IntegrationPermissionDescriptor, IntegrationProvider } from "../../types/integration-provider.js";

function truncate(value: string | undefined, max = 120): string {
  if (!value) {
    return "";
  }
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export class AccountLinkingRenderer {
  renderOverview(input: {
    providers: IntegrationProvider[];
    permissions: Record<string, IntegrationPermissionDescriptor[]>;
    connections: AccountConnection[];
    sessions: ConnectionSession[];
  }): string {
    const lines = ["Conexões e permissões:", ""];
    for (const provider of input.providers) {
      const connection = input.connections.find((item) => item.provider === provider.id && item.status === "active");
      const session = input.sessions.find((item) => item.provider === provider.id && ["created", "opened"].includes(item.status));
      const label = connection
        ? `ativo${connection.providerEmail ? ` (${connection.providerEmail})` : ""}`
        : session
          ? "pendente"
          : "inativo";
      lines.push(`${provider.displayName}: ${label}`);
      const providerPermissions = input.permissions[provider.id] ?? [];
      if (providerPermissions.length > 0) {
        lines.push(`- Permissões: ${providerPermissions.map((item) => item.label).join(", ")}`);
      }
      if (connection) {
        lines.push(`- Escopos ativos: ${connection.scopes.length}`);
      }
      if (session?.authUrl) {
        lines.push(`- Link pendente: ${truncate(session.authUrl, 96)}`);
      }
    }
    return lines.join("\n");
  }

  renderStart(result: {
    provider: IntegrationProvider;
    alreadyConnected: boolean;
    authUrl?: string;
    message: string;
  }): string {
    if (result.alreadyConnected) {
      return `${result.provider.displayName} já está conectado.\n${result.message}`;
    }
    return [
      `${result.provider.displayName}: conexão iniciada.`,
      result.message,
      ...(result.authUrl ? ["", `Abra este link para autorizar: ${result.authUrl}`] : []),
    ].join("\n");
  }

  renderRevoke(provider: IntegrationProvider, ok: boolean): string {
    return ok
      ? `${provider.displayName} foi marcado como desconectado neste Atlas.`
      : `Não encontrei uma conexão ativa de ${provider.displayName}.`;
  }
}
