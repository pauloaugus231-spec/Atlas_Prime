import { normalizeEmailAnalysisText } from "../integrations/email/email-analysis.js";
import type { GoogleTrendItem } from "./trend-intake.js";

function includesAny(source: string, tokens: string[]): boolean {
  return tokens.some((token) => source.includes(token));
}

export function isContentOverviewPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return [
    "calendario editorial",
    "calendário editorial",
    "fila editorial",
    "queue editorial",
    "fila de conteudo",
    "fila de conteúdo",
    "plano de conteudo",
    "plano de conteúdo",
    "conteudo da semana",
    "conteúdo da semana",
    "meus conteudos",
    "meus conteúdos",
    "itens de conteudo",
    "itens de conteúdo",
  ].some((token) => normalized.includes(token));
}

export function isContentChannelsPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return [
    "canais editoriais",
    "canais de conteudo",
    "canais de conteúdo",
    "meus canais de conteudo",
    "meus canais de conteúdo",
    "canais do riqueza despertada",
    "canal riqueza despertada",
  ].some((token) => normalized.includes(token));
}

export function isContentSeriesPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return [
    "series editoriais",
    "séries editoriais",
    "series de conteudo",
    "séries de conteúdo",
    "series do canal",
    "séries do canal",
    "series do riqueza despertada",
    "séries do riqueza despertada",
  ].some((token) => normalized.includes(token));
}

export function isContentFormatLibraryPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return [
    "formatos de conteudo",
    "formatos de conteúdo",
    "biblioteca de formatos",
    "templates de formato",
    "modelos de formato",
  ].some((token) => normalized.includes(token));
}

export function isContentHookLibraryPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return [
    "biblioteca de hooks",
    "templates de hooks",
    "hooks de conteudo",
    "hooks de conteúdo",
    "ganchos de conteudo",
    "ganchos de conteúdo",
  ].some((token) => normalized.includes(token));
}

export function isContentIdeaGenerationPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return (
    includesAny(normalized, [
      "gere pautas",
      "gerar pautas",
      "gere ideias",
      "gerar ideias",
      "crie pautas",
      "criar pautas",
      "crie ideias",
      "ideias para o canal",
      "pautas para o canal",
    ]) &&
    includesAny(normalized, ["canal", "conteudo", "conteúdo", "riqueza despertada", "youtube", "tiktok"])
  );
}

export function isContentReviewPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return (
    includesAny(normalized, ["aprovar", "aprove", "reprovar", "reprove"]) &&
    includesAny(normalized, ["item", "conteudo", "conteúdo", "pauta", "fila", "#"])
  );
}

export function isContentScriptGenerationPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return (
    includesAny(normalized, [
      "gere roteiro",
      "gerar roteiro",
      "roteirize",
      "roteirizar",
      "escreva o roteiro",
      "script do item",
      "roteiro do item",
    ]) &&
    includesAny(normalized, ["item", "conteudo", "conteúdo", "pauta", "#", "primeiro", "segundo", "terceiro"])
  );
}

export function isContentBatchPlanningPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return (
    includesAny(normalized, [
      "lote inicial",
      "batch inicial",
      "monte o lote",
      "monte um lote",
      "gere lote",
      "planeje lote",
      "lote de videos",
      "lote de vídeos",
      "batch de videos",
      "batch de vídeos",
    ]) &&
    includesAny(normalized, ["conteudo", "conteúdo", "videos", "vídeos", "canal", "riqueza despertada"])
  );
}

export function isContentBatchGenerationPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return (
    includesAny(normalized, [
      "gere o lote",
      "gerar o lote",
      "gere os 5 pacotes",
      "gerar os 5 pacotes",
      "gere o pacote do lote",
      "gere os pacotes do lote",
      "lote completo",
      "batch completo",
    ]) &&
    includesAny(normalized, ["conteudo", "conteúdo", "videos", "vídeos", "canal", "riqueza despertada", "lote"])
  );
}

export function isContentDistributionStrategyPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "estrategia de distribuicao",
    "estratégia de distribuição",
    "estrategia de postagem",
    "estratégia de postagem",
    "ordem de publicacao",
    "ordem de publicação",
    "horario de postagem",
    "horário de postagem",
    "slot de postagem",
    "janela de postagem",
  ]);
}

