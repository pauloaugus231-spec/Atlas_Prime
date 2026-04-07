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
      ? `${this.config.companyName} conectada ao Founder Brief.`
      : `${this.config.companyName} aguardando integração de dados no Founder Brief.`;

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
            ? "Métricas de produto e receita já podem entrar no resumo executivo."
            : "Métricas de produto e receita prontas para entrar no resumo executivo.",
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
            ? "Fila, urgência e risco de churn já podem entrar no briefing."
            : "Fila, urgência e risco de churn prontos para entrar no briefing.",
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
            ? "Canais, campanhas e conversão já podem virar sinais diários."
            : "Canais, campanhas e conversão prontos para entrar no briefing.",
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
            ? "Deploys, erros e regressões já podem orientar a prioridade técnica."
            : "Deploys, erros e regressões prontos para orientar a prioridade técnica.",
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
