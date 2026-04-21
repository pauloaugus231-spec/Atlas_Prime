import { normalizeEmailAnalysisText } from "../integrations/email/email-analysis.js";
import type { ReadableRootKey } from "./file-access-policy.js";

function includesAny(source: string, tokens: string[]): boolean {
  return tokens.some((token) => source.includes(token));
}

export function isCaseNotesPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return [
    "notas sociais",
    "anotacoes sociais",
    "anotações sociais",
    "casos sociais",
    "atendimentos sociais",
    "notas da area social",
  ].some((token) => normalized.includes(token));
}

export function isProjectScanPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return (
    includesAny(normalized, [
      "analise o projeto",
      "análise o projeto",
      "analisar o projeto",
      "mapeie o projeto",
      "escaneie o projeto",
      "scan do projeto",
      "resuma o projeto",
      "status do projeto",
      "git status do projeto",
      "repositorio",
      "repositório",
    ]) &&
    includesAny(normalized, ["projeto", "repositorio", "repositório", "git", "codigo", "código"])
  );
}

export function extractSafeExecRequest(prompt: string): { argv: string[]; root: ReadableRootKey; path?: string } | null {
  const normalized = normalizeEmailAnalysisText(prompt);
  const root = extractProjectRoot(prompt);
  const path = extractProjectPath(prompt) ?? ".";

  if (normalized.includes("npm run build") || normalized.includes("rode o build") || normalized.includes("executar build")) {
    return {
      argv: ["npm", "run", "build"],
      root,
      path,
    };
  }

  if (normalized.includes("npm test") || normalized.includes("rode os testes") || normalized.includes("rodar testes")) {
    return {
      argv: ["npm", "test"],
      root,
      path,
    };
  }

  if (normalized.includes("npm ci")) {
    return {
      argv: ["npm", "ci"],
      root,
      path,
    };
  }

  if (normalized.includes("npm install")) {
    return {
      argv: ["npm", "install"],
      root,
      path,
    };
  }

  if (normalized.includes("pnpm build")) {
    return {
      argv: ["pnpm", "build"],
      root,
      path,
    };
  }

  if (normalized.includes("pnpm test")) {
    return {
      argv: ["pnpm", "test"],
      root,
      path,
    };
  }

  if (normalized.includes("pnpm install")) {
    return {
      argv: ["pnpm", "install"],
      root,
      path,
    };
  }

  if (normalized.includes("yarn build")) {
    return {
      argv: ["yarn", "build"],
      root,
      path,
    };
  }

  if (normalized.includes("yarn test")) {
    return {
      argv: ["yarn", "test"],
      root,
      path,
    };
  }

  if (normalized.includes("yarn install")) {
    return {
      argv: ["yarn", "install"],
      root,
      path,
    };
  }

  if (normalized.includes("git status")) {
    return {
      argv: ["git", "status", "--short"],
      root,
      path,
    };
  }

  if (normalized.includes("git diff --stat") || normalized.includes("diff stat")) {
    return {
      argv: ["git", "diff", "--stat"],
      root,
      path,
    };
  }

  if (normalized.includes("git branch")) {
    return {
      argv: ["git", "branch", "--show-current"],
      root,
      path,
    };
  }

  return null;
}

export function extractProjectRoot(prompt: string): ReadableRootKey {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (normalized.includes("workspace")) {
    return "workspace";
  }
  if (normalized.includes("conteudo") || normalized.includes("conteúdo")) {
    return "authorized_content";
  }
  if (normalized.includes("financeiro")) {
    return "authorized_finance";
  }
  if (normalized.includes("social")) {
    return "authorized_social";
  }
  if (normalized.includes("admin")) {
    return "authorized_admin";
  }
  if (normalized.includes("projetos autorizados")) {
    return "authorized_projects";
  }
  return "authorized_dev";
}

