import type { AgentRunResult } from "./agent-core.js";
import type { Logger } from "../types/logger.js";
import type { ConversationMessage } from "../types/llm.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type {
  ContentChannelRecord,
  ContentFormatTemplateRecord,
  ContentHookTemplateRecord,
  ContentItemRecord,
  ContentSeriesRecord,
} from "../types/content-ops.js";
import type { SocialCaseNoteRecord } from "../types/social-assistant.js";

type ContentPlatform =
  | "instagram"
  | "tiktok"
  | "youtube"
  | "shorts"
  | "reels"
  | "linkedin"
  | "blog"
  | "email"
  | "telegram"
  | undefined;

interface ContentOpsLike {
  listItems(input?: {
    platform?: ContentPlatform;
    channelKey?: string;
    limit?: number;
  }): ContentItemRecord[];
  listChannels(input?: {
    platform?: string;
    limit?: number;
  }): ContentChannelRecord[];
  listSeries(input?: {
    channelKey?: string;
    limit?: number;
  }): ContentSeriesRecord[];
  listFormatTemplates(input?: {
    activeOnly?: boolean;
    limit?: number;
  }): ContentFormatTemplateRecord[];
  listHookTemplates(input?: {
    limit?: number;
  }): ContentHookTemplateRecord[];
}

interface SocialAssistantLike {
  listNotes(input?: {
    sensitivity?: "restricted" | "high" | "critical";
    limit?: number;
  }): SocialCaseNoteRecord[];
}

interface ContentDirectHelpers {
  isContentOverviewPrompt: (prompt: string) => boolean;
  isContentChannelsPrompt: (prompt: string) => boolean;
  isContentSeriesPrompt: (prompt: string) => boolean;
  isContentFormatLibraryPrompt: (prompt: string) => boolean;
  isContentHookLibraryPrompt: (prompt: string) => boolean;
  isDailyEditorialResearchPrompt: (prompt: string) => boolean;
  isCaseNotesPrompt: (prompt: string) => boolean;
  extractPromptLimit: (prompt: string, fallback: number, max: number) => number;
  extractContentPlatform: (prompt: string) => string | undefined;
  extractContentChannelKey: (prompt: string) => string | undefined;
  inferDefaultContentChannelKey: (prompt: string) => string;
  normalizeEmailAnalysisText: (value: string) => string;
  buildContentOverviewReply: (items: ContentItemRecord[]) => string;
  buildContentChannelsReply: (channels: ContentChannelRecord[]) => string;
  buildContentSeriesReply: (series: ContentSeriesRecord[]) => string;
  buildContentFormatsReply: (templates: ContentFormatTemplateRecord[]) => string;
  buildContentHooksReply: (hooks: ContentHookTemplateRecord[]) => string;
  buildCaseNotesReply: (notes: SocialCaseNoteRecord[]) => string;
}

export interface ContentDirectServiceDependencies {
  logger: Logger;
  contentOps: ContentOpsLike;
  socialAssistant: SocialAssistantLike;
  defaultTimezone: string;
  runDailyEditorialResearch: (input: {
    channelKey?: string;
    timezone?: string;
    trendsLimit?: number;
    ideasLimit?: number;
    now?: Date;
  }) => Promise<{
    reply: string;
    runDate: string;
    createdItemIds: number[];
    skipped: boolean;
  }>;
  buildBaseMessages: (userPrompt: string, orchestration: OrchestrationContext) => ConversationMessage[];
  helpers: ContentDirectHelpers;
}

interface ContentDirectInput {
  userPrompt: string;
  requestId: string;
  requestLogger: Logger;
  orchestration: OrchestrationContext;
}

export class ContentDirectService {
  constructor(private readonly deps: ContentDirectServiceDependencies) {}

  async tryRunContentOverview(input: ContentDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isContentOverviewPrompt(input.userPrompt)) {
      return null;
    }

    const limit = this.deps.helpers.extractPromptLimit(input.userPrompt, 10, 30);
    const platform = this.deps.helpers.extractContentPlatform(input.userPrompt) as ContentPlatform;
    const channelKey = this.deps.helpers.extractContentChannelKey(input.userPrompt);
    input.requestLogger.info("Using direct content overview route", {
      limit,
      platform,
      channelKey,
    });

