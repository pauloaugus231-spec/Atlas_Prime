import type { WhatsAppConfig } from "../types/config.js";

function normalizeToken(value: string | undefined | null): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeText(value: string | undefined | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePhone(value: string | undefined | null): string {
  return (value ?? "").replace(/\D+/g, "");
}

export function detectWhatsAppAccountAliasFromText(text: string | undefined): string | undefined {
  const normalized = normalizeText(text);
  if (!normalized) {
    return undefined;
  }

  if (
    normalized.includes("abordagem") ||
    normalized.includes("social") ||
    normalized.includes("creas") ||
    normalized.includes("caps") ||
    normalized.includes("acolhida") ||
    normalized.includes("espaco de cuidados") ||
    normalized.includes("banho")
  ) {
    return "abordagem";
  }

  if (
    normalized.includes("primary") ||
    normalized.includes("principal") ||
    normalized.includes("pessoal") ||
    normalized.includes("profissional")
  ) {
    return "primary";
  }

  return undefined;
}

export function resolveWhatsAppAccountAlias(
  config: WhatsAppConfig,
  options: {
    instanceName?: string;
    accountAlias?: string;
    text?: string;
    fallback?: string;
  } = {},
): string {
  const explicitAccount = normalizeToken(options.accountAlias) || "";
  if (explicitAccount) {
    return explicitAccount;
  }

  const instanceName = options.instanceName?.trim();
  if (instanceName) {
    const mappedAccount = config.instanceAccounts[instanceName];
    const normalizedMappedAccount = normalizeToken(mappedAccount);
    if (normalizedMappedAccount) {
      return normalizedMappedAccount;
    }
  }

  const hintedAccount = normalizeToken(detectWhatsAppAccountAliasFromText(options.text));
  if (hintedAccount) {
    return hintedAccount;
  }

  return normalizeToken(config.defaultAccountAlias) || normalizeToken(options.fallback) || "primary";
}

export function resolveWhatsAppInstanceName(
  config: WhatsAppConfig,
  options: {
    instanceName?: string;
    accountAlias?: string;
    text?: string;
  } = {},
): string | undefined {
  const explicitInstance = options.instanceName?.trim();
  if (explicitInstance) {
    return explicitInstance;
  }

  const targetAccount = resolveWhatsAppAccountAlias(config, {
    accountAlias: options.accountAlias,
    text: options.text,
  });

  const defaultInstance = config.defaultInstanceName?.trim();
  if (defaultInstance && normalizeToken(config.instanceAccounts[defaultInstance]) === targetAccount) {
    return defaultInstance;
  }

  for (const [instanceName, mappedAccount] of Object.entries(config.instanceAccounts)) {
    if (normalizeToken(mappedAccount) === targetAccount) {
      return instanceName;
    }
  }

  return defaultInstance;
}

export function describeWhatsAppRoute(config: WhatsAppConfig, options: {
  instanceName?: string;
  accountAlias?: string;
  text?: string;
} = {}): { accountAlias: string; instanceName?: string } {
  const accountAlias = resolveWhatsAppAccountAlias(config, options);
  const instanceName = resolveWhatsAppInstanceName(config, {
    instanceName: options.instanceName,
    accountAlias,
    text: options.text,
  });

  return {
    accountAlias,
    instanceName,
  };
}

export function isAllowedWhatsAppOperatorNumber(config: WhatsAppConfig, number: string | undefined): boolean {
  const normalizedNumber = normalizePhone(number);
  const allowedNumbers = config.allowedNumbers.map(normalizePhone).filter(Boolean);
  if (!normalizedNumber) {
    return false;
  }
  if (allowedNumbers.length === 0) {
    return true;
  }
  return allowedNumbers.includes(normalizedNumber);
}

export function resolveWhatsAppInboundMode(
  config: WhatsAppConfig,
  options: {
    number?: string;
  } = {},
): "conversation" | "monitor" | "ignore" {
  if (!config.conversationEnabled) {
    return "monitor";
  }

  if (isAllowedWhatsAppOperatorNumber(config, options.number)) {
    return "conversation";
  }

  return config.unauthorizedMode;
}
