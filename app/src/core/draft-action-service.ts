import type {
  PendingGoogleEventDeleteBatchDraft,
  PendingGoogleEventDeleteDraft,
  PendingGoogleEventDraft,
  PendingGoogleEventImportBatchDraft,
  PendingGoogleEventUpdateDraft,
  PendingGoogleTaskDraft,
} from "./google-draft-utils.js";
import type { PendingMonitoredChannelAlertDraft } from "./monitored-channel-alerts.js";

export interface PendingEmailDraft {
  kind: "email_reply";
  uid: string;
  body: string;
  subjectOverride?: string;
}

export interface PendingWhatsAppReplyDraft {
  kind: "whatsapp_reply";
  instanceName?: string;
  account?: string;
  remoteJid: string;
  number: string;
  pushName?: string;
  inboundText: string;
  replyText: string;
  relationship?: string;
  persona?: string;
}

export interface PendingYouTubePublishDraft {
  kind: "youtube_publish";
  contentItemId: number;
  filePath: string;
  title: string;
  description: string;
  privacyStatus: "private" | "public" | "unlisted";
  tags: string[];
}

export type PendingActionDraft =
  | PendingEmailDraft
  | PendingWhatsAppReplyDraft
  | PendingMonitoredChannelAlertDraft
  | PendingYouTubePublishDraft
  | PendingGoogleTaskDraft
  | PendingGoogleEventDraft
  | PendingGoogleEventUpdateDraft
  | PendingGoogleEventDeleteDraft
  | PendingGoogleEventDeleteBatchDraft
  | PendingGoogleEventImportBatchDraft;

function parseJsonDraft<T>(text: string, marker: string): T | undefined {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`${escaped}\\s*([\\s\\S]*?)\\s*END_${escaped}`, "i"));
  if (!match?.[1]?.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(match[1].trim()) as T;
  } catch {
    return undefined;
  }
}

function extractPendingEmailDraft(text: string): PendingEmailDraft | undefined {
  const match = text.match(
    /EMAIL_REPLY_DRAFT\s+uid=([^\s]+)\s*(?:subject=(.+?)\s*)?body:\s*([\s\S]*?)\s*END_EMAIL_REPLY_DRAFT/i,
  );
  if (!match) {
    return undefined;
  }
  return {
    kind: "email_reply",
    uid: match[1],
    subjectOverride: match[2]?.trim() || undefined,
    body: match[3].trim(),
  };
}

