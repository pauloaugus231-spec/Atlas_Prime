import type {
  OperationalState,
  OperationalStateSignal,
  UpdateOperationalStateInput,
} from "../types/operational-state.js";
import type { PendingMonitoredChannelAlertDraft } from "./monitored-channel-alerts.js";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(items: string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }
    const key = normalize(trimmed);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(trimmed);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

function signalSummaryLabel(summary: string): string {
  return `Institucional: ${summary.trim()}`;
}

function deriveMonitoredSignalKind(draft: PendingMonitoredChannelAlertDraft): OperationalStateSignal["kind"] {
  if (draft.timeSignal === "deadline") {
    return "deadline";
  }
  if (draft.classification === "possible_event") {
    return "possible_event";
  }
  if (draft.classification === "possible_task" || draft.classification === "action_needed") {
    return "possible_task";
  }
  if (draft.classification === "possible_reply") {
    return "reply_needed";
  }
  return "attention";
}

function deriveMonitoredRiskLabel(draft: PendingMonitoredChannelAlertDraft): string | undefined {
  if (draft.timeSignal === "deadline") {
    return "prazo operacional vindo do institucional";
  }
  if (draft.classification === "possible_event") {
    return "possível compromisso vindo do institucional";
  }
  if (draft.classification === "possible_reply") {
    return "pendência de resposta no institucional";
  }
  if (draft.classification === "possible_task" || draft.classification === "action_needed") {
    return "possível tarefa prioritária no institucional";
  }
  if (draft.urgency === "high") {
    return "atenção operacional alta no institucional";
  }
  return undefined;
}

function deriveMonitoredFocusHint(draft: PendingMonitoredChannelAlertDraft): string | undefined {
  if (draft.classification === "possible_event") {
    return "Institucional: revisar agenda e confirmar possível evento.";
  }
  if (draft.classification === "possible_reply") {
    return "Institucional: decidir se vale resumir ou preparar resposta.";
  }
  if (draft.classification === "possible_task" || draft.classification === "action_needed") {
    return "Institucional: decidir se isso vira task agora.";
  }
  if (draft.urgency === "high") {
    return "Institucional: triar mensagem relevante com urgência.";
  }
  return undefined;
}

export function buildMonitoredAlertOperationalSignal(
  draft: PendingMonitoredChannelAlertDraft,
): OperationalStateSignal {
  const now = new Date().toISOString();
  const stableKey = normalize([
    "monitored_whatsapp",
    draft.sourceAccount ?? "sem_conta",
    draft.classification,
    draft.summary,
  ].join(":")).replace(/[^a-z0-9]+/g, "_").slice(0, 96);

  return {
    key: stableKey,
    source: "monitored_whatsapp",
    kind: deriveMonitoredSignalKind(draft),
    summary: draft.summary.trim(),
    priority: draft.urgency === "high" ? "high" : draft.urgency === "medium" ? "medium" : "low",
    active: true,
    createdAt: draft.createdAt || now,
    updatedAt: now,
  };
}

export function buildOperationalStatePatchForMonitoredAlert(
  current: OperationalState,
  draft: PendingMonitoredChannelAlertDraft,
): UpdateOperationalStateInput {
  const signal = buildMonitoredAlertOperationalSignal(draft);
  const existing = current.signals.find((item) => item.key === signal.key);
  const signals = [
    {
      ...signal,
      createdAt: existing?.createdAt ?? signal.createdAt,
    },
    ...current.signals.filter((item) => item.key !== signal.key),
  ].slice(0, 12);
  const summaryLabel = signalSummaryLabel(draft.summary);
  const focusHint = deriveMonitoredFocusHint(draft);
  const riskLabel = deriveMonitoredRiskLabel(draft);

  return {
    signals,
    pendingAlerts: uniqueStrings([summaryLabel, ...current.pendingAlerts], 6),
    recentContext: uniqueStrings(
      [
        ...(focusHint ? [focusHint] : []),
        ...current.recentContext,
      ],
      8,
    ),
    ...(riskLabel ? { primaryRisk: riskLabel } : {}),
  };
}

export function buildOperationalStatePatchForResolvedMonitoredAlert(
  current: OperationalState,
  draft: PendingMonitoredChannelAlertDraft,
  resolution: "ignore" | "register" | "event" | "task" | "reply" | "summary",
): UpdateOperationalStateInput {
  const signal = buildMonitoredAlertOperationalSignal(draft);
  const signals = current.signals.map((item) =>
    item.key === signal.key
      ? {
          ...item,
          active: resolution === "summary",
          updatedAt: new Date().toISOString(),
        }
      : item,
  );
  const summaryLabel = signalSummaryLabel(draft.summary);
  const resolutionLine =
    resolution === "ignore"
      ? `Institucional: alerta descartado — ${draft.summary}.`
      : resolution === "register"
        ? `Institucional: alerta registrado sem ação externa — ${draft.summary}.`
        : resolution === "summary"
          ? `Institucional: alerta mantido em acompanhamento — ${draft.summary}.`
          : `Institucional: alerta convertido em ${resolution === "event" ? "evento" : resolution === "task" ? "tarefa" : "rascunho de resposta"}.`;

  return {
    signals,
    pendingAlerts:
      resolution === "summary"
        ? current.pendingAlerts
        : current.pendingAlerts.filter((item) => normalize(item) !== normalize(summaryLabel)),
    recentContext: uniqueStrings([resolutionLine, ...current.recentContext], 8),
  };
}
