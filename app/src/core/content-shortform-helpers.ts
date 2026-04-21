import { normalizeEmailAnalysisText } from "../integrations/email/email-analysis.js";
import { PexelsMediaService, type PexelsVideoSuggestion } from "../integrations/media/pexels.js";

function includesAny(source: string, tokens: string[]): boolean {
  return tokens.some((token) => source.includes(token));
}

function truncateBriefText(value: string | null | undefined, maxLength = 72): string {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) {
    return clean;
  }
  return `${clean.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

export function buildContentOverviewReply(items: Array<{
  id: number;
  title: string;
  platform: string;
  format: string;
  status: string;
  targetDate: string | null;
  pillar: string | null;
  channelKey?: string | null;
  seriesKey?: string | null;
  ideaScore?: number | null;
  queuePriority?: number | null;
  reviewFeedbackCategory?: string | null;
  reviewFeedbackReason?: string | null;
}>): string {
  if (!items.length) {
    return "Nao ha itens de conteudo salvos para os filtros informados.";
  }

  return [
    `Conteudo encontrado: ${items.length} item(ns).`,
    ...items.map((item) =>
      [
        `- #${item.id}`,
        item.channelKey ? `canal: ${item.channelKey}` : item.platform,
        item.format,
        item.status,
        item.title,
        item.seriesKey ? `serie: ${item.seriesKey}` : undefined,
        item.targetDate ? `data: ${item.targetDate}` : undefined,
        item.pillar ? `pilar: ${item.pillar}` : undefined,
        item.ideaScore != null ? `score: ${item.ideaScore}` : undefined,
        item.queuePriority != null ? `prioridade: ${item.queuePriority}` : undefined,
        item.reviewFeedbackCategory ? `feedback: ${item.reviewFeedbackCategory}` : undefined,
        item.reviewFeedbackReason ? `motivo: ${truncateBriefText(item.reviewFeedbackReason, 56)}` : undefined,
      ].filter(Boolean).join(" | "),
    ),
  ].join("\n");
}

export function buildContentChannelsReply(channels: Array<{
  key: string;
  name: string;
  platform: string;
  status: string;
  frequencyPerWeek: number | null;
  primaryGoal: string | null;
}>): string {
  if (!channels.length) {
    return "Nao encontrei canais editoriais configurados.";
  }

  return [
    `Canais editoriais: ${channels.length}.`,
    ...channels.map((channel) =>
      `- ${channel.name} | key: ${channel.key} | plataforma: ${channel.platform} | status: ${channel.status}${channel.frequencyPerWeek ? ` | freq: ${channel.frequencyPerWeek}/semana` : ""}${channel.primaryGoal ? ` | objetivo: ${channel.primaryGoal}` : ""}`,
    ),
  ].join("\n");
}

export function buildContentSeriesReply(series: Array<{
  key: string;
  channelKey: string;
  title: string;
  cadence: string | null;
  status: string;
  premise: string | null;
}>): string {
  if (!series.length) {
    return "Nao encontrei series editoriais para os filtros atuais.";
  }

  return [
    `Series editoriais: ${series.length}.`,
    ...series.map((item) =>
      `- ${item.title} | key: ${item.key} | canal: ${item.channelKey} | status: ${item.status}${item.cadence ? ` | cadencia: ${item.cadence}` : ""}${item.premise ? ` | premissa: ${truncateBriefText(item.premise, 72)}` : ""}`,
    ),
  ].join("\n");
}

export function buildContentFormatsReply(templates: Array<{
  key: string;
  label: string;
  active: boolean;
  structure: string;
  description: string | null;
}>): string {
  if (!templates.length) {
    return "Nao encontrei formatos editoriais configurados.";
  }

  return [
    `Formatos editoriais: ${templates.length}.`,
    ...templates.map((template) =>
      `- ${template.label} | key: ${template.key} | ${template.active ? "ativo" : "inativo"} | estrutura: ${truncateBriefText(template.structure, 72)}${template.description ? ` | uso: ${truncateBriefText(template.description, 56)}` : ""}`,
    ),
  ].join("\n");
}

export function buildContentHooksReply(hooks: Array<{
  label: string;
  category: string | null;
  effectivenessScore: number | null;
  template: string;
}>): string {
  if (!hooks.length) {
    return "Nao encontrei hooks salvos na biblioteca editorial.";
  }

  return [
    `Hooks salvos: ${hooks.length}.`,
    ...hooks.map((hook) =>
      `- ${hook.label}${hook.category ? ` | categoria: ${hook.category}` : ""}${hook.effectivenessScore != null ? ` | score: ${hook.effectivenessScore}` : ""} | template: ${truncateBriefText(hook.template, 84)}`,
    ),
  ].join("\n");
}

export function buildContentIdeaGenerationReply(items: Array<{
  id: number;
  title: string;
  channelKey: string | null;
  formatTemplateKey: string | null;
  seriesKey: string | null;
  ideaScore: number | null;
  scoreReason: string | null;
}>): string {
  if (!items.length) {
    return "Nao consegui gerar pautas editoriais nesta tentativa.";
  }

  return [
    `Pautas geradas e salvas: ${items.length}.`,
    ...items.map((item) =>
      `- #${item.id} | ${item.title}${item.channelKey ? ` | canal: ${item.channelKey}` : ""}${item.formatTemplateKey ? ` | formato: ${item.formatTemplateKey}` : ""}${item.seriesKey ? ` | serie: ${item.seriesKey}` : ""}${item.ideaScore != null ? ` | score: ${item.ideaScore}` : ""}${item.scoreReason ? ` | motivo: ${truncateBriefText(item.scoreReason, 60)}` : ""}`,
    ),
    "",
    "Próximo passo: revise a fila editorial e aprove ou reprove os itens mais fortes.",
  ].join("\n");
}

export function buildContentReviewReply(input: {
  action: "approved" | "rejected";
  item: {
    id: number;
    title: string;
    status: string;
    reviewFeedbackCategory?: string | null;
    reviewFeedbackReason?: string | null;
    lastReviewedAt?: string | null;
  };
}): string {
  if (input.action === "approved") {
    return [
      "Item editorial aprovado.",
      `- #${input.item.id} | ${input.item.title}`,
      `- Novo status: ${input.item.status}`,
      `- Revisado em: ${input.item.lastReviewedAt ?? "agora"}`,
    ].join("\n");
  }

  return [
    "Item editorial reprovado e retirado da fila ativa.",
    `- #${input.item.id} | ${input.item.title}`,
    `- Novo status: ${input.item.status}`,
    `- Categoria: ${input.item.reviewFeedbackCategory ?? "reprovado_manual"}`,
    `- Motivo: ${input.item.reviewFeedbackReason ?? "sem motivo registrado"}`,
    `- Revisado em: ${input.item.lastReviewedAt ?? "agora"}`,
  ].join("\n");
}

export function buildContentReviewNotFoundReply(input: {
  requestedId: number;
  channelKey?: string;
  queue: Array<{ id: number; title: string }>;
}): string {
  const lines = [
    `Nao encontrei o item editorial #${input.requestedId}.`,
  ];
  if (input.channelKey) {
    lines.push(`- Canal considerado: ${input.channelKey}`);
  }
  if (input.queue.length > 0) {
    lines.push("- Itens atuais da fila:");
    for (const item of input.queue.slice(0, 5)) {
      lines.push(`  - #${item.id} | ${truncateBriefText(item.title, 64)}`);
    }
    lines.push("- Você também pode usar posição ordinal, por exemplo: `aprove o primeiro item`.");
  }
  return lines.join("\n");
}

export function buildContentScriptReply(input: {
  item: {
    id: number;
    title: string;
    hook: string | null;
    callToAction: string | null;
    notes: string | null;
  };
  styleMode: ShortStyleMode;
  mode: string;
  targetDurationSeconds: number;
  headlineOptions: string[];
  script: string;
  description: string;
  scenes: Array<{
    order: number;
    durationSeconds: number;
    narrativeFunction?: string;
    scenePurpose?: string;
    voiceover: string;
    overlay: string;
    visualDirection: string;
    assetProviderHint?: string;
    assetSearchQuery: string;
    assetFallbackQuery?: string;
    retentionDriver?: string;
  }>;
  platformVariants: {
    youtubeShort: {
      title: string;
      caption: string;
      coverText: string;
    };
    tiktok: {
      caption: string;
      coverText: string;
      hook: string;
    };
  };
  sceneAssets: Array<{
    order: number;
    searchQuery: string;
    suggestions: PexelsVideoSuggestion[];
  }>;
  productionPack: ShortProductionPack;
  distributionPlan: DistributionPlan;
  qualityAssessment?: ShortQualityAssessment;
}): string {
  return [
    `Roteiro pronto para o item #${input.item.id}.`,
    `- Título de trabalho: ${input.item.title}`,
    `- Modo: ${input.mode}`,
    `- Tom: ${input.styleMode}`,
    `- Duração alvo: ${input.targetDurationSeconds}s`,
    ...(input.item.hook ? [`- Hook final: ${input.item.hook}`] : []),
    ...(input.item.callToAction ? [`- CTA: ${input.item.callToAction}`] : []),
    ...(input.qualityAssessment ? [`- Quality gate: ${input.qualityAssessment.score}/5 | ${input.qualityAssessment.passed ? "aprovado" : "bloqueado"}`] : []),
    "",
    "Sugestões de título:",
    ...input.headlineOptions.slice(0, 3).map((title) => `- ${title}`),
    "",
    "Roteiro:",
    input.script,
    "",
    "Plano por cena:",
    ...input.scenes.map((scene) =>
      `- Cena ${scene.order} | ${scene.durationSeconds}s | ${scene.narrativeFunction ?? "scene"} | VO: ${scene.voiceover} | overlay: ${scene.overlay} | visual: ${scene.visualDirection}${scene.assetProviderHint ? ` | mídia: ${scene.assetProviderHint}` : ""} | busca: ${scene.assetSearchQuery}${scene.assetFallbackQuery ? ` | fallback: ${scene.assetFallbackQuery}` : ""}${scene.retentionDriver ? ` | retention: ${scene.retentionDriver}` : ""}`,
    ),
    ...(input.qualityAssessment?.reasons?.length
      ? ["", "Quality gate:", ...input.qualityAssessment.reasons.map((reason) => `- ${reason}`)]
      : []),
    "",
    "Assets sugeridos:",
    ...(input.sceneAssets.length > 0
      ? input.sceneAssets.flatMap((scene) => [
          `- Cena ${scene.order} | busca: ${scene.searchQuery}`,
          ...scene.suggestions.slice(0, 2).map((asset) =>
            `  - ${asset.videoUrl ?? asset.pageUrl}${asset.provider ? ` | provider: ${asset.provider}` : ""}${asset.creator ? ` | creator: ${asset.creator}` : ""}${asset.durationSeconds ? ` | ${asset.durationSeconds}s` : ""}`,
          ),
        ])
      : ["- Sem assets resolvidos por API. Use a busca por cena para procurar b-roll manualmente."]),
    "",
    "Production Pack V3:",
    `- Voz: ${input.productionPack.voiceStyle}`,
    `- Ritmo de edição: ${input.productionPack.editRhythm}`,
    `- Legendas: ${input.productionPack.subtitleStyle}`,
    ...input.productionPack.scenes.map((scene) =>
      `- Cena ${scene.order} | legenda: ${scene.subtitleLine}${scene.emphasisWords.length > 0 ? ` | destaques: ${scene.emphasisWords.join(", ")}` : ""} | edição: ${scene.editInstruction}${scene.selectedAsset ? ` | asset principal: ${scene.selectedAsset}` : ""}`,
    ),
    "",
    "Strategy Layer:",
    `- Plataforma principal: ${input.distributionPlan.primaryPlatform}`,
    `- Plataforma secundária: ${input.distributionPlan.secondaryPlatform}`,
    `- Janela sugerida: ${input.distributionPlan.recommendedWindow}`,
    `- Janela secundária: ${input.distributionPlan.secondaryWindow}`,
    `- Hipótese: ${input.distributionPlan.hypothesis}`,
    `- Racional: ${input.distributionPlan.rationale}`,
    "",
    "Variações por plataforma:",
    `- YouTube Shorts | título: ${input.platformVariants.youtubeShort.title} | capa: ${input.platformVariants.youtubeShort.coverText} | caption: ${input.platformVariants.youtubeShort.caption}`,
    `- TikTok | hook: ${input.platformVariants.tiktok.hook} | capa: ${input.platformVariants.tiktok.coverText} | caption: ${input.platformVariants.tiktok.caption}`,
    "",
    "Descrição curta:",
    input.description,
    "",
    "O pacote foi salvo no próprio item editorial.",
  ].join("\n");
}

