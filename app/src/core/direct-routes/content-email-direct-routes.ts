import {
  defineDirectRoute,
  type DirectRouteDefinition,
  type DirectRouteHandler,
} from "../direct-route-runner.js";

export interface ContentDirectRouteDependencies {
  dailyEditorialResearch: DirectRouteHandler;
  contentIdeaGeneration: DirectRouteHandler;
  contentReview: DirectRouteHandler;
  contentScriptGeneration: DirectRouteHandler;
  contentBatchPlanning: DirectRouteHandler;
  contentBatchGeneration: DirectRouteHandler;
  contentDistributionStrategy: DirectRouteHandler;
  contentChannels: DirectRouteHandler;
  contentSeries: DirectRouteHandler;
  contentFormatLibrary: DirectRouteHandler;
  contentHookLibrary: DirectRouteHandler;
  contentOverview: DirectRouteHandler;
  caseNotes: DirectRouteHandler;
}

export interface EmailDirectRouteDependencies {
  emailDraft: DirectRouteHandler;
  emailSummary: DirectRouteHandler;
  emailLookup: DirectRouteHandler;
}

export function buildContentDirectRoutes(
  deps: ContentDirectRouteDependencies,
): DirectRouteDefinition[] {
  return [
    defineDirectRoute("daily_editorial_research", "content", deps.dailyEditorialResearch),
    defineDirectRoute("content_idea_generation", "content", deps.contentIdeaGeneration),
    defineDirectRoute("content_review", "content", deps.contentReview),
    defineDirectRoute(
      "content_script_generation",
      "content",
      deps.contentScriptGeneration,
    ),
    defineDirectRoute("content_batch_planning", "content", deps.contentBatchPlanning),
    defineDirectRoute("content_batch_generation", "content", deps.contentBatchGeneration),
    defineDirectRoute(
      "content_distribution_strategy",
      "content",
      deps.contentDistributionStrategy,
    ),
    defineDirectRoute("content_channels", "content", deps.contentChannels),
    defineDirectRoute("content_series", "content", deps.contentSeries),
    defineDirectRoute("content_format_library", "content", deps.contentFormatLibrary),
    defineDirectRoute("content_hook_library", "content", deps.contentHookLibrary),
    defineDirectRoute("content_overview", "content", deps.contentOverview),
    defineDirectRoute("case_notes", "content", deps.caseNotes),
  ];
}

export function buildEmailDirectRoutes(
  deps: EmailDirectRouteDependencies,
): DirectRouteDefinition[] {
  return [
    defineDirectRoute("email_draft", "email", deps.emailDraft),
    defineDirectRoute("email_summary", "email", deps.emailSummary),
    defineDirectRoute("email_lookup", "email", deps.emailLookup),
  ];
}
