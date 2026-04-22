import type { LearnedPreference } from "../types/learned-preferences.js";
import type { OperationalState } from "../types/operational-state.js";
import type { PersonalOperationalProfile } from "../types/personal-operational-memory.js";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(source: string, tokens: string[]): boolean {
  return tokens.some((token) => source.includes(token));
}

export function summarizeIdentityProfileForReasoning(profile: PersonalOperationalProfile) {
  return {
    display_name: profile.displayName,
    primary_role: profile.primaryRole,
    user_role: profile.userRole,
    profession: profile.profession,
    profession_pack_id: profile.professionPackId,
    timezone: profile.timezone,
    preferred_channels: profile.preferredChannels.slice(0, 4),
    preferred_alert_channel: profile.preferredAlertChannel,
    home_address_saved: Boolean(profile.homeAddress),
    home_location_label: profile.homeLocationLabel,
    default_vehicle: profile.defaultVehicle
      ? {
          name: profile.defaultVehicle.name,
          consumption_km_per_liter: profile.defaultVehicle.consumptionKmPerLiter,
          fuel_type: profile.defaultVehicle.fuelType,
        }
      : undefined,
    default_fuel_price_per_liter_saved: typeof profile.defaultFuelPricePerLiter === "number",
    priority_areas: profile.priorityAreas.slice(0, 4),
    routine_summary: profile.routineSummary.slice(0, 4),
    response_style: profile.responseStyle,
    briefing_preference: profile.briefingPreference,
    briefing_profiles: (profile.briefingProfiles ?? []).slice(0, 4).map((item) => ({
      name: item.name,
      time: item.time,
      channel: item.deliveryChannel,
      audience: item.audience,
      style: item.style,
      sections: item.sections.slice(0, 8),
    })),
    audience_policy: profile.audiencePolicy,
    detail_level: profile.detailLevel,
    tone_preference: profile.tonePreference,
    default_operational_mode: profile.defaultOperationalMode,
    default_agenda_scope: profile.defaultAgendaScope,
    mobility_preferences: profile.mobilityPreferences.slice(0, 4),
    autonomy_preferences: profile.autonomyPreferences.slice(0, 4),
    carry_items: profile.attire.carryItems.slice(0, 6),
  };
}

export function summarizeOperationalStateForReasoning(state: OperationalState) {
  return {
    mode: state.mode,
    ...(state.modeReason ? { mode_reason: state.modeReason } : {}),
    focus: state.focus.slice(0, 4),
    weekly_priorities: state.weeklyPriorities.slice(0, 4),
    pending_alerts: state.pendingAlerts.slice(0, 4),
    critical_tasks: state.criticalTasks.slice(0, 4),
    upcoming_commitments: state.upcomingCommitments.slice(0, 4),
    ...(state.primaryRisk ? { primary_risk: state.primaryRisk } : {}),
    operational_signals: state.signals.filter((item) => item.active).slice(0, 4).map((item) => ({
      source: item.source,
      kind: item.kind,
      summary: item.summary,
      priority: item.priority,
      updated_at: item.updatedAt,
    })),
    briefing: state.briefing,
    recent_context: state.recentContext.slice(0, 6),
    ...(state.activeChannel ? { active_channel: state.activeChannel } : {}),
    ...(state.preferredAlertChannel ? { preferred_alert_channel: state.preferredAlertChannel } : {}),
    pending_approvals: state.pendingApprovals,
  };
}

export function selectRelevantLearnedPreferences(
  prompt: string,
  items: LearnedPreference[],
  limit = 4,
): LearnedPreference[] {
  const normalizedPrompt = normalize(prompt);
  if (!normalizedPrompt) {
    return items.slice(0, limit);
  }

  const scored = items.map((item) => {
    const normalizedItem = normalize([item.type, item.key, item.description, item.value].join(" "));
    let score = item.confirmations + item.confidence;
    if (normalizedItem && normalizedPrompt && (
      normalizedPrompt.includes(item.key.toLowerCase())
      || normalizedItem.includes(normalizedPrompt)
      || normalizedPrompt.includes(normalizedItem)
    )) {
      score += 5;
    }

    if (
      item.type === "schedule_import_mode"
      && includesAny(normalizedPrompt, ["agenda", "pdf", "print", "imagem", "importa"])
    ) {
      score += 3;
    }
    if (
      item.type === "agenda_scope"
      && includesAny(normalizedPrompt, ["agenda", "calendario", "abordagem", "principal"])
    ) {
      score += 3;
    }
    if (
      item.type === "response_style"
      && includesAny(normalizedPrompt, ["briefing", "resposta", "tom", "estilo"])
    ) {
      score += 2;
    }
    if (
      item.type === "visual_task"
      && includesAny(normalizedPrompt, ["print", "pdf", "imagem", "visual"])
    ) {
      score += 2;
    }

    return {
      item,
      score,
    };
  });

  return scored
    .sort((left, right) => right.score - left.score || right.item.confirmations - left.item.confirmations)
    .slice(0, limit)
    .map((entry) => entry.item);
}
