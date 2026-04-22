import { spawnSync } from "node:child_process";
import process from "node:process";

const checks = [
  "eval:request-orchestration",
  "eval:autonomy-loop",
  "eval:autonomy-audit",
  "eval:commitment-extractor",
  "eval:memory-candidates",
  "eval:briefing-profiles",
  "eval:external-reasoning-mode",
  "eval:human-model",
  "eval:account-linking",
  "eval:destination-privacy",
  "eval:command-center",
  "eval:routing-turn-frame",
  "eval:routing-selector",
  "eval:routing-shadow",
  "eval:routing-briefing",
  "eval:life-domains",
  "eval:missions",
  "eval:research-desk",
  "eval:knowledge-graph",
  "eval:delivery-expansion",
  "eval:operator-modes",
  "eval:self-improvement",
  "e2e:critical",
];

let failed = false;
for (const check of checks) {
  console.log(`\n=== ${check} ===`);
  const result = spawnSync("npm", ["run", check], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.status !== 0) {
    failed = true;
    console.error(`\nRelease gate falhou em ${check}.`);
    break;
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(`\nRelease gate ok: ${checks.length}/${checks.length}`);
}