export type ShortScenePlan = {
  order: number;
  durationSeconds: number;
  narrativeFunction?: SceneNarrativeFunction;
  scenePurpose?: string;
  voiceover: string;
  overlay: string;
  overlayHighlightWords?: string[];
  emotionalTrigger?: SceneEmotionalTrigger;
  proofType?: SceneProofType;
  visualDirection: string;
  visualEnvironment?: SceneVisualEnvironment;
  visualAction?: string;
  visualCamera?: SceneVisualCamera;
  visualPacing?: SceneVisualPacing;
  assetProviderHint?: SceneAssetProvider;
  assetSearchQuery: string;
  assetFallbackQuery?: string;
  forbiddenVisuals?: string[];
  retentionDriver?: SceneRetentionDriver;
};

export type ShortStyleMode = "operator" | "motivational" | "emotional" | "contrarian";
export type SceneAssetProvider = "pexels" | "fal" | "kling";
export type SceneNarrativeFunction = "hook" | "pain" | "identification" | "mechanism" | "action" | "payoff";
export type SceneEmotionalTrigger = "shock" | "urgency" | "identification" | "curiosity" | "proof" | "relief";
export type SceneProofType = "none" | "action" | "interface" | "social_proof" | "money" | "result";
export type SceneRetentionDriver =
  | "pattern_interrupt"
  | "pain_identification"
  | "specific_mechanism"
  | "micro_action"
  | "visual_proof"
  | "payoff_contrast";
export type SceneVisualEnvironment =
  | "phone_ui"
  | "small_business"
  | "money_desk"
  | "dashboard"
  | "street_business"
  | "abstract_dark"
  | "workspace";
export type SceneVisualCamera = "macro" | "screen_capture" | "over_shoulder" | "top_down" | "punch_in";
export type SceneVisualPacing = "burst" | "fast" | "steady" | "escalating";

export type ShortQualityAssessment = {
  score: number;
  passed: boolean;
  reasons: string[];
};

export type ShortProductionPack = {
  voiceStyle: string;
  editRhythm: string;
  subtitleStyle: string;
  scenes: Array<{
    order: number;
    subtitleLine: string;
    emphasisWords: string[];
    editInstruction: string;
    selectedAsset?: string;
  }>;
};

export type DistributionPlan = {
  primaryPlatform: string;
  secondaryPlatform: string;
  recommendedWindow: string;
  secondaryWindow: string;
  hypothesis: string;
  rationale: string;
};

export type ShortPlatformVariants = {
  youtubeShort: {
    title: string;
    caption: string;
    coverText: string;
  };
  tiktok: {
    caption: string;
    coverText: string;
    hook: string;
  };
};

export type ShortFormPackage = {
  styleMode: ShortStyleMode;
  mode: string;
  targetDurationSeconds: number;
  hook: string;
  script: string;
  cta: string;
  description: string;
  titleOptions: string[];
  scenes: ShortScenePlan[];
  platformVariants: ShortPlatformVariants;
  qualityAssessment?: ShortQualityAssessment;
};