export function isDailyEditorialResearchPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return (
    includesAny(normalized, [
      "research kernel",
      "briefing editorial",
      "rodar pauta do dia",
      "rode a pauta do dia",
      "rode o research",
      "gere a pauta do dia",
      "pesquise trends do dia",
    ]) &&
    includesAny(normalized, ["canal", "riqueza despertada", "youtube", "tiktok", "editorial", "trend", "pauta"])
  );
}

export function extractContentPlatform(prompt: string): string | undefined {
  const normalized = normalizeEmailAnalysisText(prompt);
  const tokens = ["instagram", "tiktok", "youtube", "shorts", "reels", "linkedin", "blog", "email", "telegram"];
  return tokens.find((token) => normalized.includes(token));
}

export function extractContentChannelKey(prompt: string): string | undefined {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (normalized.includes("riqueza_despertada_youtube")) {
    return "riqueza_despertada_youtube";
  }
  if (normalized.includes("riqueza_despertada_tiktok")) {
    return "riqueza_despertada_tiktok";
  }
  if (normalized.includes("riqueza despertada")) {
    if (normalized.includes("tiktok")) {
      return "riqueza_despertada_tiktok";
    }
    if (normalized.includes("youtube") || normalized.includes("shorts")) {
      return "riqueza_despertada_youtube";
    }
  }
  return undefined;
}

export function inferDefaultContentChannelKey(prompt: string): string {
  return extractContentChannelKey(prompt)
    ?? (normalizeEmailAnalysisText(prompt).includes("tiktok")
      ? "riqueza_despertada_tiktok"
      : "riqueza_despertada_youtube");
}

export function extractContentIdeaSeed(prompt: string): string | undefined {
  const topicMatch = prompt.match(
    /(?:sobre|tema|assunto|nicho)\s+["“]?(.+?)["”]?(?=(?:\s+(?:para|pro|no|na)\s+(?:o\s+)?(?:canal|youtube|tiktok)|[?.!,;:]|$))/i,
  );
  return topicMatch?.[1]?.trim();
}

