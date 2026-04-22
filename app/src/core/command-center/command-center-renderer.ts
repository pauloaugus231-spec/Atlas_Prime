import type { CommandCenterSnapshot } from "./command-center-types.js";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value);
}

export class CommandCenterRenderer {
  render(snapshot: CommandCenterSnapshot): string {
    return [
      "Painel Atlas",
      `- Modo: ${snapshot.operatorMode}`,
      `- Foco atual: ${snapshot.currentFocus.length > 0 ? snapshot.currentFocus.join(", ") : "sem foco salvo"}`,
      `- Risco principal: ${snapshot.topRisk ?? "sem risco crítico"}`,
      `- Próxima ação: ${snapshot.nextBestAction ?? "sem próxima ação definida"}`,
      "",
      "Pendências:",
      `- Sugestões proativas: ${snapshot.inboxes.proactiveSuggestions}`,
      `- Aprovações pendentes: ${snapshot.inboxes.approvalsPending}`,
      `- Compromissos pendentes: ${snapshot.inboxes.commitmentsPending}`,
      `- Mensagens importantes: ${snapshot.inboxes.importantMessages}`,
      "",
      "Operação:",
      `- Agenda hoje: ${snapshot.agenda.todayCount} compromisso(s)${snapshot.agenda.nextEvent ? ` | próxima: ${snapshot.agenda.nextEvent}` : ""}`,
      `- Conflitos: ${snapshot.agenda.conflicts}`,
      `- Pipeline aberto: ${formatCurrency(snapshot.revenue.openPipeline)}`,
      `- Projetado no mês: ${formatCurrency(snapshot.revenue.projectedThisMonth)}`,
      `- Recebido no mês: ${formatCurrency(snapshot.revenue.receivedThisMonth)}`,
      `- Leads parados: ${snapshot.revenue.staleLeads}`,
      "",
      "Sistema:",
      ...Object.entries(snapshot.system.integrations).map(([key, status]) => `- ${key}: ${status}`),
    ].join("\n");
  }
}
