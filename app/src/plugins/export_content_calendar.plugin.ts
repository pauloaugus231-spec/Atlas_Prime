import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ContentItemRecord } from "../types/content-ops.js";
import { CONTENT_PLATFORMS, CONTENT_STATUSES } from "../types/content-ops.js";
import { defineToolPlugin } from "../types/plugin.js";

interface ExportContentCalendarParameters {
  path: string;
  platform?: (typeof CONTENT_PLATFORMS)[number];
  status?: (typeof CONTENT_STATUSES)[number];
  limit?: number;
  overwrite?: boolean;
}

function renderMarkdown(items: ContentItemRecord[]): string {
  const lines: string[] = ["# Calendario de Conteudo", ""];
  for (const item of items) {
    lines.push(`## ${String(item.title)}`);
    lines.push(`- Plataforma: ${String(item.platform)}`);
    lines.push(`- Formato: ${String(item.format)}`);
    lines.push(`- Status: ${String(item.status)}`);
    lines.push(`- Data alvo: ${item.targetDate ? String(item.targetDate) : "sem data"}`);
    lines.push(`- Pilar: ${item.pillar ? String(item.pillar) : "nao definido"}`);
    if (item.hook) {
      lines.push(`- Hook: ${String(item.hook)}`);
    }
    if (item.callToAction) {
      lines.push(`- CTA: ${String(item.callToAction)}`);
    }
    if (item.notes) {
      lines.push(`- Notas: ${String(item.notes)}`);
    }
    lines.push("");
  }
  if (!items.length) {
    lines.push("Nenhum item encontrado para os filtros informados.");
  }
  return lines.join("\n");
}

export default defineToolPlugin<ExportContentCalendarParameters>({
  name: "export_content_calendar",
  description: "Exports a markdown content calendar inside the workspace using persisted content items.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative markdown output path." },
      platform: { type: "string", enum: [...CONTENT_PLATFORMS] },
      status: { type: "string", enum: [...CONTENT_STATUSES] },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      overwrite: { type: "boolean", default: false },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute(parameters, context) {
    const items = context.contentOps.listItems({
      platform: parameters.platform,
      status: parameters.status,
      limit: parameters.limit ?? 20,
    });
    const targetPath = context.fileAccess.resolveWorkspacePath(parameters.path);
    await mkdir(path.dirname(targetPath), { recursive: true });
    if (!parameters.overwrite) {
      try {
        await access(targetPath);
        throw new Error(`File already exists: ${targetPath}`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("File already exists")) {
          throw error;
        }
      }
    }
    const markdown = renderMarkdown(items);
    await writeFile(targetPath, markdown, "utf8");
    return {
      ok: true,
      absolute_path: targetPath,
      item_count: items.length,
      chars_written: markdown.length,
    };
  },
});
