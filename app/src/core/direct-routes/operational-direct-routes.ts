import {
  defineDirectRoute,
  type DirectRouteDefinition,
  type DirectRouteHandler,
} from "../direct-route-runner.js";

export interface OperationalDirectRouteDependencies {
  morningBrief: DirectRouteHandler;
  operationalPlanning: DirectRouteHandler;
  macQueueStatus: DirectRouteHandler;
  macQueueList: DirectRouteHandler;
  macQueueEnqueue: DirectRouteHandler;
  contactList: DirectRouteHandler;
  contactUpsert: DirectRouteHandler;
  memoryEntityList: DirectRouteHandler;
  memoryEntitySearch: DirectRouteHandler;
  intentResolve: DirectRouteHandler;
}

export interface WorkflowDirectRouteDependencies {
  workflowList: DirectRouteHandler;
  workflowShow: DirectRouteHandler;
  workflowArtifacts: DirectRouteHandler;
  workflowExecution: DirectRouteHandler;
  workflowStepUpdate: DirectRouteHandler;
  workflowPlanning: DirectRouteHandler;
}

export interface ReviewDirectRouteDependencies {
  memoryUpdateGuard: DirectRouteHandler;
  supportReview: DirectRouteHandler;
  followUpReview: DirectRouteHandler;
  inboxTriage: DirectRouteHandler;
  operationalBrief: DirectRouteHandler;
  nextCommitmentPrep: DirectRouteHandler;
}

export function buildOperationalDirectRoutes(
  deps: OperationalDirectRouteDependencies,
): DirectRouteDefinition[] {
  return [
    defineDirectRoute("morning_brief", "operational", deps.morningBrief),
    defineDirectRoute("operational_planning", "operational", deps.operationalPlanning),
    defineDirectRoute("mac_queue_status", "operational", deps.macQueueStatus),
    defineDirectRoute("mac_queue_list", "operational", deps.macQueueList),
    defineDirectRoute("mac_queue_enqueue", "operational", deps.macQueueEnqueue),
    defineDirectRoute("contact_list", "operational", deps.contactList),
    defineDirectRoute("contact_upsert", "operational", deps.contactUpsert),
    defineDirectRoute("memory_entity_list", "operational", deps.memoryEntityList),
    defineDirectRoute("memory_entity_search", "operational", deps.memoryEntitySearch),
    defineDirectRoute("intent_resolve", "operational", deps.intentResolve),
  ];
}

export function buildWorkflowDirectRoutes(
  deps: WorkflowDirectRouteDependencies,
): DirectRouteDefinition[] {
  return [
    defineDirectRoute("workflow_list", "workflow", deps.workflowList),
    defineDirectRoute("workflow_show", "workflow", deps.workflowShow),
    defineDirectRoute("workflow_artifacts", "workflow", deps.workflowArtifacts),
    defineDirectRoute("workflow_execution", "workflow", deps.workflowExecution),
    defineDirectRoute("workflow_step_update", "workflow", deps.workflowStepUpdate),
    defineDirectRoute("workflow_planning", "workflow", deps.workflowPlanning),
  ];
}

export function buildReviewDirectRoutes(
  deps: ReviewDirectRouteDependencies,
): DirectRouteDefinition[] {
  return [
    defineDirectRoute("memory_update_guard", "review", deps.memoryUpdateGuard),
    defineDirectRoute("support_review", "review", deps.supportReview),
    defineDirectRoute("follow_up_review", "review", deps.followUpReview),
    defineDirectRoute("inbox_triage", "review", deps.inboxTriage),
    defineDirectRoute("operational_brief", "review", deps.operationalBrief),
    defineDirectRoute("next_commitment_prep", "review", deps.nextCommitmentPrep),
  ];
}
