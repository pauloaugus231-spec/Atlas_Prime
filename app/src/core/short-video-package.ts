export interface ParsedShortPlatformVariants {
  youtubeShort: {
    title: string;
    caption: string;
    coverText: string;
  };
  tiktok: {
    hook: string;
    caption: string;
    coverText: string;
  };
}

export interface ParsedShortProductionScene {
  order: number;
  subtitleLine: string;
  emphasisWords: string[];
  editInstruction: string;
  selectedAsset?: string;
}

export interface ParsedShortScene {
  order: number;
  durationSeconds: number;
  voiceover: string;
  overlay: string;
  visualDirection: string;
  assetSearchQuery: string;
  assetSuggestions: string[];
  selectedAsset?: string;
  production?: ParsedShortProductionScene;
}

export interface ParsedShortDistributionPlan {
  primaryPlatform?: string;
  secondaryPlatform?: string;
  recommendedWindow?: string;
  secondaryWindow?: string;
  hypothesis?: string;
  rationale?: string;
}

export interface ParsedShortPackage {
  version: 2 | 3;
  mode: string;
  targetDurationSeconds: number;
  hook: string;
  cta: string;
  titleOptions: string[];
  scenes: ParsedShortScene[];
  voiceStyle?: string;
  editRhythm?: string;
  subtitleStyle?: string;
  distributionPlan: ParsedShortDistributionPlan;
  platformVariants: ParsedShortPlatformVariants;
  script: string;
  description: string;
}

function normalizeLineValue(value: string | undefined): string {
  return value?.trim() ?? "";
}

function splitLines(block: string): string[] {
  return block
    .split(/\r?\n/)
    .map((line) => line.trimEnd());
}

function parseKeyValue(line: string): { key: string; value: string } | null {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex <= 0) {
    return null;
  }
  return {
    key: line.slice(0, separatorIndex).trim(),
    value: line.slice(separatorIndex + 1).trim(),
  };
}

function extractLatestPackageBlock(notes: string): { version: 2 | 3; block: string } | null {
  const starts = [
    { token: "SHORT_PACKAGE_V3", version: 3 as const, endToken: "END_SHORT_PACKAGE_V3" },
    { token: "SHORT_PACKAGE_V2", version: 2 as const, endToken: "END_SHORT_PACKAGE_V2" },
  ];

  let selected:
    | { start: number; version: 2 | 3; endToken: string }
    | undefined;

  for (const candidate of starts) {
    const pattern = new RegExp(`(^|\\n)${candidate.token}(?=\\n|$)`, "g");
    let match: RegExpExecArray | null;
    let latestStart = -1;
    while ((match = pattern.exec(notes)) !== null) {
      latestStart = match.index + (match[1]?.length ?? 0);
    }

    if (latestStart >= 0 && (!selected || latestStart > selected.start)) {
      selected = {
        start: latestStart,
        version: candidate.version,
        endToken: candidate.endToken,
      };
    }
  }

  if (!selected) {
    return null;
  }

  const endIndex = notes.indexOf(selected.endToken, selected.start);
  const block = endIndex >= 0
    ? notes.slice(selected.start, endIndex + selected.endToken.length)
    : notes.slice(selected.start);

  return {
    version: selected.version,
    block,
  };
}

function parseScenePlanLine(line: string): ParsedShortScene | null {
  const match = line.match(/^(\d+)\.\s+(\d+)s\s+\|\s+VO=(.*?)\s+\|\s+overlay=(.*?)\s+\|\s+visual=(.*?)\s+\|\s+search=(.*)$/);
  if (!match) {
    return null;
  }

  return {
    order: Number.parseInt(match[1] ?? "0", 10),
    durationSeconds: Number.parseInt(match[2] ?? "0", 10),
    voiceover: normalizeLineValue(match[3]),
    overlay: normalizeLineValue(match[4]),
    visualDirection: normalizeLineValue(match[5]),
    assetSearchQuery: normalizeLineValue(match[6]),
    assetSuggestions: [],
  };
}

