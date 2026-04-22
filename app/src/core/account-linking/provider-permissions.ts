import {
  GOOGLE_GMAIL_READ_SCOPES,
  GOOGLE_GMAIL_SEND_SCOPES,
  GOOGLE_WORKSPACE_READ_SCOPES,
  GOOGLE_WORKSPACE_WRITE_SCOPES,
} from "../../integrations/google/google-auth.js";
import type { IntegrationPermissionDescriptor, IntegrationProviderId } from "../../types/integration-provider.js";

const GOOGLE_PERMISSIONS: IntegrationPermissionDescriptor[] = [
  {
    key: "calendar_tasks_read",
    label: "Agenda e tarefas (leitura)",
    scopes: GOOGLE_WORKSPACE_READ_SCOPES,
    tier: "default",
    description: "Ler agenda, tarefas e contatos básicos para briefing e contexto.",
  },
  {
    key: "calendar_tasks_write",
    label: "Agenda e tarefas (escrita)",
    scopes: GOOGLE_WORKSPACE_WRITE_SCOPES,
    tier: "sensitive",
    description: "Criar ou ajustar eventos e tarefas com aprovação.",
  },
  {
    key: "gmail_read",
    label: "Gmail (leitura)",
    scopes: GOOGLE_GMAIL_READ_SCOPES,
    tier: "restricted",
    description: "Ler emails para triagem e resumos.",
  },
  {
    key: "gmail_send",
    label: "Gmail (envio)",
    scopes: GOOGLE_GMAIL_SEND_SCOPES,
    tier: "restricted",
    description: "Enviar emails somente com confirmação forte.",
  },
];

export class ProviderPermissions {
  list(provider: IntegrationProviderId): IntegrationPermissionDescriptor[] {
    switch (provider) {
      case "google":
        return GOOGLE_PERMISSIONS.map((item) => ({ ...item, scopes: [...item.scopes] }));
      default:
        return [];
    }
  }

  resolveScopes(provider: IntegrationProviderId, keys?: string[]): string[] {
    const permissions = this.list(provider);
    const selected = keys && keys.length > 0
      ? permissions.filter((item) => keys.includes(item.key))
      : permissions.filter((item) => item.tier === "default");
    return [...new Set(selected.flatMap((item) => item.scopes))];
  }
}
