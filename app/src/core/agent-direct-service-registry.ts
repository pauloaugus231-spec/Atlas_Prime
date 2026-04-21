import type { AutonomyDirectService } from "./autonomy/autonomy-direct-service.js";
import type { CapabilityActionService } from "./capability-action-service.js";
import type { CapabilityInspectionService } from "./capability-inspection-service.js";
import type { ContentDirectService } from "./content-direct-service.js";
import type { ContentGenerationDirectService } from "./content-generation-direct-service.js";
import type { EmailDirectService } from "./email-direct-service.js";
import type { ExternalIntelligenceDirectService } from "./external-intelligence-direct-service.js";
import type { GoogleWorkspaceDirectService } from "./google-workspace-direct-service.js";
import type { KnowledgeProjectDirectService } from "./knowledge-project-direct-service.js";
import type { MemoryContactDirectService } from "./memory-contact-direct-service.js";
import type { OperationalContextDirectService } from "./operational-context-direct-service.js";
import type { OperationalReviewDirectService } from "./operational-review-direct-service.js";
import type { WorkflowDirectService } from "./workflow-direct-service.js";
import type { WorkspaceMacDirectService } from "./workspace-mac-direct-service.js";

export interface AgentDirectServiceRegistryFactories {
  autonomyDirectService: () => AutonomyDirectService;
  googleWorkspaceDirectService: () => GoogleWorkspaceDirectService;
  externalIntelligenceDirectService: () => ExternalIntelligenceDirectService;
  capabilityActionService: () => CapabilityActionService;
  capabilityInspectionService: () => CapabilityInspectionService;
  knowledgeProjectDirectService: () => KnowledgeProjectDirectService;
  operationalContextDirectService: () => OperationalContextDirectService;
  memoryContactDirectService: () => MemoryContactDirectService;
  workflowDirectService: () => WorkflowDirectService;
  operationalReviewDirectService: () => OperationalReviewDirectService;
  workspaceMacDirectService: () => WorkspaceMacDirectService;
  emailDirectService: () => EmailDirectService;
  contentDirectService: () => ContentDirectService;
  contentGenerationDirectService: () => ContentGenerationDirectService;
}

type ServiceKey = keyof AgentDirectServiceRegistryFactories;
type ServiceInstance<K extends ServiceKey> = ReturnType<AgentDirectServiceRegistryFactories[K]>;

export class AgentDirectServiceRegistry {
  private readonly cache = new Map<ServiceKey, unknown>();

  constructor(private readonly factories: AgentDirectServiceRegistryFactories) {}

  private resolve<K extends ServiceKey>(key: K): ServiceInstance<K> {
    const cached = this.cache.get(key);
    if (cached) {
      return cached as ServiceInstance<K>;
    }

    const service = this.factories[key]();
    this.cache.set(key, service);
    return service as ServiceInstance<K>;
  }

  getGoogleWorkspaceDirectService(): GoogleWorkspaceDirectService {
    return this.resolve("googleWorkspaceDirectService");
  }

  getAutonomyDirectService(): AutonomyDirectService {
    return this.resolve("autonomyDirectService");
  }

  getExternalIntelligenceDirectService(): ExternalIntelligenceDirectService {
    return this.resolve("externalIntelligenceDirectService");
  }

  getCapabilityActionService(): CapabilityActionService {
    return this.resolve("capabilityActionService");
  }

  getCapabilityInspectionService(): CapabilityInspectionService {
    return this.resolve("capabilityInspectionService");
  }

  getKnowledgeProjectDirectService(): KnowledgeProjectDirectService {
    return this.resolve("knowledgeProjectDirectService");
  }

  getOperationalContextDirectService(): OperationalContextDirectService {
    return this.resolve("operationalContextDirectService");
  }

  getMemoryContactDirectService(): MemoryContactDirectService {
    return this.resolve("memoryContactDirectService");
  }

  getWorkflowDirectService(): WorkflowDirectService {
    return this.resolve("workflowDirectService");
  }

  getOperationalReviewDirectService(): OperationalReviewDirectService {
    return this.resolve("operationalReviewDirectService");
  }

  getWorkspaceMacDirectService(): WorkspaceMacDirectService {
    return this.resolve("workspaceMacDirectService");
  }

  getEmailDirectService(): EmailDirectService {
    return this.resolve("emailDirectService");
  }

  getContentDirectService(): ContentDirectService {
    return this.resolve("contentDirectService");
  }

  getContentGenerationDirectService(): ContentGenerationDirectService {
    return this.resolve("contentGenerationDirectService");
  }
}
