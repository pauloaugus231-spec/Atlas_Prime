import {
  defineDirectRoute,
  type DirectRouteDefinition,
  type DirectRouteHandler,
} from "../direct-route-runner.js";

export interface ConversationDirectRouteDependencies {
  ping: DirectRouteHandler;
  greeting: DirectRouteHandler;
  conversationStyleCorrection: DirectRouteHandler;
  agentIdentity: DirectRouteHandler;
}

export interface CapabilityDirectRouteDependencies {
  personalProfileShow: DirectRouteHandler;
  operationalStateShow: DirectRouteHandler;
  learnedPreferencesList: DirectRouteHandler;
  learnedPreferencesDelete: DirectRouteHandler;
  capabilityInspection: DirectRouteHandler;
  activeGoal: DirectRouteHandler;
  capabilityPlanning: DirectRouteHandler;
}

export interface MemoryAndPreferenceDirectRouteDependencies {
  personalProfileUpdate: DirectRouteHandler;
  personalProfileDelete: DirectRouteHandler;
  userPreferences: DirectRouteHandler;
  activeGoalsList: DirectRouteHandler;
  activeGoalSave: DirectRouteHandler;
  activeGoalProgressUpdate: DirectRouteHandler;
  activeGoalDelete: DirectRouteHandler;
  personalMemoryList: DirectRouteHandler;
  personalMemorySave: DirectRouteHandler;
  personalMemoryUpdate: DirectRouteHandler;
  personalMemoryDelete: DirectRouteHandler;
}

export function buildConversationDirectRoutes(
  deps: ConversationDirectRouteDependencies,
): DirectRouteDefinition[] {
  return [
    defineDirectRoute("ping", "conversation", deps.ping),
    defineDirectRoute("greeting", "conversation", deps.greeting),
    defineDirectRoute(
      "conversation_style_correction",
      "conversation",
      deps.conversationStyleCorrection,
    ),
    defineDirectRoute("agent_identity", "conversation", deps.agentIdentity),
  ];
}

export function buildCapabilityDirectRoutes(
  deps: CapabilityDirectRouteDependencies,
): DirectRouteDefinition[] {
  return [
    defineDirectRoute("personal_profile_show", "capability", deps.personalProfileShow),
    defineDirectRoute("operational_state_show", "capability", deps.operationalStateShow),
    defineDirectRoute("learned_preferences_list", "capability", deps.learnedPreferencesList),
    defineDirectRoute(
      "learned_preferences_delete",
      "capability",
      deps.learnedPreferencesDelete,
    ),
    defineDirectRoute("capability_inspection", "capability", deps.capabilityInspection),
    defineDirectRoute("active_goal", "capability", deps.activeGoal),
    defineDirectRoute("capability_planning", "capability", deps.capabilityPlanning),
  ];
}

export function buildMemoryAndPreferenceDirectRoutes(
  deps: MemoryAndPreferenceDirectRouteDependencies,
): DirectRouteDefinition[] {
  return [
    defineDirectRoute(
      "personal_profile_update",
      "memory-preferences",
      deps.personalProfileUpdate,
    ),
    defineDirectRoute(
      "personal_profile_delete",
      "memory-preferences",
      deps.personalProfileDelete,
    ),
    defineDirectRoute("user_preferences", "memory-preferences", deps.userPreferences),
    defineDirectRoute("active_goals_list", "memory-preferences", deps.activeGoalsList),
    defineDirectRoute("active_goal_save", "memory-preferences", deps.activeGoalSave),
    defineDirectRoute(
      "active_goal_progress_update",
      "memory-preferences",
      deps.activeGoalProgressUpdate,
    ),
    defineDirectRoute("active_goal_delete", "memory-preferences", deps.activeGoalDelete),
    defineDirectRoute("personal_memory_list", "memory-preferences", deps.personalMemoryList),
    defineDirectRoute("personal_memory_save", "memory-preferences", deps.personalMemorySave),
    defineDirectRoute(
      "personal_memory_update",
      "memory-preferences",
      deps.personalMemoryUpdate,
    ),
    defineDirectRoute(
      "personal_memory_delete",
      "memory-preferences",
      deps.personalMemoryDelete,
    ),
  ];
}
