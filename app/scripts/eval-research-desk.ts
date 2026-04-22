import process from "node:process";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { ResearchKnowledgeDirectService } from "../src/core/research-knowledge-direct-service.js";
import { ResearchMemoryStore } from "../src/core/research/research-memory-store.js";
import { ResearchDeskService } from "../src/core/research/research-desk-service.js";
import { SourcePolicy } from "../src/core/research/source-policy.js";
import type { Logger } from "../src/types/logger.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

class SilentLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  child(): Logger {
    return this;
  }
}

async function run(): Promise<void> {
  const logger = new SilentLogger();
  const sandboxDir = mkdtempSync(path.join(tmpdir(), "atlas-research-desk-"));
  const dbPath = path.join(sandboxDir, "research.sqlite");
  const results: EvalResult[] = [];

  try {
    const desk = new ResearchDeskService(
      new ResearchMemoryStore(dbPath, logger),
      new SourcePolicy(),
      () => ({
        search: async () => [
          {
            title: "Manual oficial para oficinas",
            url: "https://www.gov.br/transportes/oficinas",
            sourceHost: "www.gov.br",
            snippet: "Fonte oficial sobre requisitos básicos para oficinas.",
            excerpt: "Checklist operacional para oficinas mecânicas.",
          },
          {
            title: "Documentação técnica de manutenção",
            url: "https://developers.google.com/workspace/docs/example",
            sourceHost: "developers.google.com",
            snippet: "Documentação técnica complementar.",
            excerpt: "Referência técnica útil.",
          },
          {
            title: "Discussão em fórum",
            url: "https://forum.exemplo.com/oficinas",
            sourceHost: "forum.exemplo.com",
            snippet: "Relato informal de mercado.",
            excerpt: "Opiniões informais de operadores.",
          },
        ],
      }),
      logger,
    );
    const direct = new ResearchKnowledgeDirectService({
      logger,
      researchDesk: desk,
      graphQuery: { explain: () => "" },
      buildBaseMessages: () => [],
    });

    const saved = await desk.researchAndSave({ topic: "oficinas mecânicas" });
    const rendered = desk.renderSaved("oficinas mecânicas");
    results.push({
      name: "research_desk_persists_sources_and_derives_risks",
      passed:
        saved.sources.some((item) => item.sourceKind === "official" && item.reliability === "high")
        && saved.sources.some((item) => item.sourceKind === "docs" && item.reliability === "high")
        && saved.risks.some((item) => item.includes("forum.exemplo.com"))
        && rendered.includes("Pesquisa: oficinas mecânicas"),
      detail: JSON.stringify({ saved, rendered }, null, 2),
    });

    const directResearchReply = await direct.tryRunResearch({
      userPrompt: "pesquise e salve sobre oficinas mecânicas",
      requestId: "research-direct-1",
      orchestration: { channel: "telegram", recentMessages: [] },
    });
    const directRecallReply = await direct.tryRunResearch({
      userPrompt: "o que você pesquisou sobre oficinas mecânicas?",
      requestId: "research-direct-2",
      orchestration: { channel: "telegram", recentMessages: [] },
    });
    results.push({
      name: "research_desk_direct_service_handles_create_and_recall",
      passed:
        directResearchReply?.reply.includes("Pesquisa: oficinas mecânicas") === true
        && directRecallReply?.reply.includes("Próximo passo") === true,
      detail: JSON.stringify({ directResearchReply, directRecallReply }, null, 2),
    });
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }

  const failures = results.filter((item) => !item.passed);
  for (const item of results.filter((entry) => entry.passed)) {
    console.log(`PASS ${item.name}`);
  }
  if (failures.length > 0) {
    console.error("");
    for (const failure of failures) {
      console.error(`FAIL ${failure.name}`);
      if (failure.detail) {
        console.error(failure.detail);
      }
      console.error("");
    }
    process.exitCode = 1;
    return;
  }

  console.log(`\nResearch desk evals ok: ${results.length}/${results.length}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
