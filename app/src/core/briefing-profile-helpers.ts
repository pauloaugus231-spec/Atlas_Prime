import { randomUUID } from "node:crypto";
import type { IdentityProfile } from "../types/identity-profile.js";
import {
  BRIEFING_AUDIENCES,
  BRIEFING_DELIVERY_CHANNELS,
  BRIEFING_DELIVERY_MODES,
  BRIEFING_PROFILE_STYLES,
  BRIEFING_SECTION_KEYS,
  type BriefingAudience,
  type BriefingDeliveryChannel,
  type BriefingDeliveryMode,
  type BriefingProfile,
  type BriefingProfileStyle,
  type BriefingSectionKey,
} from "../types/briefing-profile.js";

export const DEFAULT_BRIEFING_PROFILE_ID = "default-morning-brief";
export const DEFAULT_BRIEFING_WEEKDAYS = [1, 2, 3, 4, 5] as const;
export const EVERYDAY_BRIEFING_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export const DEFAULT_SELF_BRIEFING_SECTIONS: BriefingSectionKey[] = [
  "weather",
  "focus",
  "next_action",
  "autonomy",
  "goals",
  "agenda",
  "emails",
  "tasks",
  "approvals",
  "workflows",
  "motivation",
];
export const DEFAULT_TEAM_BRIEFING_SECTIONS: BriefingSectionKey[] = [
  "weather",
  "focus",
  "next_action",
  "goals",
  "agenda",
  "workflows",
  "motivation",
];

interface NormalizeBriefingProfileDefaults {
  time: string;
  timezone: string;
  deliveryChannel: BriefingDeliveryChannel;
  style: BriefingProfileStyle;
}

function normalize(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeStringList(value: string[] | undefined, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const next = [...new Set(value.map((item) => item.trim()).filter(Boolean))];
  return next.length > 0 ? next : [...fallback];
}

function normalizeTime(value: string | undefined, fallback: string): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return fallback;
  }

  const match = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (!match?.[1] || !match[2]) {
    return fallback;
  }

  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return fallback;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeWeekdays(value: number[] | undefined): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [...DEFAULT_BRIEFING_WEEKDAYS];
  }

  const next = [...new Set(value
    .map((item) => Math.floor(Number(item)))
    .filter((item) => Number.isFinite(item) && item >= 0 && item <= 6))]
    .sort((left, right) => left - right);

  return next.length > 0 ? next : [...DEFAULT_BRIEFING_WEEKDAYS];
}

function normalizeStyle(value: BriefingProfileStyle | undefined, fallback: BriefingProfileStyle): BriefingProfileStyle {
  return BRIEFING_PROFILE_STYLES.includes(value ?? "auto") ? (value ?? fallback) : fallback;
}

function normalizeDeliveryChannel(
  value: BriefingDeliveryChannel | undefined,
  fallback: BriefingDeliveryChannel,
): BriefingDeliveryChannel {
  return BRIEFING_DELIVERY_CHANNELS.includes(value ?? "telegram") ? (value ?? fallback) : fallback;
}

function normalizeDeliveryMode(
  value: BriefingDeliveryMode | undefined,
  fallback: BriefingDeliveryMode,
): BriefingDeliveryMode {
  return BRIEFING_DELIVERY_MODES.includes(value ?? "both") ? (value ?? fallback) : fallback;
}

function normalizeAudience(value: BriefingAudience | undefined, fallback: BriefingAudience): BriefingAudience {
  return BRIEFING_AUDIENCES.includes(value ?? "self") ? (value ?? fallback) : fallback;
}

function normalizeSections(value: BriefingSectionKey[] | undefined, fallback: BriefingSectionKey[]): BriefingSectionKey[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const next = [...new Set(value.filter((item): item is BriefingSectionKey => BRIEFING_SECTION_KEYS.includes(item)))];
  return next.length > 0 ? next : [...fallback];
}

function dedupeAliases(name: string, aliases: string[] | undefined): string[] {
  return [...new Set([name, ...(aliases ?? [])].map((item) => item.trim()).filter(Boolean))];
}

function fallbackSectionsForAudience(audience: BriefingAudience): BriefingSectionKey[] {
  return audience === "team"
    ? [...DEFAULT_TEAM_BRIEFING_SECTIONS]
    : [...DEFAULT_SELF_BRIEFING_SECTIONS];
}

