export type GoogleAgendaScope = "primary" | "work" | "both";

export type GoogleAccountReplyResolution =
  | { kind: "single"; account: string }
  | { kind: "both"; accounts: string[] };

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(source: string, tokens: string[]): boolean {
  return tokens.some((token) => source.includes(token));
}

export function resolveWorkGoogleAccountAlias(aliases: string[]): string | undefined {
  return aliases.includes("abordagem")
    ? "abordagem"
    : aliases.find((alias) => alias !== "primary");
}

export function refersToBothGoogleAccounts(prompt: string): boolean {
  const normalized = normalize(prompt);
  return includesAny(normalized, [
    "ambos",
    "ambas",
    "pessoal e trabalho",
    "trabalho e pessoal",
    "pessoal e profissional",
    "agenda pessoal e trabalho",
    "agenda principal e abordagem",
    "agenda pessoal e abordagem",
    "calendario pessoal e trabalho",
    "calendario principal e abordagem",
    "calendario pessoal e abordagem",
  ]);
}

export function extractExplicitGoogleAccountAlias(prompt: string, aliases: string[]): string | undefined {
  const normalized = normalize(prompt);
  if (!normalized) {
    return undefined;
  }

  if (
    normalized === "primary" ||
    normalized === "principal" ||
    normalized === "pessoal" ||
    includesAny(normalized, [
      "conta primary",
      "na conta primary",
      "account primary",
      "email primary",
      "conta principal",
      "conta pessoal",
      "na conta principal",
      "na conta pessoal",
      "agenda principal",
      "agenda pessoal",
      "agenda primary",
      "calendario principal",
      "calendario pessoal",
      "calendario primary",
      "no principal",
      "na principal",
      "no pessoal",
      "na pessoal",
      "no primary",
      "na primary",
      "da primary",
      "da principal",
      "do pessoal",
      "na agenda principal",
      "na agenda pessoal",
      "na agenda primary",
      "no calendario primary",
    ])
  ) {
    return aliases.includes("primary") ? "primary" : undefined;
  }

  const workAlias = resolveWorkGoogleAccountAlias(aliases);
  if (
    workAlias &&
    (
      normalized === "trabalho" ||
      includesAny(normalized, [
        "agenda trabalho",
        "agenda de trabalho",
        "calendario trabalho",
        "calendario de trabalho",
        "no trabalho",
        "na agenda de trabalho",
      ])
    )
  ) {
    return workAlias;
  }

  for (const alias of aliases) {
    if (alias === "primary") {
      continue;
    }

    const readable = normalize(alias.replace(/_/g, " "));
    if (
      normalized === readable ||
      includesAny(normalized, [
        `conta ${readable}`,
        `na conta ${readable}`,
        `account ${readable}`,
        `email ${readable}`,
        `agenda ${readable}`,
        `agenda da ${readable}`,
        `agenda de ${readable}`,
        `calendario ${readable}`,
        `calendario da ${readable}`,
        `calendario de ${readable}`,
        `na agenda ${readable}`,
        `na agenda da ${readable}`,
        `no calendario ${readable}`,
        `no calendario da ${readable}`,
        `na ${readable}`,
        `no ${readable}`,
        `da ${readable}`,
        `do ${readable}`,
        `para ${readable}`,
      ])
    ) {
      return alias;
    }
  }

  return undefined;
}

export function resolveGoogleAccountAliasesForPrompt(
  prompt: string,
  aliases: string[],
  defaultScope: GoogleAgendaScope = "both",
): string[] {
  if (refersToBothGoogleAccounts(prompt)) {
    const workAlias = resolveWorkGoogleAccountAlias(aliases);
    return [...new Set(["primary", workAlias].filter((value): value is string => Boolean(value)))];
  }

  const explicit = extractExplicitGoogleAccountAlias(prompt, aliases);
  if (explicit) {
    return [explicit];
  }

  if (defaultScope === "primary") {
    return aliases.includes("primary") ? ["primary"] : aliases.slice(0, 1);
  }
  if (defaultScope === "work") {
    const workAlias = resolveWorkGoogleAccountAlias(aliases);
    return workAlias ? [workAlias] : aliases.slice(0, 1);
  }

  return aliases;
}

export function resolveShortGoogleAccountReply(
  replyText: string,
  aliases: string[],
): GoogleAccountReplyResolution | null {
  const normalized = normalize(replyText);
  if (!normalized) {
    return null;
  }

  const shortEnough = normalized.length <= 80 && normalized.split(" ").length <= 8;
  const hasAccountCue = includesAny(normalized, ["agenda", "calendario", "conta", "primary", "principal", "pessoal", "abordagem", "trabalho", "ambos", "ambas"]);
  if (!shortEnough && !hasAccountCue) {
    return null;
  }

  if (refersToBothGoogleAccounts(normalized)) {
    const workAlias = resolveWorkGoogleAccountAlias(aliases);
    return {
      kind: "both",
      accounts: [...new Set(["primary", workAlias].filter((value): value is string => Boolean(value)))],
    };
  }

  const explicit = extractExplicitGoogleAccountAlias(normalized, aliases);
  return explicit ? { kind: "single", account: explicit } : null;
}