export function normalizeShortComparableText(value: string): string {
  return normalizeEmailAnalysisText(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeShortStyleMode(value: string | undefined, fallback: ShortStyleMode): ShortStyleMode {
  if (value === "operator" || value === "motivational" || value === "emotional" || value === "contrarian") {
    return value;
  }
  return fallback;
}

export function inferShortStyleMode(input: {
  title: string;
  pillar?: string | null;
  hook?: string | null;
  formatTemplateKey?: string | null;
  seriesKey?: string | null;
  notes?: string | null;
}): ShortStyleMode {
  const normalized = normalizeEmailAnalysisText([
    input.title,
    input.pillar ?? "",
    input.hook ?? "",
    input.formatTemplateKey ?? "",
    input.seriesKey ?? "",
    input.notes ?? "",
  ].join("\n"));

  if (includesAny(normalized, ["belief_breaker", "mentira", "erro", "mito", "contrarian", "pare de"])) {
    return "contrarian";
  }
  if (includesAny(normalized, ["short_narrative", "historia", "história", "narrativa", "virada", "caso real", "situação", "situacao"])) {
    return "emotional";
  }
  if (includesAny(normalized, ["disciplina", "execucao", "execução", "constancia", "constância", "agir", "rotina", "foco"])) {
    return "motivational";
  }
  return "operator";
}

export function buildShortStyleProfile(styleMode: ShortStyleMode): {
  voiceStyle: string;
  editRhythm: string;
  subtitleStyle: string;
  youtubeCoverText: string;
  tiktokCoverText: string;
} {
  switch (styleMode) {
    case "motivational":
      return {
        voiceStyle: "voz firme, energética e disciplinada, com cadência de execução e sem soar coach",
        editRhythm: "hook rápido; cortes secos e crescentes; motion text forte; terminar com energia de ação imediata",
        subtitleStyle: "topo = tese curta; base = ação prática; blocos curtos, verbos fortes e contraste alto",
        youtubeCoverText: "EXECUTE ISSO HOJE",
        tiktokCoverText: "PARE DE ADIAR",
      };
    case "emotional":
      return {
        voiceStyle: "voz próxima, intensa e controlada, com peso emocional sem dramatizar demais",
        editRhythm: "abrir com tensão; segurar a virada por alguns frames; alternar respiro curto com punchline visual",
        subtitleStyle: "topo = dor ou virada; base = frase falada curta; palavras de impacto emocional em destaque",
        youtubeCoverText: "ESSA VIRADA IMPORTA",
        tiktokCoverText: "SE IDENTIFICOU?",
      };
    case "contrarian":
      return {
        voiceStyle: "voz cortante, confiante e direta, com ênfase nas palavras de ruptura e sem hype vazio",
        editRhythm: "primeiros 2 segundos muito fortes; cortes rápidos; texto de confronto; fechamento seco para comentário",
        subtitleStyle: "topo = quebra de crença; base = prova curta; poucas palavras, contraste alto e punchline visível",
        youtubeCoverText: "ERRO QUE CUSTA CARO",
        tiktokCoverText: "PARE DE PERDER DINHEIRO NISSO",
      };
    case "operator":
    default:
      return {
        voiceStyle: "voz segura, objetiva e pragmática, com ritmo de operador de growth e sem hype",
        editRhythm: "hook rápido; cortes secos a cada 2-3s; reforço visual de mecanismo; fechamento limpo para comentário",
        subtitleStyle: "topo = mecanismo; base = fala objetiva; 3-6 palavras por bloco destacando número, ação e métrica",
        youtubeCoverText: "MECANISMO QUE FUNCIONA",
        tiktokCoverText: "ENTENDA O MECANISMO",
      };
  }
}

export function buildSceneCtaSubtitle(styleMode: ShortStyleMode): string {
  switch (styleMode) {
    case "motivational":
      return "Conta aqui embaixo.";
    case "emotional":
      return "Me diz isso nos comentários.";
    case "contrarian":
      return "Comenta aqui embaixo.";
    case "operator":
    default:
      return "Deixe isso nos comentários.";
  }
}

export function buildSceneSubtitleLine(scene: ShortScenePlan, styleMode: ShortStyleMode): string {
  const overlayComparable = normalizeShortComparableText(scene.overlay);
  const voiceover = scene.voiceover.trim();
  const clauses = voiceover
    .split(/(?<=[.!?])\s+|\s+[–—-]\s+|;\s+|:\s+|,\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    const comparable = normalizeShortComparableText(clause);
    if (!comparable) {
      continue;
    }
    if (!overlayComparable || (comparable !== overlayComparable && !comparable.includes(overlayComparable) && !overlayComparable.includes(comparable))) {
      return truncateBriefText(clause.replace(/\s+/g, " "), 72);
    }
  }

  if (normalizeShortComparableText(voiceover).includes("comente")) {
    return buildSceneCtaSubtitle(styleMode);
  }

  return truncateBriefText(voiceover.replace(/\s+/g, " "), 72);
}

export function extractEmphasisWords(text: string): string[] {
  return [...new Set(
    text
      .split(/[^a-zA-ZÀ-ÿ0-9]+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 4)
      .slice(0, 3),
  )];
}

export function buildSceneEditInstruction(scene: ShortScenePlan, styleMode: ShortStyleMode): string {
  const accent = styleMode === "motivational"
    ? "Aumente a energia a cada troca de plano."
    : styleMode === "emotional"
      ? "Segure alguns frames extras no momento de virada."
      : styleMode === "contrarian"
        ? "Bata o contraste visual junto da punchline."
        : "Priorize clareza visual e número na tela.";
  const pacingInstruction = scene.visualPacing === "burst"
    ? "Cortes agressivos em 1-2 segundos."
    : scene.visualPacing === "escalating"
      ? "Aumente a intensidade visual até o payoff."
      : scene.visualPacing === "fast"
        ? "Mantenha troca visual rápida e sem respiro morto."
        : "Mantenha leitura limpa e movimento constante.";
  const narrativeInstruction = scene.narrativeFunction === "hook"
    ? "Abra com pattern interrupt imediato."
    : scene.narrativeFunction === "pain"
      ? "Mostre a dor concreta, não conceito abstrato."
      : scene.narrativeFunction === "identification"
        ? "Faça o espectador se ver na cena."
        : scene.narrativeFunction === "mechanism"
          ? "Explique o mecanismo com UI, números ou prova."
          : scene.narrativeFunction === "action"
            ? "Mostre a execução acontecendo."
            : "Feche com payoff ou prova tangível.";
  if (scene.durationSeconds <= 4) {
    return `1 corte rápido + zoom leve no texto; segure 2 a 3 frames no punchline. ${narrativeInstruction} ${pacingInstruction} ${accent}`;
  }
  if (scene.durationSeconds <= 8) {
    return `2 cortes secos; trocar plano no meio da frase e manter texto na zona segura vertical. ${narrativeInstruction} ${pacingInstruction} ${accent}`;
  }
  return `3 blocos visuais: abertura, reforço e fechamento; manter cortes a cada 2 a 3 segundos. ${narrativeInstruction} ${pacingInstruction} ${accent}`;
}

export function inferDistributionHypothesis(item: {
  formatTemplateKey?: string | null;
  pillar?: string | null;
  hook?: string | null;
}): string {
  const normalized = normalizeEmailAnalysisText(`${item.formatTemplateKey ?? ""}\n${item.pillar ?? ""}\n${item.hook ?? ""}`);
  if (normalized.includes("belief_breaker") || normalized.includes("mentira") || normalized.includes("erro")) {
    return "Gancho contrarian deve elevar comentário e retenção nos 3 primeiros segundos.";
  }
  if (normalized.includes("short_narrative") || normalized.includes("historia") || normalized.includes("história")) {
    return "Narrativa curta deve elevar retenção média e replay.";
  }
  return "Mecanismo prático + promessa objetiva deve puxar saves e comentários.";
}

export function buildDistributionPlan(input: {
  item: {
    platform: string;
    formatTemplateKey?: string | null;
    pillar?: string | null;
    hook?: string | null;
  };
  channelKey?: string | null;
  orderOffset?: number;
}): DistributionPlan {
  const isTikTokPrimary = input.channelKey?.includes("tiktok") || input.item.platform === "tiktok";
  const primaryWindows = isTikTokPrimary ? ["07:00 BRT", "12:00 BRT", "20:00 BRT"] : ["07:00 BRT", "12:00 BRT", "20:00 BRT"];
  const secondaryWindows = isTikTokPrimary ? ["12:00 BRT", "20:00 BRT", "07:00 BRT"] : ["12:00 BRT", "20:00 BRT", "07:00 BRT"];
  const index = Math.max(0, input.orderOffset ?? 0) % primaryWindows.length;
  return {
    primaryPlatform: isTikTokPrimary ? "TikTok" : "YouTube Shorts",
    secondaryPlatform: isTikTokPrimary ? "YouTube Shorts" : "TikTok",
    recommendedWindow: primaryWindows[index]!,
    secondaryWindow: secondaryWindows[index]!,
    hypothesis: inferDistributionHypothesis(input.item),
    rationale: isTikTokPrimary
      ? "TikTok tende a responder melhor a janela almoço/noite; usar YouTube como segunda distribuição com adaptação leve."
      : "YouTube Shorts tende a performar melhor em rotina manhã/almoço/noite; TikTok entra como redistribuição do mesmo núcleo.",
  };
}

export function buildShortProductionPack(
  styleMode: ShortStyleMode,
  scenes: ShortScenePlan[],
  sceneAssets: Array<{
    order: number;
    searchQuery: string;
    suggestions: PexelsVideoSuggestion[];
  }>,
): ShortProductionPack {
  const styleProfile = buildShortStyleProfile(styleMode);
  const usedAssets = new Set<string>();
  return {
    voiceStyle: styleProfile.voiceStyle,
    editRhythm: styleProfile.editRhythm,
    subtitleStyle: styleProfile.subtitleStyle,
    scenes: scenes.map((scene) => {
      const selectedAssetEntry = sceneAssets.find((entry) => entry.order === scene.order);
      const selectedAsset = selectedAssetEntry?.suggestions
        .map((asset) => asset.videoUrl)
        .find((asset): asset is string => typeof asset === "string" && asset.trim().length > 0 && !usedAssets.has(asset))
        ?? selectedAssetEntry?.suggestions[0]?.videoUrl;
      if (selectedAsset) {
        usedAssets.add(selectedAsset);
      }
      return {
        order: scene.order,
        subtitleLine: buildSceneSubtitleLine(scene, styleMode),
        emphasisWords: extractEmphasisWords(`${scene.overlay} ${scene.voiceover}`),
        editInstruction: buildSceneEditInstruction(scene, styleMode),
        selectedAsset,
      };
    }),
  };
}

export function hasSavedShortPackage(notes: string | null | undefined): boolean {
  if (!notes) {
    return false;
  }
  return /SHORT_PACKAGE_V[23]/.test(notes);
}

export function buildContentBatchReply(input: {
  channelKey: string;
  items: Array<{
    id: number;
    title: string;
    status: string;
    queuePriority: number | null;
    ideaScore: number | null;
    hasScriptPackage: boolean;
    recommendedWindow: string;
    hypothesis: string;
  }>;
}): string {
  if (input.items.length === 0) {
    return `Nao encontrei itens suficientes para montar um lote no canal ${input.channelKey}.`;
  }

  return [
    `Lote inicial montado: ${input.items.length} vídeos.`,
    `- Canal: ${input.channelKey}`,
    "- Estratégia: publicar 1 vídeo por vez, priorizando clareza de hipótese e constância diária.",
    ...input.items.map((item, index) =>
      `- Ordem ${index + 1} | #${item.id} | ${item.title} | status: ${item.status} | score: ${item.ideaScore ?? item.queuePriority ?? "-"} | janela: ${item.recommendedWindow} | pacote: ${item.hasScriptPackage ? "pronto" : "pendente"} | hipótese: ${truncateBriefText(item.hypothesis, 96)}`,
    ),
    "",
    "Próximo passo: gere ou revise o roteiro do primeiro item e publique um por vez.",
  ].join("\n");
}

export function buildContentDistributionStrategyReply(input: {
  channelKey: string;
  items: Array<{
    id: number;
    title: string;
    recommendedWindow: string;
    secondaryWindow: string;
    hypothesis: string;
    rationale: string;
  }>;
}): string {
  if (input.items.length === 0) {
    return `Nao encontrei itens para sugerir distribuição no canal ${input.channelKey}.`;
  }

  return [
    `Estratégia de distribuição para ${input.channelKey}.`,
    ...input.items.map((item, index) =>
      `- Ordem ${index + 1} | #${item.id} | ${item.title} | janela principal: ${item.recommendedWindow} | janela secundária: ${item.secondaryWindow} | hipótese: ${truncateBriefText(item.hypothesis, 92)} | racional: ${truncateBriefText(item.rationale, 96)}`,
    ),
  ].join("\n");
}

export function buildContentBatchGenerationReply(input: {
  channelKey: string;
  generated: Array<{
    id: number;
    title: string;
    status: string;
    recommendedWindow: string;
    hasAssets: boolean;
  }>;
}): string {
  if (input.generated.length === 0) {
    return `Nao encontrei itens elegíveis para gerar o lote completo no canal ${input.channelKey}.`;
  }

  return [
    `Lote completo gerado: ${input.generated.length} vídeos.`,
    `- Canal: ${input.channelKey}`,
    ...input.generated.map((item, index) =>
      `- Ordem ${index + 1} | #${item.id} | ${item.title} | status: ${item.status} | janela: ${item.recommendedWindow} | assets: ${item.hasAssets ? "ok" : "pendente"}`,
    ),
    "",
    "Próximo passo: revise o item #1 do lote e publique um vídeo por vez.",
  ].join("\n");
}

const FORBIDDEN_SHORT_PROMISES = [
  "link da descricao",
  "link na descrição",
  "link na bio",
  "checklist na descricao",
  "checklist na descrição",
  "baixe o checklist",
  "baixe o material",
  "confira o checklist",
];

const GLOBAL_VISUAL_BLACKLIST = [
  "business meeting",
  "corporate office",
  "whiteboard",
  "presentation",
  "team discussion",
  "generic laptop typing",
  "people pointing screen",
  "stock office smiling",
];

const FORBIDDEN_FACELESS_VISUAL_TERMS = [
  "apresentador",
  "rosto",
  "close-up",
  "selfie",
  "camera talking head",
  "talking head",
  "host speaking",
  "corporate office",
  "business meeting",
  "team discussion",
  "stock office smiling",
  "presentation",
  "whiteboard",
];

const FORBIDDEN_FACELESS_ASSET_TERMS = [
  "presenter",
  "speaker",
  "selfie",
  "face",
  "facial",
  "portrait",
  "host",
  "influencer",
  "webcam",
  "talking head",
  "person talking",
  "close-up",
  "business meeting",
  "corporate office",
  "team discussion",
  "presentation",
  "generic laptop typing",
  "people pointing screen",
  "stock office smiling",
  "whiteboard",
];

export function clampShortTargetDuration(value: number | undefined, fallback = 30): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return Math.max(22, Math.min(32, Math.round(value)));
}

export function clampSceneDuration(value: number | undefined, fallback = 8): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return Math.max(2, Math.min(14, Math.round(value)));
}

