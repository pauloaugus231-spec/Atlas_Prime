import type { AgentRunResult } from "./agent-core.js";
import type { ExecutiveMorningBrief } from "./personal-os.js";
import type { DailyOperationalBrief } from "../integrations/google/google-workspace.js";
import type { ConversationMessage } from "../types/llm.js";
import type { Logger } from "../types/logger.js";
import type { LearnedPreference, LearnedPreferenceType } from "../types/learned-preferences.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type {
  PersonalOperationalMemoryItem,
  PersonalOperationalMemoryItemKind,
  PersonalOperationalProfile,
  UpdatePersonalOperationalProfileInput,
} from "../types/personal-operational-memory.js";
import type { OperationalState } from "../types/operational-state.js";
import type { UpdateUserPreferencesInput, UserPreferences } from "../types/user-preferences.js";
import type { ActiveGoal } from "./goal-store.js";
import type { BriefingProfile } from "../types/briefing-profile.js";

interface GoogleWorkspaceStatusLike {
  ready: boolean;
  message: string;
}

interface GoogleWorkspaceLike {
  getStatus: () => GoogleWorkspaceStatusLike;
  getDailyBrief: () => Promise<DailyOperationalBrief>;
}

interface OperationalMemoryLike {
  getDailyFocus: (limit: number) => Array<{
    item: { title: string };
    whyNow: string;
    nextAction: string;
  }>;
}

interface PersonalOsLike {
  getExecutiveMorningBrief: () => Promise<ExecutiveMorningBrief>;
}

interface ProfessionBootstrapLike {
  buildBootstrapPatch: (profile: PersonalOperationalProfile) => UpdatePersonalOperationalProfileInput;
  summarize: (profile: PersonalOperationalProfile) => string | undefined;
}

interface AccountLinkingLike {
  renderOverview: () => string;
  startConnection: (input?: {
    provider?: "google";
    channel?: "telegram" | "whatsapp" | "web" | "cli";
    permissionKeys?: string[];
  }) => { reply: string };
  revokeConnection: (providerId: "google") => string;
}

interface DestinationRegistryLike {
  renderList: () => string;
  resolve: (query: string) => {
    label: string;
    channel: BriefingProfile["deliveryChannel"];
    audience: "self" | "team" | "external";
    address: string;
    maxPrivacyLevel: "private" | "team_shareable" | "restricted" | "public";
  } | undefined;
  upsert: (input: {
    label: string;
    aliases?: string[];
    kind: "telegram_chat" | "whatsapp_chat" | "email_recipient";
    channel: BriefingProfile["deliveryChannel"];
    address: string;
    audience: "self" | "team" | "external";
    maxPrivacyLevel: "private" | "team_shareable" | "restricted" | "public";
  }) => {
    label: string;
    channel: BriefingProfile["deliveryChannel"];
    address: string;
    audience: "self" | "team" | "external";
  };
}

interface SharedBriefingComposerLike {
  compose: (input: {
    profile: BriefingProfile;
    brief: ExecutiveMorningBrief;
    personalProfile: PersonalOperationalProfile;
    maxPrivacyLevel?: "private" | "team_shareable" | "restricted" | "public";
  }) => {
    reply: string;
    removedSections: string[];
    blocked: boolean;
  };
}

interface CommandCenterLike {
  render: () => Promise<string>;
}

interface BriefingProfilesLike {
  resolveProfileForPrompt: (prompt: string) => BriefingProfile | undefined;
  render: (input?: { profileId?: string; prompt?: string }) => Promise<{
    profile: BriefingProfile;
    brief: ExecutiveMorningBrief;
    reply: string;
  }>;
}

interface PreferencesLike {
  get: () => UserPreferences;
  update: (input: UpdateUserPreferencesInput) => UserPreferences;
}

interface PersonalMemoryLike {
  getProfile: () => PersonalOperationalProfile;
  getOperationalState: () => OperationalState;
  findLearnedPreferences: (query: string, limit?: number) => LearnedPreference[];
  findItems: (query: string, limit?: number) => PersonalOperationalMemoryItem[];
}

interface GoalStoreLike {
  list: () => ActiveGoal[];
  get: (id: string) => ActiveGoal | undefined;
  upsert: (goal: Omit<ActiveGoal, "id" | "createdAt" | "updatedAt"> & { id?: string }) => ActiveGoal;
  updateProgress: (id: string, progress: number) => ActiveGoal | undefined;
  remove: (id: string) => boolean;
  summarize: () => string;
}

interface ToolExecutionResult {
  requestId: string;
  content: string;
  rawResult: unknown;
}

interface ProfileUpdateExtraction {
  profile: UpdatePersonalOperationalProfileInput;
  changeLabels: string[];
  preferenceUpdate?: UpdateUserPreferencesInput;
}

interface ProfileRemovalResult {
  profileUpdate: UpdatePersonalOperationalProfileInput;
  removedLabels: string[];
}