export function inferBriefingName(input: {
  time: string;
  audience?: BriefingAudience;
  explicitName?: string;
}): string {
  const explicit = normalizeOptionalString(input.explicitName);
  if (explicit) {
    return explicit;
  }

  const hour = Number.parseInt(input.time.slice(0, 2), 10);
  if (input.audience === "team") {
    return hour < 12 ? "briefing da equipe" : hour < 18 ? "briefing da equipe da tarde" : "briefing da equipe da noite";
  }

  if (hour < 12) {
    return "briefing da manhã";
  }
  if (hour < 18) {
    return "briefing da tarde";
  }
  return "briefing da noite";
}

function buildDefaultAliases(name: string, audience: BriefingAudience): string[] {
  const aliases = [name];
  if (audience === "team") {
    aliases.push("briefing da equipe");
  } else {
    aliases.push("briefing da manhã", "briefing matinal", "briefing");
  }
  return dedupeAliases(name, aliases);
}

export function createDefaultBriefingProfile(input: {
  time: string;
  timezone: string;
  deliveryChannel?: BriefingDeliveryChannel;
  style?: BriefingProfileStyle;
  audience?: BriefingAudience;
  name?: string;
}): BriefingProfile {
  const audience = input.audience ?? "self";
  const name = inferBriefingName({
    time: input.time,
    audience,
    explicitName: input.name,
  });
  return {
    id: DEFAULT_BRIEFING_PROFILE_ID,
    name,
    aliases: buildDefaultAliases(name, audience),
    enabled: true,
    deliveryMode: "both",
    deliveryChannel: input.deliveryChannel ?? "telegram",
    audience,
    targetRecipientIds: [],
    time: normalizeTime(input.time, "06:30"),
    weekdays: [...DEFAULT_BRIEFING_WEEKDAYS],
    timezone: input.timezone,
    style: input.style ?? "executive",
    sections: fallbackSectionsForAudience(audience),
  };
}

export function normalizeBriefingProfile(
  value: Partial<BriefingProfile> | undefined,
  defaults: NormalizeBriefingProfileDefaults,
): BriefingProfile {
  const audience = normalizeAudience(value?.audience, "self");
  const time = normalizeTime(value?.time, defaults.time);
  const name = inferBriefingName({
    time,
    audience,
    explicitName: normalizeOptionalString(value?.name),
  });
  return {
    id: normalizeOptionalString(value?.id) ?? randomUUID(),
    name,
    aliases: dedupeAliases(name, normalizeStringList(value?.aliases, buildDefaultAliases(name, audience))),
    enabled: value?.enabled !== false,
    deliveryMode: normalizeDeliveryMode(value?.deliveryMode, "both"),
    deliveryChannel: normalizeDeliveryChannel(value?.deliveryChannel, defaults.deliveryChannel),
    audience,
    targetRecipientIds: normalizeStringList(value?.targetRecipientIds),
    ...(normalizeOptionalString(value?.targetLabel) ? { targetLabel: normalizeOptionalString(value?.targetLabel) } : {}),
    time,
    weekdays: normalizeWeekdays(value?.weekdays),
    ...(normalizeOptionalString(value?.timezone) ? { timezone: normalizeOptionalString(value?.timezone) } : { timezone: defaults.timezone }),
    style: normalizeStyle(value?.style, defaults.style),
    sections: normalizeSections(value?.sections, fallbackSectionsForAudience(audience)),
  };
}

export function normalizeBriefingProfiles(
  value: Partial<BriefingProfile>[] | undefined,
  defaults: NormalizeBriefingProfileDefaults,
): BriefingProfile[] {
  const source = Array.isArray(value) && value.length > 0
    ? value
    : [createDefaultBriefingProfile(defaults)];

  const normalized: BriefingProfile[] = [];
  const seenIds = new Set<string>();
  for (const item of source) {
    const next = normalizeBriefingProfile(item, defaults);
    if (seenIds.has(next.id)) {
      continue;
    }
    seenIds.add(next.id);
    normalized.push(next);
  }

  const hasDefault = normalized.some((item) => item.id === DEFAULT_BRIEFING_PROFILE_ID);
  if (!hasDefault) {
    normalized.unshift(createDefaultBriefingProfile(defaults));
  }

  return normalized;
}