function extractPendingWhatsAppReplyDraft(text: string): PendingWhatsAppReplyDraft | undefined {
  const match = text.match(/WHATSAPP_REPLY_DRAFT\s*([\s\S]*?)\s*END_WHATSAPP_REPLY_DRAFT/i);
  if (!match?.[1]?.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(match[1].trim()) as PendingWhatsAppReplyDraft;
    if (
      parsed?.kind !== "whatsapp_reply"
      || !parsed.remoteJid?.trim()
      || !parsed.number?.trim()
      || typeof parsed.replyText !== "string"
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function extractPendingActionDraft(text: string): PendingActionDraft | undefined {
  return (
    extractPendingEmailDraft(text)
    ?? extractPendingWhatsAppReplyDraft(text)
    ?? parseJsonDraft<PendingGoogleTaskDraft>(text, "GOOGLE_TASK_DRAFT")
    ?? parseJsonDraft<PendingGoogleEventDraft>(text, "GOOGLE_EVENT_DRAFT")
    ?? parseJsonDraft<PendingGoogleEventUpdateDraft>(text, "GOOGLE_EVENT_UPDATE_DRAFT")
    ?? parseJsonDraft<PendingGoogleEventImportBatchDraft>(text, "GOOGLE_EVENT_IMPORT_BATCH_DRAFT")
    ?? parseJsonDraft<PendingGoogleEventDeleteBatchDraft>(text, "GOOGLE_EVENT_DELETE_BATCH_DRAFT")
    ?? parseJsonDraft<PendingGoogleEventDeleteDraft>(text, "GOOGLE_EVENT_DELETE_DRAFT")
  );
}

export function parsePendingActionDraftPayload(payload: string): PendingActionDraft | undefined {
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    if (!parsed || typeof parsed.kind !== "string") {
      return undefined;
    }

    if (parsed.kind === "email_reply" && typeof parsed.uid === "string" && typeof parsed.body === "string") {
      return {
        kind: "email_reply",
        uid: parsed.uid,
        body: parsed.body,
        subjectOverride: typeof parsed.subjectOverride === "string" ? parsed.subjectOverride : undefined,
      };
    }

    if (
      parsed.kind === "whatsapp_reply"
      && typeof parsed.remoteJid === "string"
      && typeof parsed.number === "string"
      && typeof parsed.inboundText === "string"
      && typeof parsed.replyText === "string"
    ) {
      return {
        kind: "whatsapp_reply",
        instanceName: typeof parsed.instanceName === "string" ? parsed.instanceName : undefined,
        account: typeof parsed.account === "string" ? parsed.account : undefined,
        remoteJid: parsed.remoteJid,
        number: parsed.number,
        pushName: typeof parsed.pushName === "string" ? parsed.pushName : undefined,
        inboundText: parsed.inboundText,
        replyText: parsed.replyText,
        relationship: typeof parsed.relationship === "string" ? parsed.relationship : undefined,
        persona: typeof parsed.persona === "string" ? parsed.persona : undefined,
      };
    }

    if (
      parsed.kind === "monitored_channel_alert"
      && parsed.sourceProvider === "whatsapp"
      && typeof parsed.sourceChannelId === "string"
      && typeof parsed.sourceDisplayName === "string"
      && typeof parsed.sourceRemoteJid === "string"
      && typeof parsed.sourceNumber === "string"
      && typeof parsed.sourceText === "string"
      && typeof parsed.classification === "string"
      && typeof parsed.summary === "string"
      && Array.isArray(parsed.reasons)
      && typeof parsed.suggestedAction === "string"
    ) {
      return parsed as unknown as PendingMonitoredChannelAlertDraft;
    }

    if (
      parsed.kind === "youtube_publish"
      && typeof parsed.contentItemId === "number"
      && typeof parsed.filePath === "string"
      && typeof parsed.title === "string"
      && typeof parsed.description === "string"
    ) {
      return {
        kind: "youtube_publish",
        contentItemId: parsed.contentItemId,
        filePath: parsed.filePath,
        title: parsed.title,
        description: parsed.description,
        privacyStatus:
          parsed.privacyStatus === "private" || parsed.privacyStatus === "unlisted" || parsed.privacyStatus === "public"
            ? parsed.privacyStatus
            : "public",
        tags: Array.isArray(parsed.tags)
          ? parsed.tags.map((value) => String(value).trim()).filter(Boolean).slice(0, 10)
          : [],
      };
    }

    if (parsed.kind === "google_task" && typeof parsed.title === "string") {
      return parsed as unknown as PendingGoogleTaskDraft;
    }

    if (parsed.kind === "google_event" && typeof parsed.summary === "string" && typeof parsed.start === "string" && typeof parsed.end === "string") {
      return parsed as unknown as PendingGoogleEventDraft;
    }

    if (
      parsed.kind === "google_event_update"
      && typeof parsed.eventId === "string"
      && typeof parsed.summary === "string"
      && typeof parsed.start === "string"
      && typeof parsed.end === "string"
    ) {
      return parsed as unknown as PendingGoogleEventUpdateDraft;
    }

    if (parsed.kind === "google_event_delete" && typeof parsed.eventId === "string" && typeof parsed.summary === "string") {
      return parsed as unknown as PendingGoogleEventDeleteDraft;
    }

    if (parsed.kind === "google_event_delete_batch" && Array.isArray(parsed.events) && parsed.events.length > 0) {
      return parsed as unknown as PendingGoogleEventDeleteBatchDraft;
    }

    if (parsed.kind === "google_event_import_batch" && Array.isArray(parsed.events) && parsed.events.length > 0) {
      return parsed as unknown as PendingGoogleEventImportBatchDraft;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function stripPendingDraftMarkers(text: string): string {
  return text
    .replace(/EMAIL_REPLY_DRAFT[\s\S]*?END_EMAIL_REPLY_DRAFT/gi, "")
    .replace(/WHATSAPP_REPLY_DRAFT[\s\S]*?END_WHATSAPP_REPLY_DRAFT/gi, "")
    .replace(/GOOGLE_TASK_DRAFT[\s\S]*?END_GOOGLE_TASK_DRAFT/gi, "")
    .replace(/GOOGLE_EVENT_DRAFT[\s\S]*?END_GOOGLE_EVENT_DRAFT/gi, "")
    .replace(/GOOGLE_EVENT_UPDATE_DRAFT[\s\S]*?END_GOOGLE_EVENT_UPDATE_DRAFT/gi, "")
    .replace(/GOOGLE_EVENT_DELETE_DRAFT[\s\S]*?END_GOOGLE_EVENT_DELETE_DRAFT/gi, "")
    .replace(/GOOGLE_EVENT_IMPORT_BATCH_DRAFT[\s\S]*?END_GOOGLE_EVENT_IMPORT_BATCH_DRAFT/gi, "")
    .replace(/GOOGLE_EVENT_DELETE_BATCH_DRAFT[\s\S]*?END_GOOGLE_EVENT_DELETE_BATCH_DRAFT/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sanitizeToolPayloadLeak(text: string): string {
  const trimmed = text.trim();
  const normalized = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (!(normalized.startsWith("{") && normalized.endsWith("}"))) {
    return text;
  }

  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    const functionName =
      (typeof parsed.function_name === "string" && parsed.function_name)
      || (typeof parsed.name === "string" && parsed.name)
      || undefined;
    const hasArguments = parsed.arguments && typeof parsed.arguments === "object";

    if (!functionName || !hasArguments) {
      return text;
    }

    return [
      "O agente tentou executar uma ferramenta, mas não consolidou a resposta final.",
      `Ferramenta detectada: ${functionName}`,
      "Reformule de forma mais específica ou tente novamente.",
    ].join("\n");
  } catch {
    return text;
  }
}
