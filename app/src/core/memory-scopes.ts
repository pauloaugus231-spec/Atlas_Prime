import type { MemoryEntityKind, MemoryEntityRecord } from "../types/memory-entities.js";

export type MemoryScope = "profile" | "project" | "operational" | "temporary";

const PROFILE_KINDS: MemoryEntityKind[] = ["contact"];
const PROJECT_KINDS: MemoryEntityKind[] = ["project", "lead", "content_item", "research_session"];
const OPERATIONAL_KINDS: MemoryEntityKind[] = ["task", "approval", "workflow_run"];

export function resolveMemoryScope(entity: MemoryEntityRecord): MemoryScope {
  const tags = entity.tags.map((tag) => tag.trim().toLowerCase());
  if (tags.includes("temporary")) {
    return "temporary";
  }
  if (PROFILE_KINDS.includes(entity.kind)) {
    return "profile";
  }
  if (PROJECT_KINDS.includes(entity.kind)) {
    return "project";
  }
  if (OPERATIONAL_KINDS.includes(entity.kind)) {
    return "operational";
  }
  return "temporary";
}
