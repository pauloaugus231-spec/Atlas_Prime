import process from "node:process";
import { AgentDirectServiceRegistry } from "../src/core/agent-direct-service-registry.js";

type EvalResult = {
  name: string;
  passed: boolean;
  detail?: string;
};

function assert(name: string, passed: boolean, detail?: string): EvalResult {
  return { name, passed, detail };
}

async function run(): Promise<void> {
  const results: EvalResult[] = [];
  const calls: Record<string, number> = {
    google: 0,
    external: 0,
    content: 0,
  };

  const registry = new AgentDirectServiceRegistry({
    googleWorkspaceDirectService: () => {
      calls.google += 1;
      return { kind: "google-service" } as any;
    },
    externalIntelligenceDirectService: () => {
      calls.external += 1;
      return { kind: "external-service" } as any;
    },
    capabilityActionService: () => ({ kind: "capability-action" } as any),
    capabilityInspectionService: () => ({ kind: "capability-inspection" } as any),
    knowledgeProjectDirectService: () => ({ kind: "knowledge-project" } as any),
    operationalContextDirectService: () => ({ kind: "operational-context" } as any),
    memoryContactDirectService: () => ({ kind: "memory-contact" } as any),
    workflowDirectService: () => ({ kind: "workflow" } as any),
    operationalReviewDirectService: () => ({ kind: "operational-review" } as any),
    workspaceMacDirectService: () => ({ kind: "workspace-mac" } as any),
    emailDirectService: () => ({ kind: "email" } as any),
    contentDirectService: () => {
      calls.content += 1;
      return { kind: "content-service" } as any;
    },
    contentGenerationDirectService: () => ({ kind: "content-generation-service" } as any),
  });

  const googleFirst = registry.getGoogleWorkspaceDirectService();
  const googleSecond = registry.getGoogleWorkspaceDirectService();
  results.push(assert(
    "agent_direct_service_registry_caches_google_workspace_service_once",
    googleFirst === googleSecond && calls.google === 1,
    JSON.stringify({ calls, sameInstance: googleFirst === googleSecond }),
  ));

  const externalFirst = registry.getExternalIntelligenceDirectService();
  const externalSecond = registry.getExternalIntelligenceDirectService();
  results.push(assert(
    "agent_direct_service_registry_caches_external_intelligence_service_once",
    externalFirst === externalSecond && calls.external === 1,
    JSON.stringify({ calls, sameInstance: externalFirst === externalSecond }),
  ));

  const contentFirst = registry.getContentDirectService();
  const contentSecond = registry.getContentDirectService();
  results.push(assert(
    "agent_direct_service_registry_caches_content_service_once",
    contentFirst === contentSecond && calls.content === 1,
    JSON.stringify({ calls, sameInstance: contentFirst === contentSecond }),
  ));

  const crossServiceIsolation =
    registry.getGoogleWorkspaceDirectService() !== registry.getContentDirectService()
    && registry.getExternalIntelligenceDirectService() !== registry.getContentDirectService();
  results.push(assert(
    "agent_direct_service_registry_keeps_service_instances_isolated_by_key",
    crossServiceIsolation,
    JSON.stringify({
      googleKind: (registry.getGoogleWorkspaceDirectService() as any).kind,
      externalKind: (registry.getExternalIntelligenceDirectService() as any).kind,
      contentKind: (registry.getContentDirectService() as any).kind,
    }),
  ));

  const failed = results.filter((item) => !item.passed);
  for (const result of results) {
    const prefix = result.passed ? "PASS" : "FAIL";
    const suffix = result.detail ? ` :: ${result.detail}` : "";
    console.log(`${prefix} ${result.name}${suffix}`);
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

await run();