export function extractContentItemId(prompt: string): number | undefined {
  const hashMatch = prompt.match(/#(\d{1,6})\b/);
  if (hashMatch) {
    return Number.parseInt(hashMatch[1], 10);
  }
  const itemMatch = prompt.match(/(?:item|conteudo|conteúdo|pauta)\s+(\d{1,6})\b/i);
  if (itemMatch) {
    return Number.parseInt(itemMatch[1], 10);
  }
  return undefined;
}

export function extractContentQueueOrdinal(prompt: string): number | undefined {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (normalized.includes("primeiro item") || normalized.includes("primeira pauta")) {
    return 1;
  }
  if (normalized.includes("segundo item") || normalized.includes("segunda pauta")) {
    return 2;
  }
  if (normalized.includes("terceiro item") || normalized.includes("terceira pauta")) {
    return 3;
  }
  if (normalized.includes("quarto item") || normalized.includes("quarta pauta")) {
    return 4;
  }
  if (normalized.includes("quinto item") || normalized.includes("quinta pauta")) {
    return 5;
  }
  return undefined;
}

export function extractContentReviewReason(prompt: string): string | undefined {
  const reasonMatch = prompt.match(/(?:porque|motivo|raz[aã]o)\s+(.+)$/i);
  return reasonMatch?.[1]?.trim();
}

export function classifyContentReviewFeedback(reason: string | undefined): string | undefined {
  if (!reason) {
    return undefined;
  }
  const normalized = normalizeEmailAnalysisText(reason);
  if (normalized.includes("hook")) {
    return "hook_fraco";
  }
  if (normalized.includes("confus")) {
    return "confuso";
  }
  if (normalized.includes("genéric") || normalized.includes("generic")) {
    return "generico";
  }
  if (normalized.includes("tens")) {
    return "sem_tensao";
  }
  if (normalized.includes("longo")) {
    return "longo_demais";
  }
  return "reprovado_manual";
}

export function buildFallbackEditorialIdeas(input: {
  channelName: string;
  seed?: string;
  formatKeys: string[];
  seriesKeys: string[];
  limit: number;
}): Array<{
  title: string;
  hook: string;
  pillar: string;
  audience: string;
  formatTemplateKey?: string;
  seriesKey?: string | null;
  notes: string;
}> {
  const topic = input.seed?.trim() || "dinheiro e renda";
  const ideas = [
    {
      title: `3 formas reais de aumentar renda com ${topic} sem prometer milagre`,
      hook: "A maioria fala em enriquecer rápido, mas estas 3 vias geram caixa no mundo real.",
      pillar: "formas de fazer dinheiro",
      notes: "Fallback editorial focado em utilidade e retenção.",
    },
    {
      title: `O erro que te impede de transformar habilidade em dinheiro com ${topic}`,
      hook: "Quase todo mundo trava no mesmo ponto quando tenta ganhar dinheiro com o que sabe fazer.",
      pillar: "erros sobre riqueza",
      notes: "Fallback editorial focado em dor + mecanismo.",
    },
    {
      title: `${topic}: serviço, produto ou SaaS? O que gera caixa primeiro`,
      hook: "Antes de pensar em escalar, você precisa escolher o mecanismo certo para gerar caixa.",
      pillar: "modelos de negocio",
      notes: "Fallback editorial comparativo com clareza de mecanismo.",
    },
    {
      title: `Por que disciplina operacional vale mais que motivação para crescer com ${topic}`,
      hook: "Se você depende de motivação, vai quebrar o ritmo antes de ver resultado.",
      pillar: "execucao e disciplina",
      notes: "Fallback editorial com tom contrarian e aplicável.",
    },
    {
      title: `A mentira sobre ${topic} que deixa muita gente presa no zero`,
      hook: "Existe uma crença repetida o tempo todo sobre dinheiro que atrasa qualquer resultado sério.",
      pillar: "erros sobre riqueza",
      notes: "Fallback editorial para série de crenças e mitos.",
    },
  ];

  return ideas.slice(0, Math.max(1, Math.min(input.limit, ideas.length))).map((idea, index) => ({
    ...idea,
    audience: "pessoas buscando riqueza por execução, internet ou negócios",
    formatTemplateKey: input.formatKeys[index % Math.max(input.formatKeys.length, 1)],
    seriesKey: input.seriesKeys.length > 0 ? input.seriesKeys[index % input.seriesKeys.length] : null,
  }));
}

const RIQUEZA_ALLOWED_TREND_KEYWORDS = [
  "dinheiro",
  "renda",
  "financa",
  "finanças",
  "economia",
  "negocio",
  "negócio",
  "negocios",
  "negócios",
  "empreendedor",
  "empreendedorismo",
  "empresa",
  "empresas",
  "vendas",
  "vender",
  "cliente",
  "lucro",
  "caixa",
  "salario",
  "salário",
  "trabalho",
  "emprego",
  "imposto",
  "taxa",
  "juros",
  "selic",
  "credito",
  "crédito",
  "divida",
  "dívida",
  "cartao",
  "cartão",
  "pix",
  "banco",
  "nubank",
  "inter",
  "mercado livre",
  "shopee",
  "amazon",
  "saas",
  "startup",
  "produto digital",
  "infoproduto",
  "afiliado",
  "marketing",
  "trafego",
  "tráfego",
  "anuncio",
  "anúncio",
  "investimento",
  "investir",
  "acoes",
  "ações",
  "ibovespa",
  "dolar",
  "dólar",
  "bitcoin",
  "btc",
  "ethereum",
  "cripto",
  "fgts",
  "inss",
  "mei",
];

const RIQUEZA_BLOCKED_TREND_KEYWORDS = [
  "futebol",
  "jogo",
  "partida",
  "campeonato",
  "gol",
  "rodada",
  "cartola",
  "ufc",
  "luta",
  "atleta",
  "jogador",
  "treinador",
  "bbb",
  "novela",
  "cantor",
  "atriz",
  "celebridade",
  "fofoca",
  "reality",
  "show",
  "morreu",
  "morte",
  "acidente",
];

export function buildTrendChannelContext(trend: GoogleTrendItem, angle?: string): string {
  return normalizeEmailAnalysisText(
    [
      trend.title,
      angle ?? "",
      ...trend.newsItems.flatMap((item) => [item.title ?? "", item.source ?? "", item.snippet ?? ""]),
    ].join(" | "),
  );
}

export function isRiquezaTrendEligible(input: {
  trend: GoogleTrendItem;
  fitScore: number;
  angle?: string;
}): { allowed: boolean; reason: string } {
  const title = normalizeEmailAnalysisText(input.trend.title);
  const context = buildTrendChannelContext(input.trend, input.angle);
  const hasFinanceSignal = includesAny(context, RIQUEZA_ALLOWED_TREND_KEYWORDS);
  const hasBlockedSignal = includesAny(context, RIQUEZA_BLOCKED_TREND_KEYWORDS) || /\b.+\s+x\s+.+\b/i.test(title);

  if (!hasFinanceSignal) {
    return {
      allowed: false,
      reason: "trend sem sinal forte de finanças, renda, negócios ou monetização prática",
    };
  }

  if (hasBlockedSignal && !hasFinanceSignal) {
    return {
      allowed: false,
      reason: "trend dominado por esporte, celebridade ou notícia geral fora do canal",
    };
  }

  if (input.fitScore < 60) {
    return {
      allowed: false,
      reason: "fit editorial abaixo do mínimo para virar pauta do canal",
    };
  }

  return {
    allowed: true,
    reason: "trend com aderência financeira suficiente para virar pauta acionável",
  };
}

export function isRiquezaContentItemEligible(item: {
  title: string;
  hook?: string | null;
  pillar?: string | null;
  notes?: string | null;
  channelKey?: string | null;
}): boolean {
  if (!item.channelKey?.startsWith("riqueza_despertada")) {
    return true;
  }

  const context = normalizeEmailAnalysisText(
    [
      item.title,
      item.hook ?? "",
      item.pillar ?? "",
      item.notes ?? "",
    ].join(" | "),
  );

  const hasAllowedSignal = includesAny(context, RIQUEZA_ALLOWED_TREND_KEYWORDS)
    || includesAny(context, [
      "riqueza",
      "patrimonio",
      "patrimônio",
      "precificar",
      "assinatura",
      "conversao",
      "conversão",
      "pagina de vendas",
      "pagina",
      "freelancer",
      "produto",
      "produtos",
      "execucao",
      "execução",
      "canal escalavel",
      "canal escalável",
      "poupanca",
      "poupança",
    ]);
  const hasBlockedSignal = includesAny(context, [
    ...RIQUEZA_BLOCKED_TREND_KEYWORDS,
    "aposta",
    "apostas",
    "bet",
    "cassino",
    "cassino online",
    "pre luta",
    "pré luta",
  ]);

  return hasAllowedSignal && !hasBlockedSignal;
}

export function filterSelectedTrendsForChannel(input: {
  channelKey: string;
  selectedTrends: Array<{
    title: string;
    approxTraffic?: string;
    fitScore: number;
    angle: string;
    useTrend: boolean;
  }>;
  rawTrends: GoogleTrendItem[];
}): Array<{
  title: string;
  approxTraffic?: string;
  fitScore: number;
  angle: string;
  useTrend: boolean;
}> {
  if (!input.channelKey.startsWith("riqueza_despertada")) {
    return input.selectedTrends;
  }

  return input.selectedTrends.map((item) => {
    const trend = input.rawTrends.find((entry) => normalizeEmailAnalysisText(entry.title) === normalizeEmailAnalysisText(item.title));
    if (!trend) {
      return {
        ...item,
        useTrend: false,
      };
    }

    const eligibility = isRiquezaTrendEligible({
      trend,
      fitScore: item.fitScore,
      angle: item.angle,
    });

    return {
      ...item,
      useTrend: item.useTrend && eligibility.allowed,
      angle: eligibility.allowed ? item.angle : `${item.angle} | descartado: ${eligibility.reason}`,
    };
  });
}