    const items = this.deps.contentOps.listItems({
      platform,
      channelKey,
      limit,
    });

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildContentOverviewReply(items),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
      toolExecutions: [
        {
          toolName: "list_content_items",
          resultPreview: JSON.stringify(
            {
              total: items.length,
              platform,
              channelKey,
              limit,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async tryRunContentChannels(input: ContentDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isContentChannelsPrompt(input.userPrompt)) {
      return null;
    }

    const limit = this.deps.helpers.extractPromptLimit(input.userPrompt, 10, 30);
    const platform = this.deps.helpers.extractContentPlatform(input.userPrompt);
    input.requestLogger.info("Using direct content channels route", {
      limit,
      platform,
    });

    const channels = this.deps.contentOps.listChannels({
      platform,
      limit,
    });

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildContentChannelsReply(channels),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
      toolExecutions: [
        {
          toolName: "list_content_channels",
          resultPreview: JSON.stringify(
            {
              total: channels.length,
              platform,
              limit,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async tryRunDailyEditorialResearch(input: ContentDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isDailyEditorialResearchPrompt(input.userPrompt)) {
      return null;
    }

    const channelKey = this.deps.helpers.inferDefaultContentChannelKey(input.userPrompt);
    input.requestLogger.info("Using direct daily editorial research route", {
      channelKey,
    });

    const result = await this.deps.runDailyEditorialResearch({
      channelKey,
      timezone: this.deps.defaultTimezone,
      trendsLimit: 10,
      ideasLimit: 5,
    });

    return {
      requestId: input.requestId,
      reply: result.reply,
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
      toolExecutions: [
        {
          toolName: "daily_editorial_research",
          resultPreview: JSON.stringify(
            {
              channelKey,
              runDate: result.runDate,
              createdItemIds: result.createdItemIds,
              skipped: result.skipped,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async tryRunContentSeries(input: ContentDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isContentSeriesPrompt(input.userPrompt)) {
      return null;
    }

    const limit = this.deps.helpers.extractPromptLimit(input.userPrompt, 10, 30);
    const channelKey = this.deps.helpers.extractContentChannelKey(input.userPrompt);
    input.requestLogger.info("Using direct content series route", {
      limit,
      channelKey,
    });

    const series = this.deps.contentOps.listSeries({
      channelKey,
      limit,
    });

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildContentSeriesReply(series),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
      toolExecutions: [
        {
          toolName: "list_content_series",
          resultPreview: JSON.stringify(
            {
              total: series.length,
              channelKey,
              limit,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async tryRunContentFormatLibrary(input: ContentDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isContentFormatLibraryPrompt(input.userPrompt)) {
      return null;
    }

    const limit = this.deps.helpers.extractPromptLimit(input.userPrompt, 10, 30);
    input.requestLogger.info("Using direct content format library route", {
      limit,
    });

    const templates = this.deps.contentOps.listFormatTemplates({
      activeOnly: true,
      limit,
    });

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildContentFormatsReply(templates),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
      toolExecutions: [
        {
          toolName: "list_content_format_templates",
          resultPreview: JSON.stringify(
            {
              total: templates.length,
              limit,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async tryRunContentHookLibrary(input: ContentDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isContentHookLibraryPrompt(input.userPrompt)) {
      return null;
    }

    const limit = this.deps.helpers.extractPromptLimit(input.userPrompt, 10, 30);
    input.requestLogger.info("Using direct content hook library route", {
      limit,
    });

    const hooks = this.deps.contentOps.listHookTemplates({
      limit,
    });

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildContentHooksReply(hooks),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
      toolExecutions: [
        {
          toolName: "list_content_hook_templates",
          resultPreview: JSON.stringify(
            {
              total: hooks.length,
              limit,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async tryRunCaseNotes(input: ContentDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isCaseNotesPrompt(input.userPrompt)) {
      return null;
    }

    const limit = this.deps.helpers.extractPromptLimit(input.userPrompt, 10, 30);
    const normalized = this.deps.helpers.normalizeEmailAnalysisText(input.userPrompt);
    const sensitivity =
      normalized.includes("critical")
        ? "critical"
        : normalized.includes("high") || normalized.includes("alta")
          ? "high"
          : normalized.includes("restricted") || normalized.includes("restrita")
            ? "restricted"
            : undefined;
    input.requestLogger.info("Using direct case notes route", {
      limit,
      sensitivity,
    });

    const notes = this.deps.socialAssistant.listNotes({
      sensitivity,
      limit,
    });

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildCaseNotesReply(notes),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
      toolExecutions: [
        {
          toolName: "list_case_notes",
          resultPreview: JSON.stringify(
            {
              total: notes.length,
              sensitivity,
              limit,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
