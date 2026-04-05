import type { AltivaConfig } from "../types/config.js";
import type { Logger } from "../types/logger.js";

export interface FounderOpsSection {
  key: "altiva" | "support" | "growth" | "engineering";
  title: string;
  status: "prepared" | "connected";
  summary: string;
  requiredInputs: string[];
}

export interface FounderOpsSnapshot {
  executiveLine: string;
  sections: FounderOpsSection[];
  trackedMetrics: string[];
}

function summarizeIntegrationMode(config: AltivaConfig): "prepared" | "connected" {
  if (config.enabled && ((config.apiBaseUrl && config.apiKey) || config.snapshotPath)) {
    return "connected";
  }
  return "prepared";
}

export class FounderOpsService {
  constructor(
    private readonly config: AltivaConfig,
    private readonly logger: Logger,
  ) {}

  getDailySnapshot(): FounderOpsSnapshot {
    const status = summarizeIntegrationMode(this.config);
    const executiveLine = status === "connected"
      ? `${this.config.companyName} conectada ao Founder Brief. O Atlas está pronto para consolidar métricas, suporte, growth e engenharia no resumo diário.`
      : `${this.config.companyName} preparada para o Founder Brief, aguardando fonte de dados para consolidar métricas, suporte, growth e engenharia.`;

    this.logger.debug("Built founder ops snapshot", {
      companyName: this.config.companyName,
      status,
      trackedMetrics: this.config.trackedMetrics,
    });

    return {
      executiveLine,
      trackedMetrics: this.config.trackedMetrics.length > 0
        ? this.config.trackedMetrics
        : [
            "signups",
            "activations",
            "active_users",
            "paid_conversions",
            "mrr",
            "churn",
            "tickets_open",
            "tickets_urgent",
          ],
      sections: [
        {
          key: "altiva",
          title: "Altiva",
          status,
          summary: status === "connected"
            ? "Dados de produto e receita podem alimentar o briefing executivo."
            : "Pronta para receber signups, ativações, usuários ativos, conversão para pago, MRR e churn.",
          requiredInputs: [
            "daily summary",
            "funnel metrics",
            "revenue snapshot",
          ],
        },
        {
          key: "support",
          title: "Support Director",
          status,
          summary: status === "connected"
            ? "Suporte pode entrar no briefing com urgência, risco e volume."
            : "Pronto para receber tickets, urgência, SLA e risco de churn por cliente.",
          requiredInputs: [
            "tickets",
            "support channels",
            "customer risk flags",
          ],
        },
        {
          key: "growth",
          title: "Growth Operator",
          status,
          summary: status === "connected"
            ? "Canais e aquisição podem virar sinais diários de growth."
            : "Pronto para receber performance de canais, landing pages, campanhas e conversão.",
          requiredInputs: [
            "channel performance",
            "campaign stats",
            "landing page conversion",
          ],
        },
        {
          key: "engineering",
          title: "Engineering Coordinator",
          status,
          summary: status === "connected"
            ? "Deploys, erros e regressões podem alimentar prioridade técnica do dia."
            : "Pronto para receber deploys, incidentes, bugs críticos e regressões.",
          requiredInputs: [
            "deploy status",
            "error summary",
            "critical bugs",
          ],
        },
      ],
    };
  }
}