export function syncBriefingProfilesWithLegacyProfile(profile: Pick<
  IdentityProfile,
  "briefingProfiles" | "morningBriefTime" | "timezone" | "briefingPreference" | "detailLevel" | "preferredAlertChannel"
>): BriefingProfile[] {
  const style: BriefingProfileStyle = profile.briefingPreference === "detalhado" || profile.detailLevel === "detalhado"
    ? "detailed"
    : profile.briefingPreference === "curto" || profile.detailLevel === "resumo"
      ? "compact"
      : "executive";

  const profiles = normalizeBriefingProfiles(profile.briefingProfiles, {
    time: profile.morningBriefTime ?? "06:30",
    timezone: profile.timezone,
    deliveryChannel: normalizeDeliveryChannel(
      profile.preferredAlertChannel === "whatsapp" || profile.preferredAlertChannel === "email"
        ? profile.preferredAlertChannel
        : "telegram",
      "telegram",
    ),
    style,
  });

  return profiles.map((item) => item.id === DEFAULT_BRIEFING_PROFILE_ID
    ? {
        ...item,
        time: normalizeTime(profile.morningBriefTime ?? item.time, item.time),
        timezone: normalizeOptionalString(profile.timezone) ?? item.timezone,
        style,
      }
    : item);
}

function promptHasRequestVerb(prompt: string): boolean {
  const normalizedPrompt = normalize(prompt);
  return ["mostra", "mostrar", "gere", "gera", "manda", "envia", "traz", "quero", "me da", "me de", "preciso"].some((token) => normalizedPrompt.includes(token));
}

export function findDefaultBriefingProfile(profiles: BriefingProfile[]): BriefingProfile | undefined {
  return profiles.find((item) => item.id === DEFAULT_BRIEFING_PROFILE_ID && item.enabled)
    ?? profiles.find((item) => item.enabled && item.audience === "self")
    ?? profiles.find((item) => item.enabled)
    ?? profiles[0];
}

export function findMatchingBriefingProfile(profiles: BriefingProfile[], prompt: string): BriefingProfile | undefined {
  const normalizedPrompt = normalize(prompt);
  if (!normalizedPrompt) {
    return findDefaultBriefingProfile(profiles);
  }

  const wantsBriefing = normalizedPrompt.includes("briefing") || promptHasRequestVerb(prompt);
  if (!wantsBriefing) {
    return undefined;
  }

  for (const profile of profiles) {
    const names = [profile.name, ...profile.aliases]
      .map((item) => normalize(item))
      .filter(Boolean);
    if (names.some((item) => normalizedPrompt.includes(item))) {
      return profile;
    }
  }

  if (normalizedPrompt.includes("equipe")) {
    return profiles.find((item) => item.audience === "team") ?? findDefaultBriefingProfile(profiles);
  }

  return normalizedPrompt.includes("briefing") ? findDefaultBriefingProfile(profiles) : undefined;
}

export function formatBriefingWeekdays(weekdays: number[]): string {
  const normalized = normalizeWeekdays(weekdays);
  if (normalized.length === 7) {
    return "todos os dias";
  }
  if (normalized.join(",") === DEFAULT_BRIEFING_WEEKDAYS.join(",")) {
    return "dias úteis";
  }

  const labels = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  return normalized.map((item) => labels[item] ?? String(item)).join(", ");
}

export function formatBriefingProfileSummary(profile: BriefingProfile): string {
  return [
    profile.enabled ? profile.name : `${profile.name} (desativado)`,
    `${profile.time}`,
    `${profile.deliveryChannel}/${profile.audience}`,
    formatBriefingWeekdays(profile.weekdays),
    profile.style,
  ].join(" | ");
}

export function upsertBriefingProfile(profiles: BriefingProfile[], next: BriefingProfile): BriefingProfile[] {
  const remaining = profiles.filter((item) => item.id !== next.id);
  return normalizeBriefingProfiles([...(next.id === DEFAULT_BRIEFING_PROFILE_ID ? [next] : []), ...remaining, ...(next.id === DEFAULT_BRIEFING_PROFILE_ID ? [] : [next])], {
    time: next.time,
    timezone: next.timezone ?? "America/Sao_Paulo",
    deliveryChannel: next.deliveryChannel,
    style: next.style,
  });
}