export function extractProjectPath(prompt: string): string | undefined {
  const clean = (value: string | undefined): string | undefined => {
    const cleaned = value
      ?.trim()
      .replace(/^["“”']+/, "")
      .replace(/["“”']+$/g, "")
      .replace(/[.,;:!?]+$/g, "")
      .trim();
    return cleaned || undefined;
  };

  const quotedMatch = prompt.match(
    /(?:pasta|diretorio|diretório|caminho|path|projeto|repositorio|repositório)\s+["“]([^"”]+?)["”]/i,
  );
  const quoted = clean(quotedMatch?.[1]);
  if (quoted) {
    return quoted;
  }

  const unquotedMatch = prompt.match(
    /(?:pasta|diretorio|diretório|caminho|path|projeto|repositorio|repositório)\s+(.+?)(?=(?:\s+(?:dentro\s+de|no\s+root|em\s+(?:authorized_|projetos\s+autorizados|workspace(?:\s+origem)?|conteudo|conteúdo|financeiro|social|admin)|para\s+(?:o\s+)?workspace|no\s+(?:meu\s+)?mac|no\s+computador|e\s+(?:rode|execute|analise|análise|leia|resuma|espelhe|copie|clone))|[?.!,;:]|$))/i,
  );
  return clean(unquotedMatch?.[1]);
}

export function isMirrorProjectPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return (
    includesAny(normalized, [
      "espelhe",
      "espelhar",
      "crie um espelho",
      "copie o projeto",
      "copiar projeto",
      "clone local",
      "traga para o workspace",
    ]) && includesAny(normalized, ["projeto", "workspace", "pasta", "repositorio", "repositório"])
  );
}

export function extractMirrorTargetPath(prompt: string): string | undefined {
  const clean = (value: string | undefined): string | undefined => {
    const cleaned = value
      ?.trim()
      .replace(/^["“”']+/, "")
      .replace(/["“”']+$/g, "")
      .replace(/[.,;:!?]+$/g, "")
      .trim();
    return cleaned || undefined;
  };
  const match = prompt.match(
    /(?:para|no|na)\s+(?:o\s+)?workspace(?:\/|\\)?["“]?(.+?)["”]?(?=(?:\s+e\s+(?:rode|execute|analise|análise|leia|resuma|espelhe|copie|clone)|[?.!,;:]|$))/i,
  );
  return clean(match?.[1]);
}

export function extractMirrorSourceRoot(prompt: string): ReadableRootKey {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (normalized.includes("conteudo") || normalized.includes("conteúdo")) {
    return "authorized_content";
  }
  if (normalized.includes("financeiro")) {
    return "authorized_finance";
  }
  if (normalized.includes("social")) {
    return "authorized_social";
  }
  if (normalized.includes("admin")) {
    return "authorized_admin";
  }
  if (normalized.includes("projetos autorizados")) {
    return "authorized_projects";
  }
  if (normalized.includes("workspace origem")) {
    return "workspace";
  }
  return "authorized_dev";
}

export function extractPromptLimit(prompt: string, fallback: number, max: number): number {
  const match = prompt.match(/\b(\d{1,3})\b/);
  if (!match) {
    return fallback;
  }
  const value = Number.parseInt(match[1], 10);
  if (!Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.min(value, max);
}

export function buildAllowedSpacesReply(roots: Record<ReadableRootKey, string>): string {
  return [
    "Espaços autorizados atuais do agente:",
    `- workspace: ${roots.workspace} | escrita liberada para artefatos, logs locais e arquivos do agente`,
    `- authorized_projects: ${roots.authorized_projects} | leitura geral do conjunto autorizado`,
    `- authorized_dev: ${roots.authorized_dev} | projetos, código, SaaS e automações`,
    `- authorized_social: ${roots.authorized_social} | materiais da área social e contexto sensível`,
    `- authorized_content: ${roots.authorized_content} | roteiros, posts, ativos e calendário editorial`,
    `- authorized_finance: ${roots.authorized_finance} | controles de receita e relatórios financeiros`,
    `- authorized_admin: ${roots.authorized_admin} | documentos operacionais e administrativos`,
    "",
    "Regra atual:",
    "- somente o workspace aceita escrita",
    "- os roots autorizados ficam em leitura até você pedir uma política mais ampla",
  ].join("\n");
}

export function buildCaseNotesReply(notes: Array<{
  id: number;
  title: string;
  noteType: string;
  sensitivity: string;
  summary: string;
  nextAction: string | null;
  followUpDate: string | null;
}>): string {
  if (!notes.length) {
    return "Nao ha notas sociais salvas para os filtros informados.";
  }

  return [
    `Notas sociais encontradas: ${notes.length}.`,
    ...notes.map((note) =>
      `- #${note.id} | ${note.sensitivity} | ${note.noteType} | ${note.title} | resumo: ${note.summary}${note.nextAction ? ` | proxima acao: ${note.nextAction}` : ""}${note.followUpDate ? ` | follow-up: ${note.followUpDate}` : ""}`,
    ),
    "",
    "Observacao: manter revisao humana para qualquer uso externo desse conteudo.",
  ].join("\n");
}

export function buildProjectScanReply(project: Record<string, unknown>, gitStatus?: Record<string, unknown>): string {
  const projectTypes = Array.isArray(project.project_types) ? project.project_types.join(", ") : "";
  const scripts = Array.isArray(project.scripts) ? project.scripts.slice(0, 8).join(", ") : "";
  const dependencies = Array.isArray(project.dependencies) ? project.dependencies.slice(0, 8).join(", ") : "";
  const rootDirectories = Array.isArray(project.root_directories)
    ? project.root_directories.slice(0, 8).join(", ")
    : "";
  const rootFiles = Array.isArray(project.root_files) ? project.root_files.slice(0, 8).join(", ") : "";
  const lines = [
    `Resumo do projeto: ${String(project.project_name ?? "(sem nome)")}`,
    `- Root: ${String(project.root ?? "")}`,
    `- Caminho: ${String(project.absolute_path ?? "")}`,
    `- Tipos detectados: ${projectTypes || "nenhum sinal forte detectado"}`,
    `- Diretorios de topo: ${rootDirectories || "nenhum"}`,
    `- Arquivos de topo: ${rootFiles || "nenhum"}`,
    `- Scripts detectados: ${scripts || "nenhum"}`,
    `- Dependencias de destaque: ${dependencies || "nenhuma"}`,
  ];

  if (gitStatus) {
    const branch = typeof gitStatus.branch === "string" ? gitStatus.branch : "";
    const statusLines = Array.isArray(gitStatus.status_lines) ? gitStatus.status_lines : [];
    lines.push(`- Git branch: ${branch || "indisponivel"}`);
    lines.push(`- Git dirty: ${gitStatus.dirty ? "sim" : "nao"}`);
    lines.push(`- Mudancas detectadas: ${statusLines.length ? statusLines.slice(0, 5).join(" | ") : "nenhuma"}`);
  }

  return lines.join("\n");
}

export function buildSafeExecReply(result: {
  argv: string[];
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}): string {
  const lines = [
    `Comando executado: ${result.argv.join(" ")}`,
    `- Diretório: ${result.cwd}`,
    `- Exit code: ${result.exitCode}`,
  ];

  if (result.stdout.trim()) {
    lines.push("", "STDOUT:", result.stdout.trim());
  }
  if (result.stderr.trim()) {
    lines.push("", "STDERR:", result.stderr.trim());
  }

  if (!result.stdout.trim() && !result.stderr.trim()) {
    lines.push("", "Sem saída textual.");
  }

  return lines.join("\n");
}