export function normalizeScenePlan(scenes: ShortScenePlan[] | undefined, fallbackScenes: ShortScenePlan[]): ShortScenePlan[] {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    return fallbackScenes;
  }

  return scenes
    .filter((scene) =>
      scene
      && typeof scene.voiceover === "string"
      && scene.voiceover.trim().length > 0
      && typeof scene.overlay === "string"
      && scene.overlay.trim().length > 0
      && typeof scene.visualDirection === "string"
      && scene.visualDirection.trim().length > 0
      && typeof scene.assetSearchQuery === "string"
      && scene.assetSearchQuery.trim().length > 0,
    )
    .slice(0, 8)
    .map((scene, index) => ({
      order: index + 1,
      durationSeconds: clampSceneDuration(scene.durationSeconds, 8),
      narrativeFunction: scene.narrativeFunction,
      scenePurpose: typeof scene.scenePurpose === "string" ? scene.scenePurpose.trim() : undefined,
      voiceover: scene.voiceover.trim(),
      overlay: scene.overlay.trim(),
      overlayHighlightWords: Array.isArray(scene.overlayHighlightWords)
        ? scene.overlayHighlightWords.map((value) => value.trim()).filter(Boolean).slice(0, 3)
        : undefined,
      emotionalTrigger: scene.emotionalTrigger,
      proofType: scene.proofType,
      visualDirection: scene.visualDirection.trim(),
      visualEnvironment: scene.visualEnvironment,
      visualAction: typeof scene.visualAction === "string" ? scene.visualAction.trim() : undefined,
      visualCamera: scene.visualCamera,
      visualPacing: scene.visualPacing,
      assetSearchQuery: scene.assetSearchQuery.trim(),
      assetFallbackQuery: typeof scene.assetFallbackQuery === "string" ? scene.assetFallbackQuery.trim() : undefined,
      forbiddenVisuals: Array.isArray(scene.forbiddenVisuals)
        ? scene.forbiddenVisuals.map((value) => value.trim()).filter(Boolean)
        : undefined,
      retentionDriver: scene.retentionDriver,
    }));
}

export function sumSceneDurations(scenes: ShortScenePlan[]): number {
  return scenes.reduce((total, scene) => total + scene.durationSeconds, 0);
}

export function rebalanceSceneDurations(scenes: ShortScenePlan[], targetDurationSeconds: number): ShortScenePlan[] {
  if (scenes.length === 0) {
    return scenes;
  }

  const currentTotal = sumSceneDurations(scenes);
  if (currentTotal === targetDurationSeconds) {
    return scenes;
  }

  const ratio = targetDurationSeconds / Math.max(currentTotal, 1);
  const adjusted = scenes.map((scene) => ({
    ...scene,
    durationSeconds: clampSceneDuration(Math.round(scene.durationSeconds * ratio), scene.durationSeconds),
  }));

  let diff = targetDurationSeconds - sumSceneDurations(adjusted);
  let cursor = 0;
  while (diff !== 0 && cursor < 100) {
    const index = cursor % adjusted.length;
    const scene = adjusted[index]!;
    if (diff > 0 && scene.durationSeconds < 14) {
      scene.durationSeconds += 1;
      diff -= 1;
    } else if (diff < 0 && scene.durationSeconds > 4) {
      scene.durationSeconds -= 1;
      diff += 1;
    }
    cursor += 1;
  }

  return adjusted.map((scene, index) => ({
    ...scene,
    order: index + 1,
  }));
}

export function stripForbiddenShortPromises(text: string): string {
  let next = text;
  for (const token of FORBIDDEN_SHORT_PROMISES) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    next = next.replace(new RegExp(escaped, "gi"), "comentários");
  }
  return next
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
}

export function normalizeFacelessVisualDirection(text: string | undefined, fallback: string): string {
  const base = normalizeShortLine(text, fallback);
  const normalized = normalizeEmailAnalysisText(base);
  if (includesAny(normalized, FORBIDDEN_FACELESS_VISUAL_TERMS)) {
    return fallback;
  }
  return base;
}

export function normalizeShortLine(text: string | undefined, fallback: string): string {
  if (typeof text !== "string" || text.trim().length === 0) {
    return fallback;
  }
  return stripForbiddenShortPromises(text.trim());
}