interface OperationalContextDirectHelpers {
  isOperationalBriefPrompt: (prompt: string) => boolean;
  buildOperationalBriefReply: (input: {
    brief: DailyOperationalBrief;
    focus: Array<{ title: string; whyNow: string; nextAction: string }>;
  }) => string;
  isMorningBriefPrompt: (prompt: string) => boolean;
  buildMorningBriefReply: (
    brief: ExecutiveMorningBrief,
    options?: {
      compact?: boolean;
      profile?: PersonalOperationalProfile;
      operationalMode?: "field" | null;
    },
  ) => string;
  resolveEffectiveOperationalMode: (
    prompt: string,
    profile: PersonalOperationalProfile,
  ) => "field" | null;
  isPersonalOperationalProfileShowPrompt: (prompt: string) => boolean;
  buildPersonalOperationalProfileReply: (profile: PersonalOperationalProfile) => string;
  isOperationalStateShowPrompt: (prompt: string) => boolean;
  buildOperationalStateReply: (state: OperationalState) => string;
  isLearnedPreferencesListPrompt: (prompt: string) => boolean;
  resolveLearnedPreferencesListFilter: (prompt: string) => {
    type?: LearnedPreferenceType;
    search?: string;
  };
  buildLearnedPreferencesReply: (items: LearnedPreference[]) => string;
  isLearnedPreferencesDeletePrompt: (prompt: string) => boolean;
  extractLearnedPreferenceId: (prompt: string) => number | undefined;
  extractLearnedPreferenceDeleteTarget: (prompt: string) => string | undefined;
  buildLearnedPreferenceDeactivatedReply: (item: LearnedPreference) => string;
  isPersonalOperationalProfileUpdatePrompt: (prompt: string) => boolean;
  extractPersonalOperationalProfileUpdate: (
    prompt: string,
    currentProfile: PersonalOperationalProfile,
  ) => ProfileUpdateExtraction | null;
  buildPersonalOperationalProfileUpdatedReply: (
    profile: PersonalOperationalProfile,
    changeLabels: string[],
  ) => string;
  isPersonalOperationalProfileDeletePrompt: (prompt: string) => boolean;
  extractPersonalOperationalProfileRemoveQuery: (prompt: string) => string | undefined;
  removeFromPersonalOperationalProfile: (
    profile: PersonalOperationalProfile,
    query: string,
  ) => ProfileRemovalResult | null;
  buildPersonalOperationalProfileRemovedReply: (
    profile: PersonalOperationalProfile,
    removedLabels: string[],
  ) => string;
  isPersonalMemoryListPrompt: (prompt: string) => boolean;
  buildPersonalMemoryListReply: (input: {
    profile: PersonalOperationalProfile;
    items: PersonalOperationalMemoryItem[];
  }) => string;
  isPersonalMemorySavePrompt: (prompt: string) => boolean;
  extractPersonalMemoryStatement: (prompt: string) => string | undefined;
  inferPersonalMemoryKind: (statement: string) => PersonalOperationalMemoryItemKind;
  buildPersonalMemoryTitle: (statement: string, kind: PersonalOperationalMemoryItemKind) => string;
  buildPersonalMemorySavedReply: (item: PersonalOperationalMemoryItem) => string;
  isPersonalMemoryUpdatePrompt: (prompt: string) => boolean;
  extractPersonalMemoryId: (prompt: string) => number | undefined;
  extractPersonalMemoryUpdateTarget: (prompt: string) => string | undefined;
  extractPersonalMemoryUpdateContent: (prompt: string) => string | undefined;
  buildPersonalMemoryAmbiguousReply: (query: string, items: PersonalOperationalMemoryItem[]) => string;
  buildPersonalMemoryUpdatedReply: (item: PersonalOperationalMemoryItem) => string;
  isPersonalMemoryDeletePrompt: (prompt: string) => boolean;
  extractPersonalMemoryDeleteTarget: (prompt: string) => string | undefined;
  buildPersonalMemoryDeletedReply: (item: PersonalOperationalMemoryItem) => string;
}

export interface OperationalContextDirectServiceDependencies {
  logger: Logger;
  googleWorkspace: GoogleWorkspaceLike;
  memory: OperationalMemoryLike;
  personalOs: PersonalOsLike;
  briefingProfiles: BriefingProfilesLike;
  preferences: PreferencesLike;
  personalMemory: PersonalMemoryLike;
  goalStore: GoalStoreLike;
  professionBootstrap?: ProfessionBootstrapLike;
  accountLinking?: AccountLinkingLike;
  destinationRegistry?: DestinationRegistryLike;
  sharedBriefingComposer?: SharedBriefingComposerLike;
  commandCenter?: CommandCenterLike;
  executeToolDirect: (toolName: string, rawArguments: unknown) => Promise<ToolExecutionResult>;
  buildBaseMessages: (
    userPrompt: string,
    orchestration: OrchestrationContext,
    preferences?: UserPreferences,
  ) => ConversationMessage[];
  helpers: OperationalContextDirectHelpers;
}

interface OperationalContextDirectInput {
  userPrompt: string;
  requestId: string;
  orchestration: OrchestrationContext;
  preferences?: UserPreferences;
  requestLogger?: Logger;
}

