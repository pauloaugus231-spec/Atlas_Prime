import type { AgentRunResult } from "./agent-core.js";
import {
  DirectRouteRunner,
  type DirectRouteDefinition,
  type DirectRouteExecutionInput,
} from "./direct-route-runner.js";
import {
  buildCapabilityDirectRoutes,
  buildContentDirectRoutes,
  buildConversationDirectRoutes,
  buildEmailDirectRoutes,
  buildGoogleWorkspaceDirectRoutes,
  buildKnowledgeAndProjectDirectRoutes,
  buildMemoryAndPreferenceDirectRoutes,
  buildMessagingDirectRoutes,
  buildOperationalDirectRoutes,
  buildReviewDirectRoutes,
  buildWorkflowDirectRoutes,
  type CapabilityDirectRouteDependencies,
  type ContentDirectRouteDependencies,
  type ConversationDirectRouteDependencies,
  type EmailDirectRouteDependencies,
  type GoogleWorkspaceDirectRouteDependencies,
  type KnowledgeAndProjectDirectRouteDependencies,
  type MemoryAndPreferenceDirectRouteDependencies,
  type MessagingDirectRouteDependencies,
  type OperationalDirectRouteDependencies,
  type ReviewDirectRouteDependencies,
  type WorkflowDirectRouteDependencies,
} from "./direct-routes/index.js";

export interface AgentDirectRouteServiceDependencies {
  conversation: ConversationDirectRouteDependencies;
  capability: CapabilityDirectRouteDependencies;
  memoryAndPreference: MemoryAndPreferenceDirectRouteDependencies;
  operational: OperationalDirectRouteDependencies;
  workflow: WorkflowDirectRouteDependencies;
  review: ReviewDirectRouteDependencies;
  googleWorkspace: GoogleWorkspaceDirectRouteDependencies;
  messaging: MessagingDirectRouteDependencies;
  knowledgeAndProject: KnowledgeAndProjectDirectRouteDependencies;
  content: ContentDirectRouteDependencies;
  email: EmailDirectRouteDependencies;
}

export type AgentDirectRouteFallback = (
  input: DirectRouteExecutionInput,
) => Promise<AgentRunResult | null>;

export class AgentDirectRouteService {
  private routeDefinitions?: DirectRouteDefinition[];

  constructor(
    private readonly runner: DirectRouteRunner,
    private readonly deps: AgentDirectRouteServiceDependencies,
    private readonly fallback?: AgentDirectRouteFallback,
  ) {}

  private getRouteDefinitions(): DirectRouteDefinition[] {
    if (!this.routeDefinitions) {
      this.routeDefinitions = [
        ...buildConversationDirectRoutes(this.deps.conversation),
        ...buildCapabilityDirectRoutes(this.deps.capability),
        ...buildMemoryAndPreferenceDirectRoutes(this.deps.memoryAndPreference),
        ...buildOperationalDirectRoutes(this.deps.operational),
        ...buildWorkflowDirectRoutes(this.deps.workflow),
        ...buildReviewDirectRoutes(this.deps.review),
        ...buildGoogleWorkspaceDirectRoutes(this.deps.googleWorkspace),
        ...buildMessagingDirectRoutes(this.deps.messaging),
        ...buildKnowledgeAndProjectDirectRoutes(this.deps.knowledgeAndProject),
        ...buildContentDirectRoutes(this.deps.content),
        ...buildEmailDirectRoutes(this.deps.email),
      ];
    }

    return this.routeDefinitions;
  }

  async run(input: DirectRouteExecutionInput): Promise<AgentRunResult | null> {
    return this.runner.run(
      input,
      this.getRouteDefinitions(),
      this.fallback,
    );
  }
}