function parseProductionSceneLine(line: string): ParsedShortProductionScene | null {
  const prefixMatch = line.match(/^scene_(\d+)\.edit:\s*(.*)$/);
  if (!prefixMatch) {
    return null;
  }

  const order = Number.parseInt(prefixMatch[1] ?? "0", 10);
  const parts = (prefixMatch[2] ?? "")
    .split(" | ")
    .map((part) => part.trim())
    .filter(Boolean);

  let subtitleLine = "";
  let emphasisWords: string[] = [];
  let editInstruction = "";
  let selectedAsset: string | undefined;

  for (const part of parts) {
    const parsed = parseKeyValue(part);
    if (!parsed) {
      continue;
    }
    if (parsed.key === "subtitle") {
      subtitleLine = parsed.value;
    } else if (parsed.key === "emphasis") {
      emphasisWords = parsed.value
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    } else if (parsed.key === "instruction") {
      editInstruction = parsed.value;
    } else if (parsed.key === "selected_asset") {
      selectedAsset = parsed.value || undefined;
    }
  }

  return {
    order,
    subtitleLine,
    emphasisWords,
    editInstruction,
    selectedAsset,
  };
}

function ensurePlatformVariants(): ParsedShortPlatformVariants {
  return {
    youtubeShort: {
      title: "",
      caption: "",
      coverText: "",
    },
    tiktok: {
      hook: "",
      caption: "",
      coverText: "",
    },
  };
}