function normalizePrompt(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(value: string, tokens: string[]): boolean {
  return tokens.some((token) => value.includes(token));
}

function isCommandCenterPrompt(prompt: string): boolean {
  const normalized = normalizePrompt(prompt);
  return includesAny(normalized, [
    "painel",
    "meu painel",
    "como esta minha operacao",
    "como está minha operação",
    "o que esta pegando",
    "o que está pegando",
    "status da operacao",
    "status da operação",
  ]);
}

function isConnectionOverviewPrompt(prompt: string): boolean {
  const normalized = normalizePrompt(prompt);
  return includesAny(normalized, [
    "minhas permissoes",
    "minhas permissões",
    "quais contas estao conectadas",
    "quais contas estão conectadas",
    "conexoes",
    "conexões",
  ]);
}

function isConnectionStartPrompt(prompt: string): boolean {
  const normalized = normalizePrompt(prompt);
  return includesAny(normalized, [
    "conectar google",
    "ligar google",
    "autorizar google",
    "adicionar google",
  ]);
}

function isConnectionRevokePrompt(prompt: string): boolean {
  const normalized = normalizePrompt(prompt);
  return includesAny(normalized, [
    "desconectar google",
    "remover google",
    "revogar google",
  ]);
}

function isDestinationListPrompt(prompt: string): boolean {
  const normalized = normalizePrompt(prompt);
  return includesAny(normalized, [
    "quais destinos eu tenho",
    "destinos cadastrados",
    "canais de entrega",
    "meus destinos",
  ]);
}

function isSharedBriefingPreviewPrompt(prompt: string): boolean {
  const normalized = normalizePrompt(prompt);
  return includesAny(normalized, [
    "briefing compartilhavel",
    "briefing compartilhável",
    "versao compartilhavel",
    "versão compartilhável",
    "preview da equipe",
  ]);
}

function parseDestinationRegistration(prompt: string): {
  label: string;
  aliases?: string[];
  kind: "telegram_chat" | "whatsapp_chat" | "email_recipient";
  channel: BriefingProfile["deliveryChannel"];
  address: string;
  audience: "self" | "team" | "external";
  maxPrivacyLevel: "private" | "team_shareable" | "restricted" | "public";
} | undefined {
  const normalized = normalizePrompt(prompt);
  if (!includesAny(normalized, ["cadastre destino", "cadastrar destino", "cadastre minha equipe", "registre destino"])) {
    return undefined;
  }

  const emailMatch = prompt.match(/(?:email|e-mail)\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  if (emailMatch?.[1]) {
    const labelMatch = prompt.match(/(?:destino|equipe|grupo)\s+(.+?)\s+(?:no|por)\s+e-?mail/i);
    return {
      label: labelMatch?.[1]?.trim() || "destino por email",
      aliases: ["minha equipe"],
      kind: "email_recipient",
      channel: "email",
      address: emailMatch[1].trim(),
      audience: normalized.includes("equipe") ? "team" : "external",
      maxPrivacyLevel: normalized.includes("restrito") ? "restricted" : normalized.includes("publico") || normalized.includes("público") ? "public" : "team_shareable",
    };
  }

  const telegramMatch = prompt.match(/telegram\s+(-?\d{5,})/i);
  if (telegramMatch?.[1]) {
    const labelMatch = prompt.match(/(?:destino|equipe|grupo)\s+(.+?)\s+(?:no|por)\s+telegram/i);
    return {
      label: labelMatch?.[1]?.trim() || "destino no telegram",
      aliases: ["minha equipe"],
      kind: "telegram_chat",
      channel: "telegram",
      address: telegramMatch[1].trim(),
      audience: normalized.includes("equipe") ? "team" : "self",
      maxPrivacyLevel: normalized.includes("privado") ? "private" : "team_shareable",
    };
  }

  const whatsappMatch = prompt.match(/whatsapp\s+(\+?\d{8,})/i);
  if (whatsappMatch?.[1]) {
    const labelMatch = prompt.match(/(?:destino|equipe|grupo)\s+(.+?)\s+(?:no|por)\s+whatsapp/i);
    return {
      label: labelMatch?.[1]?.trim() || "destino no whatsapp",
      aliases: ["minha equipe"],
      kind: "whatsapp_chat",
      channel: "whatsapp",
      address: whatsappMatch[1].trim(),
      audience: normalized.includes("equipe") ? "team" : "self",
      maxPrivacyLevel: normalized.includes("privado") ? "private" : "team_shareable",
    };
  }

  return undefined;
}

function mergeProfileDraft(current: PersonalOperationalProfile, patch: UpdatePersonalOperationalProfileInput): PersonalOperationalProfile {
  return {
    ...current,
    ...patch,
    preferredChannels: patch.preferredChannels ?? current.preferredChannels,
    priorityAreas: patch.priorityAreas ?? current.priorityAreas,
    mobilityPreferences: patch.mobilityPreferences ?? current.mobilityPreferences,
    autonomyPreferences: patch.autonomyPreferences ?? current.autonomyPreferences,
    savedFocus: patch.savedFocus ?? current.savedFocus,
    routineAnchors: patch.routineAnchors ?? current.routineAnchors,
    operationalRules: patch.operationalRules ?? current.operationalRules,
    workCalendarAliases: patch.workCalendarAliases ?? current.workCalendarAliases,
    routineSummary: patch.routineSummary ?? current.routineSummary,
    briefingProfiles: patch.briefingProfiles ?? current.briefingProfiles,
    audiencePolicy: patch.audiencePolicy ?? current.audiencePolicy,
    defaultVehicle: patch.defaultVehicle ? { ...current.defaultVehicle, ...patch.defaultVehicle } : current.defaultVehicle,
    attire: patch.attire ? { ...current.attire, ...patch.attire } : current.attire,
  };
}

function isGoalListPrompt(prompt: string): boolean {
  const normalized = normalizePrompt(prompt);
  return includesAny(normalized, [
    "mostre meus objetivos",
    "mostrar meus objetivos",
    "meus objetivos ativos",
    "objetivos ativos",
    "quais sao meus objetivos",
    "quais sao minhas metas",
    "liste meus objetivos",
    "listar meus objetivos",
    "liste minhas metas",
    "minhas metas ativas",
  ]);
}

function isGoalSavePrompt(prompt: string): boolean {
  const normalized = normalizePrompt(prompt);
  return includesAny(normalized, [
    "salve meu objetivo",
    "salvar meu objetivo",
    "registre meu objetivo",
    "registre minha meta",
    "adicione meu objetivo",
    "adicione uma meta",
    "crie um objetivo",
    "crie uma meta",
    "defina meu objetivo",
    "defina minha meta",
    "meu objetivo agora e",
    "meu objetivo e",
    "minha meta agora e",
    "minha meta e",
  ]);
}

function isGoalProgressUpdatePrompt(prompt: string): boolean {
  const normalized = normalizePrompt(prompt);
  return /\b\d{1,3}%/.test(normalized) && includesAny(normalized, [
    "objetivo",
    "meta",
    "progresso",
  ]);
}

function isGoalDeletePrompt(prompt: string): boolean {
  const normalized = normalizePrompt(prompt);
  return includesAny(normalized, [
    "remova meu objetivo",
    "remover meu objetivo",
    "apague meu objetivo",
    "delete meu objetivo",
    "exclua meu objetivo",
    "remova minha meta",
    "apague minha meta",
    "delete minha meta",
    "exclua minha meta",
  ]);
}

function parseIsoDateCandidate(value: string): string | undefined {
  const isoMatch = value.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch?.[1]) {
    return isoMatch[1];
  }

  const brMatch = value.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/);
  if (!brMatch) {
    return undefined;
  }

  const day = Number.parseInt(brMatch[1] ?? "", 10);
  const month = Number.parseInt(brMatch[2] ?? "", 10);
  const year = Number.parseInt(brMatch[3] ?? String(new Date().getFullYear()), 10);
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) {
    return undefined;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return undefined;
  }

  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function extractGoalProgress(prompt: string): number | undefined {
  const match = prompt.match(/\b(\d{1,3})%/);
  if (!match?.[1]) {
    return undefined;
  }
  const value = Number.parseInt(match[1], 10);
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.min(100, value)) / 100;
}

