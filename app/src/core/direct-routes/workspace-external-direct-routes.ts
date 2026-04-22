import {
  defineDirectRoute,
  type DirectRouteDefinition,
  type DirectRouteHandler,
} from "../direct-route-runner.js";

export interface GoogleWorkspaceDirectRouteDependencies {
  calendarLookup: DirectRouteHandler;
  calendarConflictReview: DirectRouteHandler;
  calendarPeriodList: DirectRouteHandler;
  googleTaskDraft: DirectRouteHandler;
  googleEventDraft: DirectRouteHandler;
  googleEventMove: DirectRouteHandler;
  googleEventDelete: DirectRouteHandler;
  googleTasks: DirectRouteHandler;
  googleContacts: DirectRouteHandler;
  googleCalendarsList: DirectRouteHandler;
  placeLookup: DirectRouteHandler;
}

export interface MessagingDirectRouteDependencies {
  whatsappSend: DirectRouteHandler;
  whatsappRecentSearch: DirectRouteHandler;
  whatsappPendingApprovals: DirectRouteHandler;
}

export interface KnowledgeAndProjectDirectRouteDependencies {
  weather: DirectRouteHandler;
  internalKnowledgeLookup: DirectRouteHandler;
  webResearch: DirectRouteHandler;
  researchDesk: DirectRouteHandler;
  knowledgeGraph: DirectRouteHandler;
  revenueScoreboard: DirectRouteHandler;
  allowedSpaces: DirectRouteHandler;
  projectScan: DirectRouteHandler;
  projectMirror: DirectRouteHandler;
  safeExec: DirectRouteHandler;
}

export function buildGoogleWorkspaceDirectRoutes(
  deps: GoogleWorkspaceDirectRouteDependencies,
): DirectRouteDefinition[] {
  return [
    defineDirectRoute("calendar_lookup", "google-workspace", deps.calendarLookup),
    defineDirectRoute(
      "calendar_conflict_review",
      "google-workspace",
      deps.calendarConflictReview,
    ),
    defineDirectRoute("calendar_period_list", "google-workspace", deps.calendarPeriodList),
    defineDirectRoute("google_task_draft", "google-workspace", deps.googleTaskDraft),
    defineDirectRoute("google_event_draft", "google-workspace", deps.googleEventDraft),
    defineDirectRoute("google_event_move", "google-workspace", deps.googleEventMove),
    defineDirectRoute("google_event_delete", "google-workspace", deps.googleEventDelete),
    defineDirectRoute("google_tasks", "google-workspace", deps.googleTasks),
    defineDirectRoute("google_contacts", "google-workspace", deps.googleContacts),
    defineDirectRoute(
      "google_calendars_list",
      "google-workspace",
      deps.googleCalendarsList,
    ),
    defineDirectRoute("place_lookup", "google-workspace", deps.placeLookup),
  ];
}

export function buildMessagingDirectRoutes(
  deps: MessagingDirectRouteDependencies,
): DirectRouteDefinition[] {
  return [
    defineDirectRoute("whatsapp_send", "messaging", deps.whatsappSend),
    defineDirectRoute("whatsapp_recent_search", "messaging", deps.whatsappRecentSearch),
    defineDirectRoute(
      "whatsapp_pending_approvals",
      "messaging",
      deps.whatsappPendingApprovals,
    ),
  ];
}

export function buildKnowledgeAndProjectDirectRoutes(
  deps: KnowledgeAndProjectDirectRouteDependencies,
): DirectRouteDefinition[] {
  return [
    defineDirectRoute("weather", "knowledge-project", deps.weather),
    defineDirectRoute(
      "internal_knowledge_lookup",
      "knowledge-project",
      deps.internalKnowledgeLookup,
    ),
    defineDirectRoute("web_research", "knowledge-project", deps.webResearch),
    defineDirectRoute("research_desk", "knowledge-project", deps.researchDesk),
    defineDirectRoute("knowledge_graph", "knowledge-project", deps.knowledgeGraph),
    defineDirectRoute(
      "revenue_scoreboard",
      "knowledge-project",
      deps.revenueScoreboard,
    ),
    defineDirectRoute("allowed_spaces", "knowledge-project", deps.allowedSpaces),
    defineDirectRoute("project_scan", "knowledge-project", deps.projectScan),
    defineDirectRoute("project_mirror", "knowledge-project", deps.projectMirror),
    defineDirectRoute("safe_exec", "knowledge-project", deps.safeExec),
  ];
}