export function extractLatestShortPackage(notes: string | null | undefined): ParsedShortPackage | null {
  if (!notes?.trim()) {
    return null;
  }

  const latest = extractLatestPackageBlock(notes);
  if (!latest) {
    return null;
  }

  const lines = splitLines(latest.block);
  const scenes = new Map<number, ParsedShortScene>();
  const productionScenes = new Map<number, ParsedShortProductionScene>();
  const distributionPlan: ParsedShortDistributionPlan = {};
  const platformVariants = ensurePlatformVariants();

  let mode = "viral_short";
  let targetDurationSeconds = 40;
  let hook = "";
  let cta = "";
  const titleOptions: string[] = [];
  let voiceStyle = "";
  let editRhythm = "";
  let subtitleStyle = "";
  let script = "";
  let description = "";
  let activeSection:
    | "title_options"
    | "scene_plan"
    | "scene_assets"
    | "production_pack"
    | "distribution_plan"
    | "platform_variants"
    | "script"
    | "description"
    | null = null;
  let currentAssetSceneOrder: number | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line === "SHORT_PACKAGE_V3" || line === "SHORT_PACKAGE_V2" || line.startsWith("END_SHORT_PACKAGE_V")) {
      continue;
    }

    if (line === "title_options:") {
      activeSection = "title_options";
      continue;
    }
    if (line === "scene_plan:") {
      activeSection = "scene_plan";
      continue;
    }
    if (line === "scene_assets:") {
      activeSection = "scene_assets";
      currentAssetSceneOrder = null;
      continue;
    }
    if (line === "production_pack:") {
      activeSection = "production_pack";
      continue;
    }
    if (line === "distribution_plan:") {
      activeSection = "distribution_plan";
      continue;
    }
    if (line === "platform_variants:") {
      activeSection = "platform_variants";
      continue;
    }
    if (line === "script:") {
      activeSection = "script";
      script = "";
      continue;
    }
    if (line === "description:") {
      activeSection = "description";
      description = "";
      continue;
    }

    if (activeSection === "script") {
      script = script ? `${script}\n${rawLine}` : rawLine.trim();
      continue;
    }

    if (activeSection === "description") {
      description = description ? `${description}\n${rawLine}` : rawLine.trim();
      continue;
    }

    if (activeSection === "title_options") {
      const titleMatch = line.match(/^\d+\.\s+(.*)$/);
      if (titleMatch?.[1]?.trim()) {
        titleOptions.push(titleMatch[1].trim());
      }
      continue;
    }

    if (activeSection === "scene_plan") {
      const scene = parseScenePlanLine(line);
      if (scene) {
        scenes.set(scene.order, scene);
      }
      continue;
    }

    if (activeSection === "scene_assets") {
      const queryMatch = line.match(/^scene_(\d+)\.query:\s*(.*)$/);
      if (queryMatch) {
        currentAssetSceneOrder = Number.parseInt(queryMatch[1] ?? "0", 10);
        const scene = scenes.get(currentAssetSceneOrder);
        if (scene) {
          scene.assetSearchQuery = normalizeLineValue(queryMatch[2]);
        }
        continue;
      }

      const assetMatch = line.match(/^scene_(\d+)\.asset_\d+:\s*(.*)$/);
      if (assetMatch) {
        const order = Number.parseInt(assetMatch[1] ?? "0", 10);
        const asset = normalizeLineValue(assetMatch[2]);
        const scene = scenes.get(order);
        if (scene && asset) {
          scene.assetSuggestions.push(asset);
        }
        continue;
      }

      continue;
    }

    if (activeSection === "production_pack") {
      if (line.startsWith("voice_style:")) {
        voiceStyle = normalizeLineValue(line.slice("voice_style:".length));
        continue;
      }
      if (line.startsWith("edit_rhythm:")) {
        editRhythm = normalizeLineValue(line.slice("edit_rhythm:".length));
        continue;
      }
      if (line.startsWith("subtitle_style:")) {
        subtitleStyle = normalizeLineValue(line.slice("subtitle_style:".length));
        continue;
      }

      const productionScene = parseProductionSceneLine(line);
      if (productionScene) {
        productionScenes.set(productionScene.order, productionScene);
      }
      continue;
    }

    if (activeSection === "distribution_plan") {
      const parsed = parseKeyValue(line);
      if (!parsed) {
        continue;
      }
      if (parsed.key === "primary_platform") {
        distributionPlan.primaryPlatform = parsed.value;
      } else if (parsed.key === "secondary_platform") {
        distributionPlan.secondaryPlatform = parsed.value;
      } else if (parsed.key === "recommended_window") {
        distributionPlan.recommendedWindow = parsed.value;
      } else if (parsed.key === "secondary_window") {
        distributionPlan.secondaryWindow = parsed.value;
      } else if (parsed.key === "hypothesis") {
        distributionPlan.hypothesis = parsed.value;
      } else if (parsed.key === "rationale") {
        distributionPlan.rationale = parsed.value;
      }
      continue;
    }

    if (activeSection === "platform_variants") {
      const parsed = parseKeyValue(line);
      if (!parsed) {
        continue;
      }

      if (parsed.key === "youtube_short.title") {
        platformVariants.youtubeShort.title = parsed.value;
      } else if (parsed.key === "youtube_short.caption") {
        platformVariants.youtubeShort.caption = parsed.value;
      } else if (parsed.key === "youtube_short.cover_text") {
        platformVariants.youtubeShort.coverText = parsed.value;
      } else if (parsed.key === "tiktok.hook") {
        platformVariants.tiktok.hook = parsed.value;
      } else if (parsed.key === "tiktok.caption") {
        platformVariants.tiktok.caption = parsed.value;
      } else if (parsed.key === "tiktok.cover_text") {
        platformVariants.tiktok.coverText = parsed.value;
      }
      continue;
    }

    const parsed = parseKeyValue(line);
    if (!parsed) {
      continue;
    }

    if (parsed.key === "mode") {
      mode = parsed.value || mode;
    } else if (parsed.key === "target_duration_seconds") {
      const parsedValue = Number.parseInt(parsed.value, 10);
      if (Number.isFinite(parsedValue) && parsedValue > 0) {
        targetDurationSeconds = parsedValue;
      }
    } else if (parsed.key === "hook") {
      hook = parsed.value;
    } else if (parsed.key === "cta") {
      cta = parsed.value;
    }
  }

  const orderedScenes = [...scenes.values()]
    .sort((left, right) => left.order - right.order)
    .map((scene) => {
      const production = productionScenes.get(scene.order);
      return {
        ...scene,
        selectedAsset: production?.selectedAsset ?? scene.assetSuggestions[0],
        production,
      };
    });

  if (orderedScenes.length === 0) {
    return null;
  }

  return {
    version: latest.version,
    mode,
    targetDurationSeconds,
    hook,
    cta,
    titleOptions,
    scenes: orderedScenes,
    voiceStyle: voiceStyle || undefined,
    editRhythm: editRhythm || undefined,
    subtitleStyle: subtitleStyle || undefined,
    distributionPlan,
    platformVariants,
    script: script.trim(),
    description: description.trim(),
  };
}
