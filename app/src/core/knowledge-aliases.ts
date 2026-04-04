import type { ReadableRootKey } from "./file-access-policy.js";

export interface KnowledgeAliasDefinition {
  id: string;
  label: string;
  terms: string[];
  webQueries?: string[];
  officialUrls?: string[];
  preferredDomains: string[];
  preferredRoots: ReadableRootKey[];
  localPaths: Array<{
    root: ReadableRootKey;
    path: string;
  }>;
}

export interface ResolvedKnowledgeAlias extends KnowledgeAliasDefinition {
  matchedTerms: string[];
  score: number;
}

const ALIASES: KnowledgeAliasDefinition[] = [
  {
    id: "dias_da_cruz",
    label: "Albergue Dias da Cruz",
    terms: ["dias da cruz", "albergue dias da cruz", "abrigo dias da cruz"],
    webQueries: ['"Dias da Cruz" Porto Alegre', '"Albergue Dias da Cruz" Porto Alegre', '"Instituto Espírita Dias da Cruz" Porto Alegre'],
    officialUrls: [
      "https://prefeitura.poa.br/fasc/albergue",
      "https://prefeitura.poa.br/smas/albergue",
      "https://prefeitura.poa.br/gp/noticias/capital-tera-dois-novos-albergues-para-pessoas-em-situacao-de-rua",
      "https://iedc.org.br",
      "https://iedc.org.br/contato/",
      "https://iedc.org.br/nossa-atuacao/",
      "https://estado.rs.gov.br/albergue-dias-da-cruz-e-tema-do-cidadania-desta-quinta-feira",
      "https://www.mprs.mp.br/media/areas/principal/arquivos/imagem/guia_de_integracao_social.pdf",
    ],
    preferredDomains: ["prefeitura.poa.br", "portoalegre.rs.gov.br", "mprs.mp.br", "iedc.org.br", "estado.rs.gov.br"],
    preferredRoots: ["authorized_dev", "authorized_social"],
    localPaths: [
      { root: "authorized_dev", path: "memorando_digital" },
      { root: "authorized_dev", path: "dias_da_cruz" },
      { root: "authorized_social", path: "." },
    ],
  },
  {
    id: "seas_paefi",
    label: "SEAS PAEFI",
    terms: ["seas paefi", "paefi", "seas"],
    preferredDomains: [],
    preferredRoots: ["authorized_social", "authorized_dev"],
    localPaths: [
      { root: "authorized_social", path: "SEAS_PAEFI" },
      { root: "authorized_dev", path: "Abordagem" },
    ],
  },
  {
    id: "abordagem",
    label: "Projeto Abordagem",
    terms: ["abordagem", "chat seas", "seas abordagem"],
    preferredDomains: [],
    preferredRoots: ["authorized_dev", "authorized_social"],
    localPaths: [
      { root: "authorized_dev", path: "Abordagem" },
      { root: "authorized_social", path: "." },
    ],
  },
];

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveKnowledgeAlias(query: string): ResolvedKnowledgeAlias | undefined {
  const normalizedQuery = normalize(query);
  const candidates = ALIASES.map((alias) => {
    const matchedTerms = alias.terms.filter((term) => normalizedQuery.includes(normalize(term)));
    const score = matchedTerms.reduce((total, term) => total + Math.max(20, term.length * 2), 0);
    return {
      alias,
      matchedTerms,
      score,
    };
  })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);

  const best = candidates[0];
  if (!best) {
    return undefined;
  }

  return {
    ...best.alias,
    matchedTerms: best.matchedTerms,
    score: best.score,
  };
}

export function inferPreferredDomains(query: string, alias?: ResolvedKnowledgeAlias): string[] {
  const normalizedQuery = normalize(query);
  const domains = new Set<string>(alias?.preferredDomains ?? []);

  if (
    normalizedQuery.includes("porto alegre") ||
    normalizedQuery.includes("albergue") ||
    normalizedQuery.includes("abrigo") ||
    normalizedQuery.includes("fasc") ||
    normalizedQuery.includes("situacao de rua") ||
    normalizedQuery.includes("situação de rua")
  ) {
    domains.add("prefeitura.poa.br");
    domains.add("portoalegre.rs.gov.br");
    domains.add("mprs.mp.br");
  }

  if (normalizedQuery.includes("prefeitura")) {
    domains.add("prefeitura.poa.br");
  }

  return [...domains];
}
