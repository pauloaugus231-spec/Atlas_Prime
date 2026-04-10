import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { IntentRouter } from "../src/core/intent-router.js";

interface IntentEvalCase {
  name: string;
  prompt: string;
  expect: {
    primaryDomain: string;
    actionMode: string;
    compoundIntent: boolean;
  };
}

function loadCases(): IntentEvalCase[] {
  const filePath = path.resolve(process.cwd(), "evals", "intent-cases.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as IntentEvalCase[];
}

function main() {
  const router = new IntentRouter();
  const cases = loadCases();
  const failures: string[] = [];

  for (const item of cases) {
    const result = router.resolve(item.prompt);
    const actual = {
      primaryDomain: result.orchestration.route.primaryDomain,
      actionMode: result.orchestration.route.actionMode,
      compoundIntent: result.compoundIntent,
    };

    const mismatch = Object.entries(item.expect)
      .filter(([key, value]) => actual[key as keyof typeof actual] !== value)
      .map(([key, value]) => `${key}: esperado=${value} atual=${actual[key as keyof typeof actual]}`);

    if (mismatch.length > 0) {
      failures.push(
        [
          `FAIL ${item.name}`,
          `prompt: ${item.prompt}`,
          ...mismatch,
        ].join("\n"),
      );
      continue;
    }

    console.log(`PASS ${item.name}`);
  }

  if (failures.length > 0) {
    console.error("");
    for (const failure of failures) {
      console.error(failure);
      console.error("");
    }
    process.exitCode = 1;
    return;
  }

  console.log(`\nIntent evals ok: ${cases.length}/${cases.length}`);
}

main();