export function compressOverlayText(text: string | undefined, fallback: string): string {
  const base = normalizeShortLine(text, fallback)
    .replace(/[.!?]+/g, " ")
    .replace(/[–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = base.split(/\s+/).filter(Boolean);
  const compact = words.length > 4 ? words.slice(0, 4).join(" ") : base;
  return truncateBriefText(compact.toUpperCase(), 48);
}

export function deriveScriptFromScenes(scenes: ShortScenePlan[]): string {
  return scenes.map((scene) => scene.voiceover.trim()).filter(Boolean).join(" ");
}

export function normalizeAssetSearchQuery(value: string | undefined, fallback: string): string {
  const normalized = normalizeShortLine(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return fallback;
  }

  const containsForbidden = FORBIDDEN_FACELESS_ASSET_TERMS.some((token) => normalized.includes(token));
  if (containsForbidden) {
    return fallback;
  }

  return normalized;
}

export type ShortAssetSemanticProfile = "finance" | "saas" | "sales" | "execution" | "business";

export function inferAssetSemanticProfile(context: {
  title: string;
  pillar?: string | null;
  hook?: string | null;
  formatTemplateKey?: string | null;
  seriesKey?: string | null;
  notes?: string | null;
  sceneVoiceover?: string;
  sceneOverlay?: string;
  styleMode: ShortStyleMode;
}): ShortAssetSemanticProfile {
  const normalized = normalizeEmailAnalysisText([
    context.title,
    context.pillar ?? "",
    context.hook ?? "",
    context.formatTemplateKey ?? "",
    context.seriesKey ?? "",
    context.notes ?? "",
    context.sceneVoiceover ?? "",
    context.sceneOverlay ?? "",
    context.styleMode,
  ].join("\n"));

  if (includesAny(normalized, [
    "investir",
    "investimento",
    "etf",
    "aporte",
    "dividendo",
    "dividend",
    "juros",
    "patrimonio",
    "patrimônio",
    "poupanca",
    "poupança",
    "rebalance",
    "financial",
    "finance",
    "bank",
    "banking",
  ])) {
    return "finance";
  }
  if (includesAny(normalized, [
    "saas",
    "assinatura",
    "subscription",
    "pricing",
    "churn",
    "ltv",
    "cac",
    "cohort",
    "mrr",
    "arpa",
    "activation",
    "onboarding",
    "usuario ativo",
    "usuário ativo",
  ])) {
    return "saas";
  }
  if (includesAny(normalized, [
    "conversao",
    "conversão",
    "pagina de vendas",
    "página de vendas",
    "sales",
    "lead",
    "cliente",
    "oferta",
    "checkout",
    "funnel",
  ])) {
    return "sales";
  }
  if (includesAny(normalized, ["disciplina", "execucao", "execução", "constancia", "constância", "agir", "automatizar", "rotina"])) {
    return "execution";
  }
  return "business";
}

export function refineAssetSearchQuery(
  value: string | undefined,
  fallback: string,
  context: {
    title: string;
    pillar?: string | null;
    hook?: string | null;
    formatTemplateKey?: string | null;
    seriesKey?: string | null;
    notes?: string | null;
    sceneVoiceover?: string;
    sceneOverlay?: string;
    styleMode: ShortStyleMode;
  },
): string {
  let next = normalizeAssetSearchQuery(value, fallback);
  const profile = inferAssetSemanticProfile(context);

  if (/(comment|comments)/.test(next)) {
    return "mobile app comments interface vertical";
  }
  if (/(onboarding)/.test(next)) {
    return profile === "saas" ? "saas onboarding ui vertical" : "product onboarding ui vertical";
  }
  if (/(pricing|subscription|table ui|pricing table|offer comparison)/.test(next)) {
    if (profile === "saas") {
      return "saas pricing page vertical";
    }
    if (profile === "sales") {
      return "offer pricing comparison vertical";
    }
    return "software pricing page vertical";
  }
  if (/(whiteboard)/.test(next)) {
    if (profile === "finance") {
      return "financial planning desk vertical";
    }
    if (profile === "sales") {
      return "sales planning desk vertical";
    }
    return "business planning desk vertical";
  }
  if (/(smartphone|mobile app|app ui|hands smartphone|banking app|investment app)/.test(next)) {
    if (profile === "finance") {
      return "investment app ui vertical";
    }
    if (profile === "saas") {
      return "saas mobile app ui vertical";
    }
    if (profile === "sales") {
      return "crm mobile app ui vertical";
    }
    return "mobile app interface vertical";
  }
  if (/(dashboard|metrics|analytics|laptop)/.test(next)) {
    if (profile === "finance") {
      return next.includes("blurred") ? "finance analytics dashboard blurred vertical" : "finance analytics dashboard vertical";
    }
    if (profile === "saas") {
      return "saas analytics dashboard vertical";
    }
    if (profile === "sales") {
      return "sales analytics dashboard vertical";
    }
    return "startup analytics dashboard vertical";
  }

  if (profile === "finance") {
    return "investment workspace laptop vertical";
  }
  if (profile === "saas") {
    return "saas workspace laptop vertical";
  }
  if (profile === "sales") {
    return "sales dashboard laptop vertical";
  }
  if (profile === "execution") {
    return "hands typing laptop vertical";
  }
  return next;
}

export function inferSceneNarrativeFunction(index: number, totalScenes: number, voiceover: string): SceneNarrativeFunction {
  const normalized = normalizeEmailAnalysisText(voiceover);
  if (index === 0) {
    return "hook";
  }
  if (index === totalScenes - 1) {
    return includesAny(normalized, ["comente", "agora", "hoje", "comece", "faca", "faça"]) ? "action" : "payoff";
  }
  if (includesAny(normalized, ["nao precisa", "não precisa", "voce tambem", "você também", "igual", "mesmo sem", "sem investimento"])) {
    return "identification";
  }
  if (includesAny(normalized, ["passo", "escolhe", "oferece", "posta", "responde", "organiza", "automatiza", "teste", "mede"])) {
    return "action";
  }
  if (includesAny(normalized, ["resultado", "vira", "ganha", "pagamento", "notificacao", "notificação", "cheio", "lucro"])) {
    return "payoff";
  }
  if (includesAny(normalized, ["erro", "parado", "caro", "perde", "dor", "problema", "nao sabem", "não sabem"])) {
    return index <= 1 ? "pain" : "identification";
  }
  return index <= Math.floor(totalScenes / 2) ? "mechanism" : "action";
}

export function inferSceneEmotionalTrigger(fn: SceneNarrativeFunction): SceneEmotionalTrigger {
  switch (fn) {
    case "hook":
      return "shock";
    case "pain":
      return "urgency";
    case "identification":
      return "identification";
    case "mechanism":
      return "curiosity";
    case "action":
      return "proof";
    case "payoff":
    default:
      return "relief";
  }
}

export function inferSceneProofType(fn: SceneNarrativeFunction, profile: ShortAssetSemanticProfile): SceneProofType {
  if (fn === "action") {
    return "action";
  }
  if (fn === "payoff") {
    return profile === "finance" ? "money" : "result";
  }
  if (fn === "mechanism") {
    return "interface";
  }
  if (fn === "identification" || fn === "pain") {
    return "social_proof";
  }
  return "none";
}

export function inferSceneRetentionDriver(fn: SceneNarrativeFunction): SceneRetentionDriver {
  switch (fn) {
    case "hook":
      return "pattern_interrupt";
    case "pain":
      return "pain_identification";
    case "identification":
      return "pain_identification";
    case "mechanism":
      return "specific_mechanism";
    case "action":
      return "micro_action";
    case "payoff":
    default:
      return "payoff_contrast";
  }
}

export function inferSceneAssetProvider(
  fn: SceneNarrativeFunction,
  proofType: SceneProofType,
): SceneAssetProvider {
  if ((fn === "hook" || fn === "payoff") && proofType !== "interface") {
    return "fal";
  }
  return "pexels";
}

export function buildOverlayHighlightWords(overlay: string, voiceover: string): string[] {
  const preferred = extractEmphasisWords(`${overlay} ${voiceover}`);
  return preferred.slice(0, 3);
}

export function normalizeForbiddenVisuals(values: string[] | undefined): string[] {
  return [...new Set([...(values ?? []), ...GLOBAL_VISUAL_BLACKLIST])]
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function inferSceneQueryPreset(input: {
  fn: SceneNarrativeFunction;
  profile: ShortAssetSemanticProfile;
}): {
  primaryQuery: string;
  fallbackQuery: string;
  visualEnvironment: SceneVisualEnvironment;
  visualAction: string;
  visualCamera: SceneVisualCamera;
  visualPacing: SceneVisualPacing;
} {
  const finance = {
    hook: { primaryQuery: "bank transfer success screen", fallbackQuery: "payment notification phone", visualEnvironment: "phone_ui", visualAction: "mostrar prova financeira imediata em tela", visualCamera: "punch_in", visualPacing: "burst" },
    pain: { primaryQuery: "grocery expensive price tag", fallbackQuery: "wallet empty close", visualEnvironment: "money_desk", visualAction: "mostrar custo real e aperto no bolso", visualCamera: "macro", visualPacing: "fast" },
    identification: { primaryQuery: "bills table stressed", fallbackQuery: "cash counting hands", visualEnvironment: "money_desk", visualAction: "mostrar rotina de contas e pressão financeira", visualCamera: "top_down", visualPacing: "steady" },
    mechanism: { primaryQuery: "finance analytics dashboard vertical", fallbackQuery: "investment app ui vertical", visualEnvironment: "dashboard", visualAction: "explicar o mecanismo via interface e números", visualCamera: "screen_capture", visualPacing: "steady" },
    action: { primaryQuery: "mobile banking app ui", fallbackQuery: "typing message phone close", visualEnvironment: "phone_ui", visualAction: "mostrar execução concreta no celular", visualCamera: "over_shoulder", visualPacing: "fast" },
    payoff: { primaryQuery: "cash counting hands", fallbackQuery: "bank transfer success screen", visualEnvironment: "money_desk", visualAction: "mostrar resultado tangível e específico", visualCamera: "macro", visualPacing: "escalating" },
  } satisfies Record<SceneNarrativeFunction, {
    primaryQuery: string;
    fallbackQuery: string;
    visualEnvironment: SceneVisualEnvironment;
    visualAction: string;
    visualCamera: SceneVisualCamera;
    visualPacing: SceneVisualPacing;
  }>;

  const saas = {
    hook: { primaryQuery: "saas analytics dashboard vertical", fallbackQuery: "pricing page software vertical", visualEnvironment: "dashboard", visualAction: "abrir com gráfico, alerta ou queda visível", visualCamera: "punch_in", visualPacing: "burst" },
    pain: { primaryQuery: "pricing page software vertical", fallbackQuery: "customer support inbox vertical", visualEnvironment: "dashboard", visualAction: "mostrar erro caro em tela de produto", visualCamera: "screen_capture", visualPacing: "fast" },
    identification: { primaryQuery: "customer support inbox vertical", fallbackQuery: "saas onboarding ui vertical", visualEnvironment: "workspace", visualAction: "mostrar fricção real de operação ou cliente", visualCamera: "over_shoulder", visualPacing: "steady" },
    mechanism: { primaryQuery: "saas analytics dashboard vertical", fallbackQuery: "saas onboarding ui vertical", visualEnvironment: "dashboard", visualAction: "explicar mecanismo por métrica ou fluxo", visualCamera: "screen_capture", visualPacing: "steady" },
    action: { primaryQuery: "saas onboarding ui vertical", fallbackQuery: "typing message phone close", visualEnvironment: "phone_ui", visualAction: "mostrar ajuste concreto, setup ou teste", visualCamera: "over_shoulder", visualPacing: "fast" },
    payoff: { primaryQuery: "multiple notifications phone", fallbackQuery: "calendar full schedule", visualEnvironment: "phone_ui", visualAction: "mostrar tração, conversão ou demanda entrando", visualCamera: "punch_in", visualPacing: "escalating" },
  } satisfies Record<SceneNarrativeFunction, {
    primaryQuery: string;
    fallbackQuery: string;
    visualEnvironment: SceneVisualEnvironment;
    visualAction: string;
    visualCamera: SceneVisualCamera;
    visualPacing: SceneVisualPacing;
  }>;

  const sales = {
    hook: { primaryQuery: "payment notification phone", fallbackQuery: "whatsapp chat business", visualEnvironment: "phone_ui", visualAction: "mostrar dinheiro ou lead entrando logo no início", visualCamera: "punch_in", visualPacing: "burst" },
    pain: { primaryQuery: "grocery expensive price tag", fallbackQuery: "small business storefront vertical", visualEnvironment: "street_business", visualAction: "mostrar o custo de ficar parado ou vendendo mal", visualCamera: "macro", visualPacing: "fast" },
    identification: { primaryQuery: "small business storefront vertical", fallbackQuery: "instagram profile small business", visualEnvironment: "small_business", visualAction: "mostrar a realidade de negócio pequeno e demanda desorganizada", visualCamera: "over_shoulder", visualPacing: "steady" },
    mechanism: { primaryQuery: "instagram profile small business", fallbackQuery: "whatsapp chat business", visualEnvironment: "phone_ui", visualAction: "mostrar o mecanismo de venda ou aquisição", visualCamera: "screen_capture", visualPacing: "steady" },
    action: { primaryQuery: "typing message phone close", fallbackQuery: "whatsapp chat business", visualEnvironment: "phone_ui", visualAction: "mostrar mensagem, oferta ou follow-up sendo feito", visualCamera: "over_shoulder", visualPacing: "fast" },
    payoff: { primaryQuery: "payment notification phone", fallbackQuery: "client message confirmed", visualEnvironment: "phone_ui", visualAction: "mostrar confirmação de cliente ou pagamento", visualCamera: "macro", visualPacing: "escalating" },
  } satisfies Record<SceneNarrativeFunction, {
    primaryQuery: string;
    fallbackQuery: string;
    visualEnvironment: SceneVisualEnvironment;
    visualAction: string;
    visualCamera: SceneVisualCamera;
    visualPacing: SceneVisualPacing;
  }>;

  const execution = {
    hook: { primaryQuery: "typing message phone close", fallbackQuery: "multiple notifications phone", visualEnvironment: "phone_ui", visualAction: "abrir com ação visível em vez de pose", visualCamera: "punch_in", visualPacing: "burst" },
    pain: { primaryQuery: "calendar full schedule", fallbackQuery: "small business storefront vertical", visualEnvironment: "workspace", visualAction: "mostrar atraso, bagunça ou oportunidade passando", visualCamera: "top_down", visualPacing: "fast" },
    identification: { primaryQuery: "hands smartphone app", fallbackQuery: "small business storefront vertical", visualEnvironment: "workspace", visualAction: "mostrar alguém comum operando pelo celular", visualCamera: "over_shoulder", visualPacing: "steady" },
    mechanism: { primaryQuery: "instagram business phone vertical", fallbackQuery: "whatsapp chat business", visualEnvironment: "phone_ui", visualAction: "mostrar o passo a passo em UI", visualCamera: "screen_capture", visualPacing: "steady" },
    action: { primaryQuery: "typing message phone close", fallbackQuery: "whatsapp chat business", visualEnvironment: "phone_ui", visualAction: "mostrar execução concreta e simples", visualCamera: "over_shoulder", visualPacing: "fast" },
    payoff: { primaryQuery: "client message confirmed", fallbackQuery: "multiple notifications phone", visualEnvironment: "phone_ui", visualAction: "mostrar sinal concreto de resultado", visualCamera: "macro", visualPacing: "escalating" },
  } satisfies Record<SceneNarrativeFunction, {
    primaryQuery: string;
    fallbackQuery: string;
    visualEnvironment: SceneVisualEnvironment;
    visualAction: string;
    visualCamera: SceneVisualCamera;
    visualPacing: SceneVisualPacing;
  }>;

  const business = {
    hook: { primaryQuery: "startup analytics dashboard vertical", fallbackQuery: "payment notification phone", visualEnvironment: "dashboard", visualAction: "abrir com prova ou contraste imediato", visualCamera: "punch_in", visualPacing: "burst" },
    pain: { primaryQuery: "wallet empty close", fallbackQuery: "small business storefront vertical", visualEnvironment: "workspace", visualAction: "mostrar dor concreta em vez de escritório genérico", visualCamera: "macro", visualPacing: "fast" },
    identification: { primaryQuery: "small business storefront vertical", fallbackQuery: "hands smartphone app", visualEnvironment: "small_business", visualAction: "mostrar contexto de vida real e execução", visualCamera: "over_shoulder", visualPacing: "steady" },
    mechanism: { primaryQuery: "startup analytics dashboard vertical", fallbackQuery: "mobile app interface vertical", visualEnvironment: "dashboard", visualAction: "mostrar mecanismo em interface real", visualCamera: "screen_capture", visualPacing: "steady" },
    action: { primaryQuery: "typing message phone close", fallbackQuery: "instagram business phone vertical", visualEnvironment: "phone_ui", visualAction: "mostrar o passo que gera movimento", visualCamera: "over_shoulder", visualPacing: "fast" },
    payoff: { primaryQuery: "payment notification phone", fallbackQuery: "calendar full schedule", visualEnvironment: "phone_ui", visualAction: "mostrar consequência positiva e específica", visualCamera: "macro", visualPacing: "escalating" },
  } satisfies Record<SceneNarrativeFunction, {
    primaryQuery: string;
    fallbackQuery: string;
    visualEnvironment: SceneVisualEnvironment;
    visualAction: string;
    visualCamera: SceneVisualCamera;
    visualPacing: SceneVisualPacing;
  }>;

  const library = input.profile === "finance"
    ? finance
    : input.profile === "saas"
      ? saas
      : input.profile === "sales"
        ? sales
        : input.profile === "execution"
          ? execution
          : business;

  return library[input.fn];
}

export function enrichShortScenePlanV2(
  scene: ShortScenePlan,
  index: number,
  allScenes: ShortScenePlan[],
  context: {
    title: string;
    pillar?: string | null;
    hook?: string | null;
    formatTemplateKey?: string | null;
    seriesKey?: string | null;
    notes?: string | null;
    styleMode: ShortStyleMode;
  },
): ShortScenePlan {
  const fn = scene.narrativeFunction ?? inferSceneNarrativeFunction(index, allScenes.length, scene.voiceover);
  const profile = inferAssetSemanticProfile({
    ...context,
    sceneVoiceover: scene.voiceover,
    sceneOverlay: scene.overlay,
  });
  const preset = inferSceneQueryPreset({ fn, profile });
  const primaryQuery = refineAssetSearchQuery(scene.assetSearchQuery || preset.primaryQuery, preset.primaryQuery, {
    ...context,
    sceneVoiceover: scene.voiceover,
    sceneOverlay: scene.overlay,
  });
  const fallbackQuery = refineAssetSearchQuery(scene.assetFallbackQuery || preset.fallbackQuery, preset.fallbackQuery, {
    ...context,
    sceneVoiceover: scene.voiceover,
    sceneOverlay: scene.overlay,
  });

  return {
    ...scene,
    narrativeFunction: fn,
    scenePurpose: scene.scenePurpose || preset.visualAction,
    emotionalTrigger: scene.emotionalTrigger ?? inferSceneEmotionalTrigger(fn),
    proofType: scene.proofType ?? inferSceneProofType(fn, profile),
    overlay: compressOverlayText(scene.overlay, fn === "hook" ? "COMECE HOJE" : fn === "pain" ? "ERRO CARO" : fn === "action" ? "FAÇA ISSO" : "RESULTADO REAL"),
    overlayHighlightWords: buildOverlayHighlightWords(scene.overlay, scene.voiceover),
    visualEnvironment: scene.visualEnvironment ?? preset.visualEnvironment,
    visualAction: scene.visualAction ?? preset.visualAction,
    visualCamera: scene.visualCamera ?? preset.visualCamera,
    visualPacing: scene.visualPacing ?? preset.visualPacing,
    visualDirection: normalizeFacelessVisualDirection(
      scene.visualDirection,
      `${preset.visualAction}; ambiente ${preset.visualEnvironment}; câmera ${preset.visualCamera}; pacing ${preset.visualPacing}`,
    ),
    assetProviderHint: scene.assetProviderHint ?? inferSceneAssetProvider(
      fn,
      scene.proofType ?? inferSceneProofType(fn, profile),
    ),
    assetSearchQuery: primaryQuery,
    assetFallbackQuery: fallbackQuery,
    forbiddenVisuals: normalizeForbiddenVisuals(scene.forbiddenVisuals),
    retentionDriver: scene.retentionDriver ?? inferSceneRetentionDriver(fn),
  };
}

export function assessShortQualityV2(payload: ShortFormPackage): ShortQualityAssessment {
  let score = 0;
  const reasons: string[] = [];
  const scenes = payload.scenes;
  const normalizedHook = normalizeEmailAnalysisText(payload.hook);
  const hasStrongHook = normalizedHook.length >= 16 && includesAny(normalizedHook, [
    "erro",
    "mentira",
    "pare",
    "hoje",
    "agora",
    "ninguem",
    "ninguem",
    "sem",
    "ganhando",
    "dinheiro",
    "comecar",
    "comecar",
    "começar",
  ]);
  if (hasStrongHook) {
    score += 1;
    reasons.push("hook com tensão imediata");
  }

  const nonGenericScenes = scenes.filter((scene) => {
    const query = normalizeEmailAnalysisText(`${scene.assetSearchQuery} ${scene.assetFallbackQuery ?? ""}`);
    return !includesAny(query, FORBIDDEN_FACELESS_ASSET_TERMS) && !includesAny(query, GLOBAL_VISUAL_BLACKLIST);
  });
  if (nonGenericScenes.length >= Math.max(3, Math.ceil(scenes.length * 0.7))) {
    score += 1;
    reasons.push("cenas com busca visual específica");
  }

  const hasProof = scenes.some((scene) => scene.proofType && scene.proofType !== "none");
  if (hasProof) {
    score += 1;
    reasons.push("prova visual presente");
  }

  const hasAction = scenes.some((scene) => scene.narrativeFunction === "action" || includesAny(normalizeEmailAnalysisText(scene.voiceover), ["passo", "faca", "faça", "comece", "manda", "poste", "responde", "oferece", "automatiza"]));
  if (hasAction) {
    score += 1;
    reasons.push("ação clara para o espectador");
  }

  const hasContrast = payload.styleMode === "contrarian" || scenes.some((scene) => scene.narrativeFunction === "pain" || scene.narrativeFunction === "payoff");
  if (hasContrast) {
    score += 1;
    reasons.push("contraste narrativo entre dor e payoff");
  }

  if (score < 4) {
    reasons.push("abaixo do gate mínimo de retenção");
  }

  return {
    score,
    passed: score >= 4,
    reasons,
  };
}

export function applyAtlasV2SceneEngine(
  payload: ShortFormPackage,
  context: {
    title: string;
    pillar?: string | null;
    hook?: string | null;
    formatTemplateKey?: string | null;
    seriesKey?: string | null;
    notes?: string | null;
  },
): ShortFormPackage {
  const enrichedScenes = payload.scenes.map((scene, index, allScenes) =>
    enrichShortScenePlanV2(scene, index, allScenes, {
      ...context,
      styleMode: payload.styleMode,
    }),
  );
  const qualityAssessment = assessShortQualityV2({
    ...payload,
    scenes: enrichedScenes,
  });

  return {
    ...payload,
    scenes: enrichedScenes,
    qualityAssessment,
  };
}

export async function resolveSceneAssets(
  pexelsMedia: PexelsMediaService,
  scenes: ShortScenePlan[],
  maxScenes: number,
): Promise<Array<{
  order: number;
  searchQuery: string;
  suggestions: PexelsVideoSuggestion[];
}>> {
  if (!pexelsMedia.isEnabled()) {
    return [];
  }

  const results: Array<{
    order: number;
    searchQuery: string;
    suggestions: PexelsVideoSuggestion[];
  }> = [];

  const sceneLimit = Math.min(8, Math.max(1, scenes.length > 0 ? scenes.length : maxScenes));
  for (const scene of scenes.slice(0, sceneLimit)) {
    try {
      let suggestions = await pexelsMedia.searchVideos(
        scene.assetSearchQuery,
        3,
        scene.durationSeconds,
      );
      if (suggestions.length === 0 && scene.assetFallbackQuery && scene.assetFallbackQuery !== scene.assetSearchQuery) {
        suggestions = await pexelsMedia.searchVideos(
          scene.assetFallbackQuery,
          3,
          scene.durationSeconds,
        );
      }
      results.push({
        order: scene.order,
        searchQuery: suggestions.length > 0 ? scene.assetSearchQuery : (scene.assetFallbackQuery ?? scene.assetSearchQuery),
        suggestions,
      });
    } catch {
      results.push({
        order: scene.order,
        searchQuery: scene.assetFallbackQuery ?? scene.assetSearchQuery,
        suggestions: [],
      });
    }
  }

  return results;
}

export function extractManualShortScriptSource(notes: string | null | undefined): { title?: string; body: string } | null {
  if (!notes?.trim()) {
    return null;
  }

  const match = notes.match(/MANUAL_SHORT_SCRIPT[\s\S]*?\ntitle:\s*(.+?)\nbody:\n([\s\S]*?)\nEND_MANUAL_SHORT_SCRIPT/);
  if (!match?.[2]?.trim()) {
    return null;
  }

  return {
    title: match[1]?.trim() || undefined,
    body: match[2].trim(),
  };
}

export function extractManualSectionBullets(body: string, headerPattern: RegExp): string[] {
  const lines = body.split(/\r?\n/);
  const bullets: string[] = [];
  let active = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (/^#{1,6}\s/.test(line) && !headerPattern.test(line)) {
      if (active) {
        break;
      }
      continue;
    }
    if (!active && headerPattern.test(line)) {
      active = true;
      continue;
    }
    if (!active) {
      continue;
    }
    if (/^[*-]\s+/.test(line)) {
      bullets.push(line.replace(/^[*-]\s+/, "").trim());
    }
  }

  return bullets;
}

export function extractManualTheme(body: string): string | undefined {
  const match = body.match(/^\s*Tema:\s*(.+)$/im);
  return match?.[1]?.trim() || undefined;
}

export function inferManualShortStyleMode(body: string, fallback: ShortStyleMode): ShortStyleMode {
  const tone = body.match(/^\s*Tom:\s*(.+)$/im)?.[1] ?? "";
  const normalized = normalizeEmailAnalysisText(`${body}\n${tone}`);

  if (includesAny(normalized, ["motivador", "motivacional", "encorajador", "acao", "ação"])) {
    return "motivational";
  }
  if (includesAny(normalized, ["emocional", "emocao", "emoção", "dor", "virada"])) {
    return "emotional";
  }
  if (includesAny(normalized, ["provocativo", "provocadora", "contrarian", "quebra de crenca", "quebra de crença"])) {
    return "contrarian";
  }
  return fallback;
}

export function buildManualSceneOverlay(label: string | undefined, voiceover: string): string {
  const normalizedLabel = normalizeEmailAnalysisText(label ?? "");
  const normalizedVoice = normalizeEmailAnalysisText(voiceover);

  if (/passo\s*\d/.test(normalizedVoice)) {
    const match = voiceover.match(/passo\s*\d+/i);
    return compressOverlayText(match?.[0] ?? voiceover, "PASSO");
  }
  if (normalizedLabel.includes("gancho")) {
    return "COMECE HOJE";
  }
  if (normalizedLabel.includes("ideia")) {
    return "IDEIA SIMPLES";
  }
  if (normalizedLabel.includes("quebra")) {
    return "NAO PRECISA SER EXPERT";
  }
  if (normalizedLabel.includes("fechamento")) {
    return "COMECE AGORA";
  }
  if (includesAny(normalizedVoice, ["sem investimento", "so com celular", "só com celular"])) {
    return "SEM INVESTIMENTO";
  }

  return compressOverlayText(voiceover, "COMECE AGORA");
}

export function buildManualSceneVisualDirection(
  fallbackDirections: string[],
  index: number,
  voiceover: string,
): string {
  const explicit = fallbackDirections[index]?.trim();
  const normalized = normalizeEmailAnalysisText(voiceover);
  let contextual = "cortes rápidos com celular, interface social, prova em tela e pequenos negócios";
  if (includesAny(normalized, ["sem investimento", "celular"])) {
    contextual = "mãos com celular, interface social, texto grande e fundo escuro";
  } else if (includesAny(normalized, ["instagram", "perfil", "posta"])) {
    contextual = "tela de Instagram business, pequenos comércios e interface de perfil";
  } else if (includesAny(normalized, ["oferece", "mensagem", "digitar"])) {
    contextual = "mãos digitando mensagem comercial no celular, cortes rápidos e foco no chat";
  } else if (includesAny(normalized, ["responde clientes", "notificacoes", "notificações", "organiza o perfil"])) {
    contextual = "notificações, interação social e organização de perfil com motion text";
  } else if (includesAny(normalized, ["continua parado", "comeca antes", "começa antes"])) {
    contextual = "fundo escurecendo, texto forte e fechamento limpo";
  }

  if (explicit) {
    return normalizeFacelessVisualDirection(`${explicit}; ${contextual}`, contextual);
  }

  return contextual;
}

export function buildManualSceneAssetQuery(voiceover: string, visualDirection: string): string {
  const normalized = normalizeEmailAnalysisText(`${voiceover}\n${visualDirection}`);

  if (includesAny(normalized, ["instagram", "perfil", "social", "posta"])) {
    return "instagram business phone vertical";
  }
  if (includesAny(normalized, ["celular", "smartphone"])) {
    return "hands smartphone business vertical";
  }
  if (includesAny(normalized, ["negocio", "negócio", "empresa", "comercio", "comércio"])) {
    return "small business storefront vertical";
  }
  if (includesAny(normalized, ["mensagem", "oferece", "digitar", "chat"])) {
    return "typing message smartphone vertical";
  }
  if (includesAny(normalized, ["notificacoes", "notificações", "clientes", "interacao", "interação"])) {
    return "social media notifications vertical";
  }
  if (includesAny(normalized, ["fundo escuro", "escurecendo", "final"])) {
    return "dark abstract background vertical";
  }

  return "small business instagram workspace vertical";
}

export function parseManualTimedScenes(body: string): Array<{
  durationSeconds: number;
  label?: string;
  voiceover: string;
}> {
  const lines = body.split(/\r?\n/);
  const scenes: Array<{ durationSeconds: number; label?: string; voiceLines: string[] }> = [];
  let current: { durationSeconds: number; label?: string; voiceLines: string[] } | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const headerMatch = line.match(/^#{1,6}\s*.*?(\d+)\s*[–-]\s*(\d+)s(?:\s*\(([^)]+)\))?/i);
    if (headerMatch) {
      if (current && current.voiceLines.length > 0) {
        scenes.push(current);
      }
      const start = Number.parseInt(headerMatch[1] ?? "0", 10);
      const end = Number.parseInt(headerMatch[2] ?? "0", 10);
      current = {
        durationSeconds: Math.max(2, end - start),
        label: headerMatch[3]?.trim(),
        voiceLines: [],
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith(">")) {
      current.voiceLines.push(line.replace(/^>\s*/, "").replace(/^["“”'`]+|["“”'`]+$/g, "").trim());
      continue;
    }

    if (/^["“].+["”]$/.test(line)) {
      current.voiceLines.push(line.replace(/^["“”'`]+|["“”'`]+$/g, "").trim());
    }
  }

  if (current && current.voiceLines.length > 0) {
    scenes.push(current);
  }

  return scenes.flatMap((scene) => {
    const voiceLines = scene.voiceLines
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (voiceLines.length === 0) {
      return [];
    }

    if (voiceLines.length === 1) {
      return [{
        durationSeconds: scene.durationSeconds,
        label: scene.label,
        voiceover: voiceLines[0]!,
      }];
    }

    const baseDuration = Math.max(2, Math.floor(scene.durationSeconds / voiceLines.length));
    let remaining = scene.durationSeconds - (baseDuration * voiceLines.length);

    return voiceLines.map((voiceover, index) => {
      const extra = remaining > 0 ? 1 : 0;
      remaining = Math.max(0, remaining - extra);
      return {
        durationSeconds: baseDuration + extra,
        label: scene.label ? `${scene.label} ${index + 1}` : undefined,
        voiceover,
      };
    });
  });
}

export function parseManualNarrationScenes(body: string): Array<{
  durationSeconds: number;
  label?: string;
  voiceover: string;
}> {
  const lines = body.split(/\r?\n/);
  const blocks: string[] = [];
  let active = false;
  let currentBlock: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!active && /^#{1,6}\s*.*Narra[cç][aã]o/i.test(line)) {
      active = true;
      continue;
    }
    if (active && /^#{1,6}\s+/.test(line)) {
      break;
    }
    if (!active) {
      continue;
    }
    if (!line) {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock.join(" ").trim());
        currentBlock = [];
      }
      continue;
    }
    if (line.startsWith("\"") || line.startsWith("“")) {
      currentBlock.push(line.replace(/^["“”'`]+|["“”'`]+$/g, "").trim());
    }
  }

  if (currentBlock.length > 0) {
    blocks.push(currentBlock.join(" ").trim());
  }

  if (blocks.length === 0) {
    return [];
  }

  const durations = rebalanceSceneDurations(
    blocks.map((voiceover, index) => ({
      order: index + 1,
      durationSeconds: Math.max(4, Math.round(30 / blocks.length)),
      voiceover,
      overlay: "MECANISMO PRÁTICO",
      visualDirection: "motion text forte, celular e interface social",
      assetSearchQuery: "small business instagram workspace vertical",
    })),
    30,
  );

  return durations.map((scene) => ({
    durationSeconds: scene.durationSeconds,
    voiceover: scene.voiceover,
  }));
}

export function buildManualShortFormPackage(input: {
  item: {
    title: string;
    pillar: string | null;
    hook: string | null;
    formatTemplateKey?: string | null;
    seriesKey?: string | null;
    notes?: string | null;
  };
  platform: string;
}): ShortFormPackage | null {
  const source = extractManualShortScriptSource(input.item.notes);
  if (!source) {
    return null;
  }

  const styleMode = inferManualShortStyleMode(
    source.body,
    inferShortStyleMode(input.item),
  );
  const styleProfile = buildShortStyleProfile(styleMode);
  const directions = extractManualSectionBullets(source.body, /^#{1,6}\s*.*Dire[cç][aã]o de cenas/i);
  const timedScenes = parseManualTimedScenes(source.body);
  const rawScenes = timedScenes.length > 0 ? timedScenes : parseManualNarrationScenes(source.body);
  if (rawScenes.length === 0) {
    return null;
  }

  const scenes: ShortScenePlan[] = rawScenes.map((scene, index) => {
    const visualDirection = buildManualSceneVisualDirection(directions, index, scene.voiceover);
    return {
      order: index + 1,
      durationSeconds: clampSceneDuration(scene.durationSeconds, 5),
      voiceover: scene.voiceover,
      overlay: buildManualSceneOverlay(scene.label, scene.voiceover),
      visualDirection,
      assetSearchQuery: buildManualSceneAssetQuery(scene.voiceover, visualDirection),
    };
  });

  const targetDurationSeconds = sumSceneDurations(scenes);
  const titleBase = source.title?.trim() || input.item.title.trim();
  const theme = extractManualTheme(source.body) ?? titleBase;
  const hook = scenes[0]?.voiceover ?? input.item.hook?.trim() ?? titleBase;
  const cta = scenes[scenes.length - 1]?.voiceover ?? "Comente o que você faria hoje.";
  const titleOptions = [
    titleBase,
    truncateBriefText(`${theme}: como começar hoje`, 72),
    truncateBriefText(`${theme} sem enrolação`, 72),
  ];

  return {
    styleMode,
    mode: "viral_short",
    targetDurationSeconds,
    hook,
    script: deriveScriptFromScenes(scenes),
    cta,
    description: `${theme}. Short construído a partir de roteiro manual, com execução direta e cenas orientadas pelo prompt do usuário.`,
    titleOptions,
    scenes,
    platformVariants: {
      youtubeShort: {
        title: titleBase,
        caption: `${theme}. Execução direta, passos simples e contexto visual alinhado ao roteiro.`,
        coverText: styleProfile.youtubeCoverText,
      },
      tiktok: {
        hook,
        caption: `${theme}. Vídeo curto, direto e com foco em ação imediata.`,
        coverText: styleProfile.tiktokCoverText,
      },
    },
  };
}

export function validateShortFormPackage(
  payload: ShortFormPackage,
  fallback: ShortFormPackage,
  context: {
    title: string;
    pillar?: string | null;
    hook?: string | null;
    formatTemplateKey?: string | null;
    seriesKey?: string | null;
    notes?: string | null;
  },
): ShortFormPackage {
  const normalizedScenes = normalizeScenePlan(payload.scenes, fallback.scenes);
  const desiredTarget = clampShortTargetDuration(payload.targetDurationSeconds, fallback.targetDurationSeconds);
  const rebalancedScenes = rebalanceSceneDurations(normalizedScenes, desiredTarget);
  const targetDurationSeconds = sumSceneDurations(rebalancedScenes);
  const styleMode = normalizeShortStyleMode(payload.styleMode, fallback.styleMode);
  const requestedCta = normalizeShortLine(payload.cta, fallback.cta);
  const cta = requestedCta.toLowerCase().includes("inscreva")
    ? "Comente qual métrica você usaria."
    : requestedCta;
  const canonicalHook = normalizeShortLine(payload.platformVariants.tiktok.hook || payload.hook, fallback.hook);
  const scenes = rebalancedScenes.map((scene, index, allScenes) => {
    if (index === allScenes.length - 1) {
      return {
        ...scene,
        voiceover: cta,
      };
    }
    return scene;
  });
  const resolvedScenes = scenes.map((scene, index, allScenes) => ({
    ...scene,
    assetSearchQuery: refineAssetSearchQuery(
      scene.assetSearchQuery,
      fallback.scenes[Math.min(index, fallback.scenes.length - 1)]?.assetSearchQuery ?? "startup business office",
      {
        ...context,
        sceneVoiceover: scene.voiceover,
        sceneOverlay: scene.overlay,
        styleMode,
      },
    ),
    overlay: compressOverlayText(
      index === allScenes.length - 1 ? cta : scene.overlay,
      fallback.scenes[Math.min(index, fallback.scenes.length - 1)]?.overlay ?? "MECANISMO PRÁTICO",
    ),
  }));
  const script = deriveScriptFromScenes(resolvedScenes);

  const validated: ShortFormPackage = {
    ...payload,
    styleMode,
    mode: "viral_short",
    targetDurationSeconds,
    hook: canonicalHook,
    cta,
    script,
    description: normalizeShortLine(payload.description, fallback.description),
    titleOptions: payload.titleOptions.length > 0 ? payload.titleOptions.map((item) => normalizeShortLine(item, fallback.titleOptions[0]!)).slice(0, 3) : fallback.titleOptions,
    scenes: resolvedScenes.map((scene, index) => ({
      ...scene,
      visualDirection: normalizeFacelessVisualDirection(
        scene.visualDirection,
        fallback.scenes[Math.min(index, fallback.scenes.length - 1)]?.visualDirection ?? "motion text, dashboard, mãos, tela e b-roll de trabalho",
      ),
    })),
    platformVariants: {
      youtubeShort: {
        title: normalizeShortLine(payload.platformVariants.youtubeShort.title, fallback.platformVariants.youtubeShort.title),
        caption: normalizeShortLine(payload.platformVariants.youtubeShort.caption, fallback.platformVariants.youtubeShort.caption),
        coverText: normalizeShortLine(payload.platformVariants.youtubeShort.coverText, fallback.platformVariants.youtubeShort.coverText),
      },
      tiktok: {
        hook: canonicalHook,
        caption: normalizeShortLine(payload.platformVariants.tiktok.caption, fallback.platformVariants.tiktok.caption),
        coverText: normalizeShortLine(payload.platformVariants.tiktok.coverText, fallback.platformVariants.tiktok.coverText),
      },
    },
  };

  return applyAtlasV2SceneEngine(validated, context);
}

export function buildShortFormFallbackPackage(input: {
  item: {
    title: string;
    pillar: string | null;
    hook: string | null;
    formatTemplateKey?: string | null;
    seriesKey?: string | null;
    notes?: string | null;
  };
  platform: string;
}): ShortFormPackage {
  const styleMode = inferShortStyleMode(input.item);
  const styleProfile = buildShortStyleProfile(styleMode);
  const hook = input.item.hook?.trim()
    || `Se você errar isso em ${input.item.title.toLowerCase()}, vai perder dinheiro sem perceber.`;
  const cta = "Comente qual métrica você usaria.";
  const titleBase = input.item.title.trim();
  const titleOptions = [
    titleBase,
    `O erro por trás de ${titleBase.toLowerCase()}`,
    `${titleBase}: o que quase ninguém explica`,
  ];
  const scenes: ShortScenePlan[] = [
    {
      order: 1,
      durationSeconds: 4,
      voiceover: hook,
      overlay: "ERRO QUE CUSTA CARO",
      visualDirection: "motion text forte, contraste imediato e prova em tela sem rosto",
      assetSearchQuery: "startup analytics dashboard vertical",
    },
    {
      order: 2,
      durationSeconds: 5,
      voiceover: `A maioria olha só para ${input.item.pillar ?? "o resultado"} e ignora o problema real que está drenando dinheiro.`,
      overlay: "OLHAR SÓ O RESULTADO É ARMADILHA",
      visualDirection: "dor concreta em tela, preço, conta ou fricção de operação",
      assetSearchQuery: "wallet empty close",
    },
    {
      order: 3,
      durationSeconds: 5,
      voiceover: "Se você já passou por isso, não falta talento. Falta enxergar o mecanismo certo.",
      overlay: "NAO É FALTA DE TALENTO",
      visualDirection: "identificação imediata com operação real e celular em uso",
      assetSearchQuery: "hands smartphone app",
    },
    {
      order: 4,
      durationSeconds: 6,
      voiceover: `A regra prática aqui é simples: ${titleBase.toLowerCase()} precisa mostrar mecanismo, prova e ação clara.`,
      overlay: "REGRA PRATICA",
      visualDirection: "mecanismo em dashboard, interface ou fluxo claro",
      assetSearchQuery: "startup analytics dashboard vertical",
    },
    {
      order: 5,
      durationSeconds: 5,
      voiceover: "Faça o passo mais simples primeiro e corte tudo que parece bonito, mas não gera movimento.",
      overlay: "COMECE PELO PASSO 1",
      visualDirection: "execução concreta no celular, mensagem, clique ou configuração",
      assetSearchQuery: "typing message phone close",
    },
    {
      order: 6,
      durationSeconds: 5,
      voiceover: cta,
      overlay: "COMENTE SUA MÉTRICA",
      visualDirection: "resultado ou comentário na tela com fechamento limpo e contraste alto",
      assetSearchQuery: "mobile app comments interface vertical",
    },
  ];
  const script = scenes.map((scene) => scene.voiceover).join(" ");
  const description = `${titleBase}. Short direto do Riqueza Despertada com uma ideia central, mecanismo claro e aplicação prática.`;
  const platformVariants: ShortPlatformVariants = {
    youtubeShort: {
      title: titleOptions[0],
      coverText: styleProfile.youtubeCoverText,
      caption: `${titleBase}. Ideia prática para quem quer riqueza com execução.`,
    },
    tiktok: {
      hook,
      coverText: styleProfile.tiktokCoverText,
      caption: `${titleBase}. Sem enrolação, sem fórmula mágica, só mecanismo real.`,
    },
  };

  return {
    styleMode,
    mode: "viral_short",
    targetDurationSeconds: 30,
    hook,
    script,
    cta,
    description,
    titleOptions,
    scenes,
    platformVariants,
  };
}

export function formatDateForTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function buildDailyEditorialResearchReply(input: {
  channelName: string;
  runDate: string;
  primaryTrend?: string;
  selectedTrends: Array<{ title: string; fitScore?: number; angle?: string; approxTraffic?: string }>;
  items: Array<{
    id: number;
    title: string;
    ideaScore: number | null;
    formatTemplateKey: string | null;
    seriesKey: string | null;
    slotKey?: string | null;
    hasScriptPackage?: boolean;
    status?: string | null;
  }>;
  fallbackMode: boolean;
  packageReadyCount?: number;
  packageFailedCount?: number;
}): string {
  const slotLabels: Record<string, string> = {
    morning_finance: "07:00 | Notícias financeiras",
    lunch_income: "12:00 | Renda extra",
    night_trends: "20:00 | Trend adaptado",
  };
  const lines = [
    `Research Kernel ${input.channelName} | ${input.runDate}`,
    `- Modo: ${input.fallbackMode ? "evergreen fallback" : "trend-first"}`,
  ];
  if (input.fallbackMode) {
    lines.push("- Motivo: nenhum trend do dia passou no filtro de finanças, negócios e utilidade prática.");
  }
  if (input.primaryTrend) {
    lines.push(`- Trend líder: ${input.primaryTrend}`);
  }
  if (typeof input.packageReadyCount === "number") {
    lines.push(`- Pacotes prontos: ${input.packageReadyCount}${typeof input.packageFailedCount === "number" ? ` | falhas: ${input.packageFailedCount}` : ""}`);
  }
  if (input.selectedTrends.length > 0) {
    lines.push("", "Trends considerados:");
    for (const trend of input.selectedTrends.slice(0, 3)) {
      lines.push(
        `- ${trend.title}${trend.approxTraffic ? ` | tráfego: ${trend.approxTraffic}` : ""}${trend.fitScore != null ? ` | fit: ${trend.fitScore}` : ""}${trend.angle ? ` | ângulo: ${truncateBriefText(trend.angle, 60)}` : ""}`,
      );
    }
  }
  lines.push("", "Grade editorial do dia:");
  const groupedItems = [
    ["morning_finance", input.items.filter((item) => item.slotKey === "morning_finance")],
    ["lunch_income", input.items.filter((item) => item.slotKey === "lunch_income")],
    ["night_trends", input.items.filter((item) => item.slotKey === "night_trends")],
  ] as const;
  for (const [slotKey, items] of groupedItems) {
    if (items.length === 0) {
      continue;
    }
    lines.push(`- ${slotLabels[slotKey]}:`);
    for (const item of items.slice(0, 2)) {
      lines.push(
        `  - #${item.id} | ${item.title}${item.ideaScore != null ? ` | score: ${item.ideaScore}` : ""}${item.formatTemplateKey ? ` | formato: ${item.formatTemplateKey}` : ""}${item.seriesKey ? ` | série: ${item.seriesKey}` : ""}${item.hasScriptPackage ? " | roteiro: pronto" : item.status ? ` | status: ${item.status}` : ""}`,
      );
    }
  }
  lines.push("", "Próxima ação: aprove 1 opção por faixa horária. Se você não confirmar, o Atlas deve priorizar a melhor pontuada.");
  return lines.join("\n");
}

export type EditorialSlotKey = "morning_finance" | "lunch_income" | "night_trends";

export function getEditorialSlotLabel(slotKey: EditorialSlotKey): string {
  switch (slotKey) {
    case "morning_finance":
      return "07:00 | Notícias financeiras";
    case "lunch_income":
      return "12:00 | Renda extra";
    case "night_trends":
      return "20:00 | Trend adaptado";
  }
}

export function normalizeEditorialSlotKey(value: string | undefined, fallback: EditorialSlotKey): EditorialSlotKey {
  if (value === "morning_finance" || value === "lunch_income" || value === "night_trends") {
    return value;
  }
  return fallback;
}

export function buildDailyEditorialSlotFallbackIdeas(input: {
  fallbackMode: boolean;
  usableTrendTitle?: string;
}): Array<{
  slotKey: EditorialSlotKey;
  seed: string;
}> {
  return [
    {
      slotKey: "morning_finance",
      seed: input.fallbackMode
        ? "notícias financeiras com impacto prático no bolso, juros, dólar, inflação, Selic, emprego e negócios"
        : `notícia financeira do dia com impacto prático: ${input.usableTrendTitle ?? "mercado e bolso"}`,
    },
    {
      slotKey: "lunch_income",
      seed: "meios reais de renda extra, serviços simples, micro-ofertas, vendas locais, renda com celular e execução prática",
    },
    {
      slotKey: "night_trends",
      seed: input.fallbackMode
        ? "trend adaptado para dinheiro, negócio, execução e oportunidade prática"
        : `trend mais pesquisado adaptado para renda, dinheiro ou execução: ${input.usableTrendTitle ?? "trend do dia"}`,
    },
  ];
}

export function extractEditorialSlotKeyFromNotes(notes: string | null | undefined): EditorialSlotKey | undefined {
  const match = notes?.match(/\[slot:(morning_finance|lunch_income|night_trends)\]/i);
  if (!match?.[1]) {
    return undefined;
  }
  return normalizeEditorialSlotKey(match[1], "morning_finance");
}