function inferGoalDomain(statement: string): ActiveGoal["domain"] {
  const normalized = normalizePrompt(statement);
  if (includesAny(normalized, ["receita", "cliente", "clientes", "mrr", "venda", "faturamento", "saas"])) {
    return "revenue";
  }
  if (includesAny(normalized, ["produto", "mvp", "funcionalidade", "feature", "app", "plataforma"])) {
    return "product";
  }
  if (includesAny(normalized, ["conteudo", "conteudo", "youtube", "instagram", "tiktok", "canal"])) {
    return "content";
  }
  if (includesAny(normalized, ["rotina", "saude", "família", "familia", "pessoal", "estudo", "prova"])) {
    return "personal";
  }
  if (includesAny(normalized, ["operacao", "operação", "processo", "equipe", "agenda", "monitoramento"])) {
    return "ops";
  }
  return "other";
}

function extractGoalStatement(prompt: string): string | undefined {
  const cleaned = prompt
    .replace(/^\s*(?:salve|registre|adicione|crie|defina)\s+(?:um\s+|uma\s+|meu\s+|minha\s+)?(?:objetivo|meta)\s*(?:de|para|:)?\s*/i, "")
    .replace(/^\s*minha\s+meta(?:\s+agora)?\s+[ée]\s*/i, "")
    .replace(/^\s*meu\s+objetivo(?:\s+agora)?\s+[ée]\s*/i, "")
    .replace(/[.]+$/g, "")
    .trim();
  return cleaned || undefined;
}

function extractGoalTitle(statement: string): string | undefined {
  const stripped = statement
    .replace(/\b(?:ate|até)\s+\d{1,2}\/\d{1,2}(?:\/20\d{2})?\b.*$/i, "")
    .replace(/\b(?:ate|até)\s+20\d{2}-\d{2}-\d{2}\b.*$/i, "")
    .replace(/\b(?:com|de)\s+\d{1,3}%\b.*$/i, "")
    .replace(/\bprogresso\s+\d{1,3}%\b.*$/i, "")
    .trim();
  return stripped || undefined;
}

function extractGoalMetric(statement: string): string | undefined {
  const metricMatch = statement.match(/\b(?:metrica|métrica|medida|indicador)\s*:\s*(.+)$/i);
  return metricMatch?.[1]?.trim() || undefined;
}

