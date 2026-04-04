import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { defineToolPlugin } from "../types/plugin.js";

interface ExportGrowthReportParameters {
  path?: string;
  include_done?: boolean;
  limit?: number;
}

function buildReportMarkdown(input: {
  summary: string;
  ranked: ReturnType<typeof inputPlaceholderRank>;
  focus: ReturnType<typeof inputPlaceholderFocus>;
}): string {
  const lines: string[] = [
    "# Growth Report",
    "",
    `Gerado em: ${new Date().toISOString()}`,
    "",
    "## Memory Summary",
    "",
    input.summary || "Nenhum item salvo na memoria operacional.",
    "",
    "## Daily Focus",
    "",
  ];

  if (input.focus.length === 0) {
    lines.push("Nenhum foco diario disponivel.");
  } else {
    for (const entry of input.focus) {
      lines.push(`- ${entry.item.title} (score ${entry.score})`);
      lines.push(`  - Motivo: ${entry.whyNow}`);
      lines.push(`  - Proxima acao: ${entry.nextAction}`);
    }
  }

  lines.push("", "## Ranked Backlog", "");
  if (input.ranked.length === 0) {
    lines.push("Nenhum item ranqueado.");
  } else {
    for (const entry of input.ranked) {
      lines.push(`- ${entry.item.title} (score ${entry.score})`);
      lines.push(`  - Categoria: ${entry.item.category}`);
      lines.push(`  - Etapa: ${entry.item.stage}`);
      lines.push(`  - Razao: ${entry.reason}`);
      lines.push(`  - Acao sugerida: ${entry.recommendedAction}`);
    }
  }

  return lines.join("\n");
}

type RankedItems = Array<{
  item: {
    title: string;
    category: string;
    stage: string;
  };
  score: number;
  reason: string;
  recommendedAction: string;
}>;

type DailyFocus = Array<{
  item: {
    title: string;
  };
  score: number;
  whyNow: string;
  nextAction: string;
}>;

function inputPlaceholderRank(): RankedItems {
  return [];
}

function inputPlaceholderFocus(): DailyFocus {
  return [];
}

export default defineToolPlugin<ExportGrowthReportParameters>({
  name: "export_growth_report",
  description:
    "Writes a markdown report into the workspace with memory summary, daily focus and ranked backlog.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Relative path inside the workspace. Defaults to reports/growth-report-YYYY-MM-DD.md",
      },
      include_done: {
        type: "boolean",
        description: "Whether done items should be included in backlog ranking.",
        default: false,
      },
      limit: {
        type: "integer",
        description: "Maximum number of ranked items in the report.",
        default: 10,
      },
    },
    additionalProperties: false,
  },
  async execute(parameters, context) {
    const dateStamp = new Date().toISOString().slice(0, 10);
    const relativePath = parameters.path?.trim() || `reports/growth-report-${dateStamp}.md`;
    const targetPath = context.fileAccess.resolveWorkspacePath(relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });

    const ranked = context.memory.rankItems({
      includeDone: parameters.include_done,
      limit: parameters.limit ?? 10,
    });
    const focus = context.memory.getDailyFocus(3);
    const markdown = buildReportMarkdown({
      summary: context.memory.getContextSummary(),
      ranked,
      focus,
    });

    await writeFile(targetPath, markdown, "utf8");

    return {
      ok: true,
      path: relativePath,
      absolute_path: targetPath,
      ranked_items: ranked.length,
      focus_items: focus.length,
      chars_written: markdown.length,
    };
  },
});
