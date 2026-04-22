import {
  defineDirectRoute,
  type DirectRouteDefinition,
  type DirectRouteHandler,
} from "../direct-route-runner.js";

export interface OperationalDirectRouteDependencies {
  commandCenter: DirectRouteHandler;
  connectionOverview: DirectRouteHandler;
  connectionStart: DirectRouteHandler;
  connectionRevoke: DirectRouteHandler;
  destinationList: DirectRouteHandler;
  destinationSave: DirectRouteHandler;
  sharedBriefingPreview: DirectRouteHandler;
  deliveryManagement: DirectRouteHandler;
  operatorModes: DirectRouteHandler;
  selfImprovement: DirectRouteHandler;
  lifeManagement: DirectRouteHandler;
  missionOs: DirectRouteHandler;
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
  autonomyReview: DirectRouteHandler;
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
    defineDirectRoute("command_center", "operational", deps.commandCenter, {
      intents: ["command_center.show"],
      objects: ["command_center"],
      operations: ["show"],
      priority: 50,
    }),
    defineDirectRoute("connection_overview", "operational", deps.connectionOverview, {
      intents: ["connection.overview"],
      objects: ["connection"],
      operations: ["show"],
      priority: 40,
    }),
    defineDirectRoute("connection_start", "operational", deps.connectionStart, {
      intents: ["connection.start"],
      objects: ["connection"],
      operations: ["connect"],
      priority: 45,
    }),
    defineDirectRoute("connection_revoke", "operational", deps.connectionRevoke, {
      intents: ["connection.revoke"],
      objects: ["connection"],
      operations: ["revoke"],
      priority: 45,
    }),
    defineDirectRoute("destination_list", "operational", deps.destinationList, {
      intents: ["destination.list"],
      objects: ["destination"],
      operations: ["list"],
      priority: 40,
    }),
    defineDirectRoute("destination_save", "operational", deps.destinationSave, {
      intents: ["destination.save"],
      objects: ["destination"],
      operations: ["create"],
      priority: 45,
    }),
    defineDirectRoute("shared_briefing_preview", "operational", deps.sharedBriefingPreview, {
      intents: ["briefing.shared_preview"],
      objects: ["briefing"],
      operations: ["preview"],
      priority: 50,
    }),
    defineDirectRoute("delivery_management", "operational", deps.deliveryManagement),
    defineDirectRoute("operator_modes", "operational", deps.operatorModes),
    defineDirectRoute("self_improvement", "operational", deps.selfImprovement),
    defineDirectRoute("life_management", "operational", deps.lifeManagement),
    defineDirectRoute("mission_os", "operational", deps.missionOs),
    defineDirectRoute("morning_brief", "operational", deps.morningBrief, {
      intents: ["briefing.show"],
      objects: ["briefing"],
      operations: ["show"],
      priority: 45,
    }),
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
    defineDirectRoute("autonomy_review", "review", deps.autonomyReview),
    defineDirectRoute("support_review", "review", deps.supportReview),
    defineDirectRoute("follow_up_review", "review", deps.followUpReview),
    defineDirectRoute("inbox_triage", "review", deps.inboxTriage),
    defineDirectRoute("operational_brief", "review", deps.operationalBrief),
    defineDirectRoute("next_commitment_prep", "review", deps.nextCommitmentPrep),
  ];
}