function resolveGoalReference(prompt: string): string | undefined {
  const hashMatch = prompt.match(/#([a-z0-9-]{4,36})/i);
  if (hashMatch?.[1]) {
    return hashMatch[1].trim();
  }

  const cleaned = prompt
    .replace(/^\s*(?:remova|remover|apague|delete|exclua|atualize|marque|ajuste|defina)\s+(?:meu\s+|minha\s+)?(?:objetivo|meta)\s*/i, "")
    .replace(/\b(?:para|com|em)\s+\d{1,3}%.*$/i, "")
    .trim();
  return cleaned || undefined;
}

function findGoalByReference(goals: ActiveGoal[], reference: string): ActiveGoal[] {
  const normalized = normalizePrompt(reference);
  return goals.filter((goal) =>
    goal.id.toLowerCase() === normalized
    || goal.id.toLowerCase().startsWith(normalized)
    || normalizePrompt(goal.title).includes(normalized),
  );
}

function formatGoalLine(goal: ActiveGoal, index?: number): string {
  const shortId = goal.id.slice(0, 8);
  const parts = [
    `${index !== undefined ? `(${index + 1}) ` : ""}#${shortId} — ${goal.title}`,
    goal.domain,
  ];
  if (goal.deadline) {
    parts.push(`prazo ${goal.deadline}`);
  }
  if (goal.progress != null) {
    parts.push(`${Math.round(goal.progress * 100)}%`);
  }
  if (goal.metric) {
    parts.push(`métrica: ${goal.metric}`);
  }
  return parts.join(" | ");
}

function buildProfileUpdateToolArguments(profile: UpdatePersonalOperationalProfileInput): Record<string, unknown> {
  return {
    ...(profile.displayName ? { displayName: profile.displayName } : {}),
    ...(profile.primaryRole ? { primaryRole: profile.primaryRole } : {}),
    ...(profile.userRole ? { userRole: profile.userRole } : {}),
    ...(profile.profession ? { profession: profile.profession } : {}),
    ...(profile.professionPackId ? { professionPackId: profile.professionPackId } : {}),
    ...(profile.routineSummary ? { routineSummary: profile.routineSummary } : {}),
    ...(profile.timezone ? { timezone: profile.timezone } : {}),
    ...(profile.preferredChannels ? { preferredChannels: profile.preferredChannels } : {}),
    ...(profile.preferredAlertChannel ? { preferredAlertChannel: profile.preferredAlertChannel } : {}),
    ...(profile.audiencePolicy ? { audiencePolicy: profile.audiencePolicy } : {}),
    ...(profile.homeAddress ? { homeAddress: profile.homeAddress } : {}),
    ...(profile.homeLocationLabel ? { homeLocationLabel: profile.homeLocationLabel } : {}),
    ...(profile.defaultVehicle ? { defaultVehicle: profile.defaultVehicle } : {}),
    ...(typeof profile.defaultFuelPricePerLiter === "number" ? { defaultFuelPricePerLiter: profile.defaultFuelPricePerLiter } : {}),
    ...(profile.priorityAreas ? { priorityAreas: profile.priorityAreas } : {}),
    ...(profile.defaultAgendaScope ? { defaultAgendaScope: profile.defaultAgendaScope } : {}),
    ...(profile.responseStyle ? { responseStyle: profile.responseStyle } : {}),
    ...(profile.briefingPreference ? { briefingPreference: profile.briefingPreference } : {}),
    ...(profile.morningBriefTime ? { morningBriefTime: profile.morningBriefTime } : {}),
    ...(profile.briefingProfiles ? { briefingProfiles: profile.briefingProfiles } : {}),
    ...(profile.detailLevel ? { detailLevel: profile.detailLevel } : {}),
    ...(profile.tonePreference ? { tonePreference: profile.tonePreference } : {}),
    ...(profile.defaultOperationalMode ? { defaultOperationalMode: profile.defaultOperationalMode } : {}),
    ...(profile.mobilityPreferences ? { mobilityPreferences: profile.mobilityPreferences } : {}),
    ...(profile.autonomyPreferences ? { autonomyPreferences: profile.autonomyPreferences } : {}),
    ...(profile.savedFocus ? { savedFocus: profile.savedFocus } : {}),
    ...(profile.routineAnchors ? { routineAnchors: profile.routineAnchors } : {}),
    ...(profile.operationalRules ? { operationalRules: profile.operationalRules } : {}),
    ...(profile.attire?.carryItems ? { carryItems: profile.attire.carryItems } : {}),
    ...(typeof profile.fieldModeHours === "number" ? { fieldModeHours: profile.fieldModeHours } : {}),
  };
}

export class OperationalContextDirectService {
  constructor(private readonly deps: OperationalContextDirectServiceDependencies) {}

  async tryRunOperationalBrief(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isOperationalBriefPrompt(input.userPrompt)) {
      return null;
    }

    const status = this.deps.googleWorkspace.getStatus();
    if (!status.ready) {
      return {
        requestId: input.requestId,
        reply: `A integração Google Workspace não está pronta. ${status.message}`,
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const logger = input.requestLogger ?? this.deps.logger;
    logger.info("Using direct operational brief route", {
      domain: input.orchestration.route.primaryDomain,
    });

    const brief = await this.deps.googleWorkspace.getDailyBrief();
    const focus = this.deps.memory.getDailyFocus(4).map((item) => ({
      title: item.item.title,
      whyNow: item.whyNow,
      nextAction: item.nextAction,
    }));

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildOperationalBriefReply({
        brief,
        focus,
      }),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "daily_operational_brief",
          resultPreview: JSON.stringify(
            {
              events: brief.events.length,
              tasks: brief.tasks.length,
              focus: focus.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async tryRunMorningBrief(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isMorningBriefPrompt(input.userPrompt) && !this.deps.briefingProfiles.resolveProfileForPrompt(input.userPrompt)) {
      return null;
    }

    const logger = input.requestLogger ?? this.deps.logger;
    logger.info("Using direct morning brief route", {
      domain: input.orchestration.route.primaryDomain,
    });

    const rendered = await this.deps.briefingProfiles.render({ prompt: input.userPrompt });
    return {
      requestId: input.requestId,
      reply: rendered.reply,
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "morning_brief",
          resultPreview: JSON.stringify(
            {
              profileId: rendered.profile.id,
              profileName: rendered.profile.name,
              events: rendered.brief.events.length,
              tasks: rendered.brief.taskBuckets.actionableCount,
              emails: rendered.brief.emails.length,
              approvals: rendered.brief.approvals.length,
              workflows: rendered.brief.workflows.length,
              founderSections: rendered.brief.founderSnapshot.sections.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async tryRunCommandCenter(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.commandCenter || !isCommandCenterPrompt(input.userPrompt)) {
      return null;
    }

    const reply = await this.deps.commandCenter.render();
    return {
      requestId: input.requestId,
      reply,
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "command_center_snapshot",
          resultPreview: reply.slice(0, 240),
        },
      ],
    };
  }

  async tryRunConnectionOverview(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.accountLinking || !isConnectionOverviewPrompt(input.userPrompt)) {
      return null;
    }

    return {
      requestId: input.requestId,
      reply: this.deps.accountLinking.renderOverview(),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [],
    };
  }

  async tryRunConnectionStart(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.accountLinking || !isConnectionStartPrompt(input.userPrompt)) {
      return null;
    }

    const result = this.deps.accountLinking.startConnection({
      provider: "google",
      channel: "telegram",
    });
    return {
      requestId: input.requestId,
      reply: result.reply,
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [],
    };
  }

  async tryRunConnectionRevoke(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.accountLinking || !isConnectionRevokePrompt(input.userPrompt)) {
      return null;
    }

    return {
      requestId: input.requestId,
      reply: this.deps.accountLinking.revokeConnection("google"),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [],
    };
  }

  async tryRunDestinationList(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.destinationRegistry || !isDestinationListPrompt(input.userPrompt)) {
      return null;
    }

    return {
      requestId: input.requestId,
      reply: this.deps.destinationRegistry.renderList(),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [],
    };
  }

  async tryRunDestinationSave(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.destinationRegistry) {
      return null;
    }
    const parsed = parseDestinationRegistration(input.userPrompt);
    if (!parsed) {
      return null;
    }

    const destination = this.deps.destinationRegistry.upsert(parsed);
    return {
      requestId: input.requestId,
      reply: `Destino salvo: ${destination.label} | ${destination.channel}/${destination.audience} | ${destination.address}`,
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [],
    };
  }

  async tryRunSharedBriefingPreview(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.sharedBriefingComposer || !isSharedBriefingPreviewPrompt(input.userPrompt)) {
      return null;
    }

    const rendered = await this.deps.briefingProfiles.render({ prompt: input.userPrompt });
    const personalProfile = this.deps.personalMemory.getProfile();
    const destination = this.deps.destinationRegistry?.resolve(input.userPrompt);
    const composed = this.deps.sharedBriefingComposer.compose({
      profile: rendered.profile,
      brief: rendered.brief,
      personalProfile,
      maxPrivacyLevel: destination?.maxPrivacyLevel,
    });
    const reply = composed.removedSections.length > 0
      ? [
          composed.reply,
          "",
          `Seções omitidas por privacidade: ${composed.removedSections.join(", ")}`,
        ].join("\n")
      : composed.reply;

    return {
      requestId: input.requestId,
      reply,
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "shared_briefing_preview",
          resultPreview: reply.slice(0, 240),
        },
      ],
    };
  }

  async tryRunGoalList(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!isGoalListPrompt(input.userPrompt)) {
      return null;
    }

    const goals = this.deps.goalStore.list();
    const reply = goals.length === 0
      ? "Você não tem objetivos ativos registrados no momento."
      : [
          "Objetivos ativos:",
          ...goals.map((goal, index) => `- ${formatGoalLine(goal, index)}`),
        ].join("\n");

    return {
      requestId: input.requestId,
      reply,
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "goal_store_list",
          resultPreview: JSON.stringify({ count: goals.length }, null, 2),
        },
      ],
    };
  }

  async tryRunGoalSave(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!isGoalSavePrompt(input.userPrompt)) {
      return null;
    }

    const statement = extractGoalStatement(input.userPrompt);
    const title = statement ? extractGoalTitle(statement) : undefined;
    if (!statement || !title) {
      return {
        requestId: input.requestId,
        reply: "Diga o objetivo de forma direta. Exemplo: `salve meu objetivo de fechar 2 clientes SaaS até 2026-05-31`.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const saved = this.deps.goalStore.upsert({
      title,
      description: statement,
      metric: extractGoalMetric(statement),
      deadline: parseIsoDateCandidate(statement),
      progress: extractGoalProgress(statement),
      domain: inferGoalDomain(statement),
    });

    return {
      requestId: input.requestId,
      reply: `Objetivo ativo salvo.\n- ${formatGoalLine(saved)}${saved.description ? `\n- Contexto: ${saved.description}` : ""}`,
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "goal_store_upsert",
          resultPreview: JSON.stringify({ id: saved.id, title: saved.title }, null, 2),
        },
      ],
    };
  }

  async tryRunGoalProgressUpdate(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!isGoalProgressUpdatePrompt(input.userPrompt)) {
      return null;
    }

    const progress = extractGoalProgress(input.userPrompt);
    const reference = resolveGoalReference(input.userPrompt);
    if (progress == null || !reference) {
      return {
        requestId: input.requestId,
        reply: "Diga qual objetivo devo atualizar e o novo progresso. Exemplo: `atualize meu objetivo fechar 2 clientes para 40%`.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const matches = findGoalByReference(this.deps.goalStore.list(), reference);
    if (matches.length === 0) {
      return {
        requestId: input.requestId,
        reply: `Não encontrei objetivo ativo para "${reference}".`,
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }
    if (matches.length > 1) {
      return {
        requestId: input.requestId,
        reply: [
          `Encontrei mais de um objetivo para "${reference}".`,
          ...matches.map((goal, index) => `- ${formatGoalLine(goal, index)}`),
          "Use o identificador curto com # para eu atualizar o certo.",
        ].join("\n"),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const updated = this.deps.goalStore.updateProgress(matches[0]!.id, progress);
    if (!updated) {
      return {
        requestId: input.requestId,
        reply: "Não consegui atualizar esse objetivo.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    return {
      requestId: input.requestId,
      reply: `Progresso atualizado.\n- ${formatGoalLine(updated)}`,
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "goal_store_update_progress",
          resultPreview: JSON.stringify({ id: updated.id, progress: updated.progress }, null, 2),
        },
      ],
    };
  }

  async tryRunGoalDelete(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!isGoalDeletePrompt(input.userPrompt)) {
      return null;
    }

    const reference = resolveGoalReference(input.userPrompt);
    if (!reference) {
      return {
        requestId: input.requestId,
        reply: "Diga qual objetivo devo remover. Exemplo: `remova meu objetivo fechar 2 clientes SaaS` ou `remova meu objetivo #abcd1234`.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const matches = findGoalByReference(this.deps.goalStore.list(), reference);
    if (matches.length === 0) {
      return {
        requestId: input.requestId,
        reply: `Não encontrei objetivo ativo para "${reference}".`,
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }
    if (matches.length > 1) {
      return {
        requestId: input.requestId,
        reply: [
          `Encontrei mais de um objetivo para "${reference}".`,
          ...matches.map((goal, index) => `- ${formatGoalLine(goal, index)}`),
          "Use o identificador curto com # para remover o certo.",
        ].join("\n"),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const goal = matches[0]!;
    const removed = this.deps.goalStore.remove(goal.id);
    return {
      requestId: input.requestId,
      reply: removed
        ? `Objetivo removido.\n- ${formatGoalLine(goal)}`
        : "Não consegui remover esse objetivo.",
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: removed
        ? [
            {
              toolName: "goal_store_remove",
              resultPreview: JSON.stringify({ id: goal.id, title: goal.title }, null, 2),
            },
          ]
        : [],
    };
  }

  async tryRunProfileShow(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isPersonalOperationalProfileShowPrompt(input.userPrompt)) {
      return null;
    }

    const execution = await this.deps.executeToolDirect("get_personal_operational_profile", {});
    const rawResult = execution.rawResult as {
      profile?: PersonalOperationalProfile;
    };

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildPersonalOperationalProfileReply(rawResult.profile ?? this.deps.personalMemory.getProfile()),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "get_personal_operational_profile",
          resultPreview: execution.content.slice(0, 240),
        },
      ],
    };
  }

  async tryRunOperationalStateShow(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isOperationalStateShowPrompt(input.userPrompt)) {
      return null;
    }

    const execution = await this.deps.executeToolDirect("get_operational_state", {});
    const rawResult = execution.rawResult as {
      state?: OperationalState;
    };

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildOperationalStateReply(rawResult.state ?? this.deps.personalMemory.getOperationalState()),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "get_operational_state",
          resultPreview: execution.content.slice(0, 240),
        },
      ],
    };
  }

  async tryRunLearnedPreferencesList(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isLearnedPreferencesListPrompt(input.userPrompt)) {
      return null;
    }

    const filter = this.deps.helpers.resolveLearnedPreferencesListFilter(input.userPrompt);
    const execution = await this.deps.executeToolDirect("list_learned_preferences", {
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.search ? { search: filter.search } : {}),
      limit: 12,
    });
    const rawResult = execution.rawResult as { items?: LearnedPreference[] };
    const items = filter.search === "agenda"
      ? (rawResult.items ?? []).filter((item) =>
          ["schedule_import_mode", "agenda_scope", "calendar_interpretation"].includes(item.type),
        )
      : (rawResult.items ?? []);

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildLearnedPreferencesReply(items),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "list_learned_preferences",
          resultPreview: execution.content.slice(0, 240),
        },
      ],
    };
  }

  async tryRunLearnedPreferencesDelete(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isLearnedPreferencesDeletePrompt(input.userPrompt)) {
      return null;
    }

    let targetId = this.deps.helpers.extractLearnedPreferenceId(input.userPrompt);
    const query = this.deps.helpers.extractLearnedPreferenceDeleteTarget(input.userPrompt);
    if (!targetId && !query) {
      return {
        requestId: input.requestId,
        reply: "Diga qual preferência aprendida devo desativar, por id ou por referência curta.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    if (!targetId && query) {
      const matches = this.deps.personalMemory.findLearnedPreferences(query, 5);
      if (matches.length === 0) {
        return {
          requestId: input.requestId,
          reply: `Não encontrei preferência aprendida para "${query}".`,
          messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
          toolExecutions: [],
        };
      }
      if (matches.length > 1) {
        return {
          requestId: input.requestId,
          reply: this.deps.helpers.buildLearnedPreferencesReply(matches),
          messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
          toolExecutions: [],
        };
      }
      targetId = matches[0]?.id;
    }

    if (!targetId) {
      return null;
    }

    const execution = await this.deps.executeToolDirect("deactivate_learned_preference", {
      id: targetId,
    });
    const rawResult = execution.rawResult as {
      item?: LearnedPreference;
    };
    const item = rawResult.item;

    return {
      requestId: input.requestId,
      reply: item
        ? this.deps.helpers.buildLearnedPreferenceDeactivatedReply(item)
        : "Não consegui desativar essa preferência aprendida.",
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: item
        ? [
            {
              toolName: "deactivate_learned_preference",
              resultPreview: execution.content.slice(0, 240),
            },
          ]
        : [],
    };
  }

  async tryRunProfileUpdate(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isPersonalOperationalProfileUpdatePrompt(input.userPrompt)) {
      return null;
    }

    const currentProfile = this.deps.personalMemory.getProfile();
    const extracted = this.deps.helpers.extractPersonalOperationalProfileUpdate(input.userPrompt, currentProfile);
    if (!extracted) {
      return {
        requestId: input.requestId,
        reply: [
          "Posso montar teu perfil base com uma mensagem só.",
          "Me mande algo neste formato:",
          "",
          "Meu nome é ...",
          "Moro em ...",
          "Trabalho com ...",
          "Minhas agendas principais são ...",
          "Meu carro é ... e faz ... km/l",
          "Quero que o Atlas me ajude principalmente com ...",
        ].join("\n"),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    let profileUpdate = extracted.profile;
    if (this.deps.destinationRegistry) {
      const destination = this.deps.destinationRegistry.resolve(input.userPrompt);
      if (destination && input.userPrompt.toLowerCase().includes("briefing")) {
        const sourceProfiles = profileUpdate.briefingProfiles ?? currentProfile.briefingProfiles ?? [];
        if (sourceProfiles.length > 0) {
          const nextProfiles = sourceProfiles.map((item) => item.audience === "team"
            ? {
                ...item,
                deliveryChannel: destination.channel,
                targetRecipientIds: [destination.address],
                targetLabel: destination.label,
              }
            : item);
          profileUpdate = {
            ...profileUpdate,
            briefingProfiles: nextProfiles,
          };
          extracted.changeLabels.push(`destino do briefing: ${destination.label} | ${destination.channel}`);
        }
      }
    }

    if (this.deps.professionBootstrap) {
      const bootstrapCandidate = mergeProfileDraft(currentProfile, profileUpdate);
      const bootstrapPatch = this.deps.professionBootstrap.buildBootstrapPatch(bootstrapCandidate);
      const bootstrapSummary = this.deps.professionBootstrap.summarize(mergeProfileDraft(bootstrapCandidate, bootstrapPatch));
      profileUpdate = {
        ...bootstrapPatch,
        ...profileUpdate,
      };
      if (bootstrapSummary) {
        extracted.changeLabels.push(`modelo base: ${bootstrapSummary}`);
      }
    }

    const execution = await this.deps.executeToolDirect(
      "update_personal_operational_profile",
      buildProfileUpdateToolArguments(profileUpdate),
    );
    if (extracted.preferenceUpdate) {
      this.deps.preferences.update(extracted.preferenceUpdate);
    }

    const rawResult = execution.rawResult as {
      profile?: PersonalOperationalProfile;
    };

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildPersonalOperationalProfileUpdatedReply(
        rawResult.profile ?? this.deps.personalMemory.getProfile(),
        extracted.changeLabels,
      ),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, this.deps.preferences.get()),
      toolExecutions: [
        {
          toolName: "update_personal_operational_profile",
          resultPreview: execution.content.slice(0, 240),
        },
      ],
    };
  }

  async tryRunProfileDelete(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isPersonalOperationalProfileDeletePrompt(input.userPrompt)) {
      return null;
    }

    const currentProfile = this.deps.personalMemory.getProfile();
    const query = this.deps.helpers.extractPersonalOperationalProfileRemoveQuery(input.userPrompt);
    if (!query) {
      return {
        requestId: input.requestId,
        reply: "Diga o que devo remover do seu perfil operacional.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const removal = this.deps.helpers.removeFromPersonalOperationalProfile(currentProfile, query);
    if (!removal) {
      return {
        requestId: input.requestId,
        reply: `Não encontrei ajuste de perfil compatível com "${query}".`,
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const execution = await this.deps.executeToolDirect(
      "update_personal_operational_profile",
      buildProfileUpdateToolArguments(removal.profileUpdate),
    );
    const preferenceReset: UpdateUserPreferencesInput = {};
    if (removal.profileUpdate.responseStyle || removal.profileUpdate.tonePreference) {
      preferenceReset.responseStyle = "executive";
    }
    if (removal.profileUpdate.briefingPreference || removal.profileUpdate.detailLevel) {
      preferenceReset.responseLength = "short";
    }
    if (Object.keys(preferenceReset).length > 0) {
      this.deps.preferences.update(preferenceReset);
    }

    const rawResult = execution.rawResult as {
      profile?: PersonalOperationalProfile;
    };

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildPersonalOperationalProfileRemovedReply(
        rawResult.profile ?? this.deps.personalMemory.getProfile(),
        removal.removedLabels,
      ),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "update_personal_operational_profile",
          resultPreview: execution.content.slice(0, 240),
        },
      ],
    };
  }

  async tryRunPersonalMemoryList(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isPersonalMemoryListPrompt(input.userPrompt)) {
      return null;
    }

    const execution = await this.deps.executeToolDirect("list_personal_memory_items", {
      limit: 12,
    });
    const rawResult = execution.rawResult as {
      items?: PersonalOperationalMemoryItem[];
      profile?: PersonalOperationalProfile;
    };

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildPersonalMemoryListReply({
        profile: rawResult.profile ?? this.deps.personalMemory.getProfile(),
        items: rawResult.items ?? [],
      }),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "list_personal_memory_items",
          resultPreview: execution.content.slice(0, 240),
        },
      ],
    };
  }

  async tryRunPersonalMemorySave(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isPersonalMemorySavePrompt(input.userPrompt)) {
      return null;
    }

    const statement = this.deps.helpers.extractPersonalMemoryStatement(input.userPrompt);
    if (!statement) {
      return {
        requestId: input.requestId,
        reply: "Diga o que devo salvar na memória pessoal. Exemplo: `salve na minha memória pessoal que em dias de plantão quero respostas curtas`.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const kind = this.deps.helpers.inferPersonalMemoryKind(statement);
    const execution = await this.deps.executeToolDirect("save_personal_memory_item", {
      kind,
      title: this.deps.helpers.buildPersonalMemoryTitle(statement, kind),
      content: statement,
    });
    const rawResult = execution.rawResult as { item?: PersonalOperationalMemoryItem };
    const item = rawResult.item;
    if (!item) {
      return {
        requestId: input.requestId,
        reply: "Não consegui salvar esse item na memória pessoal.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildPersonalMemorySavedReply(item),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "save_personal_memory_item",
          resultPreview: execution.content.slice(0, 240),
        },
      ],
    };
  }

  async tryRunPersonalMemoryUpdate(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isPersonalMemoryUpdatePrompt(input.userPrompt)) {
      return null;
    }

    const id = this.deps.helpers.extractPersonalMemoryId(input.userPrompt);
    const query = this.deps.helpers.extractPersonalMemoryUpdateTarget(input.userPrompt);
    const content = this.deps.helpers.extractPersonalMemoryUpdateContent(input.userPrompt);
    if (!id && !query) {
      return {
        requestId: input.requestId,
        reply: "Diga qual item da memória pessoal devo atualizar, por id ou por referência curta. Exemplo: `atualize minha memória pessoal #3 para respostas muito curtas em plantão`.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    if (!content) {
      return {
        requestId: input.requestId,
        reply: "Entendi o item alvo, mas faltou dizer o novo conteúdo. Exemplo: `atualize minha memória pessoal sobre rotina de plantão para respostas curtas e foco em deslocamento`.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    let targetId = id;
    if (!targetId && query) {
      const matches = this.deps.personalMemory.findItems(query, 5);
      if (matches.length === 0) {
        return {
          requestId: input.requestId,
          reply: `Não encontrei item de memória pessoal para "${query}".`,
          messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
          toolExecutions: [],
        };
      }
      if (matches.length > 1) {
        return {
          requestId: input.requestId,
          reply: this.deps.helpers.buildPersonalMemoryAmbiguousReply(query, matches),
          messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
          toolExecutions: [],
        };
      }
      targetId = matches[0]?.id;
    }

    if (!targetId) {
      return null;
    }

    const kind = this.deps.helpers.inferPersonalMemoryKind(content);
    const execution = await this.deps.executeToolDirect("update_personal_memory_item", {
      id: targetId,
      kind,
      title: this.deps.helpers.buildPersonalMemoryTitle(content, kind),
      content,
    });
    const rawResult = execution.rawResult as { item?: PersonalOperationalMemoryItem };
    const item = rawResult.item;
    if (!item) {
      return {
        requestId: input.requestId,
        reply: "Não consegui atualizar esse item da memória pessoal.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildPersonalMemoryUpdatedReply(item),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "update_personal_memory_item",
          resultPreview: execution.content.slice(0, 240),
        },
      ],
    };
  }

  async tryRunPersonalMemoryDelete(input: OperationalContextDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isPersonalMemoryDeletePrompt(input.userPrompt)) {
      return null;
    }

    let targetId = this.deps.helpers.extractPersonalMemoryId(input.userPrompt);
    const query = this.deps.helpers.extractPersonalMemoryDeleteTarget(input.userPrompt);

    if (!targetId && !query) {
      return {
        requestId: input.requestId,
        reply: "Diga qual item da memória pessoal devo remover, por id ou por referência curta. Exemplo: `remova da minha memória pessoal #4`.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    if (!targetId && query) {
      const matches = this.deps.personalMemory.findItems(query, 5);
      if (matches.length === 0) {
        return {
          requestId: input.requestId,
          reply: `Não encontrei item de memória pessoal para "${query}".`,
          messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
          toolExecutions: [],
        };
      }
      if (matches.length > 1) {
        return {
          requestId: input.requestId,
          reply: this.deps.helpers.buildPersonalMemoryAmbiguousReply(query, matches),
          messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
          toolExecutions: [],
        };
      }
      targetId = matches[0]?.id;
    }

    if (!targetId) {
      return null;
    }

    const execution = await this.deps.executeToolDirect("delete_personal_memory_item", {
      id: targetId,
    });
    const rawResult = execution.rawResult as { item?: PersonalOperationalMemoryItem };
    const item = rawResult.item;
    if (!item) {
      return {
        requestId: input.requestId,
        reply: "Não consegui remover esse item da memória pessoal.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildPersonalMemoryDeletedReply(item),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "delete_personal_memory_item",
          resultPreview: execution.content.slice(0, 240),
        },
      ],
    };
  }
}
