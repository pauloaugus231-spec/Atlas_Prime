export interface ChannelConversationTurn {
  role: "user" | "assistant";
  text: string;
}

export interface ChannelOperationalModeContext {
  kind: string;
  reason: string;
}

export function buildTelegramChannelPrompt(input: {
  chatType: string;
  chatId: number;
  userId?: number | string;
  text: string;
  history: ChannelConversationTurn[];
  operationalMode?: ChannelOperationalModeContext | null;
}): string {
  const promptLines = [
    "Contexto do Telegram:",
    `chat_type=${input.chatType}`,
    `chat_id=${input.chatId}`,
    `user_id=${input.userId ?? "unknown"}`,
    "",
  ];

  if (input.history.length > 0) {
    promptLines.push("Histórico recente do chat:");
    for (const turn of input.history) {
      promptLines.push(`${turn.role === "user" ? "Usuário" : "Assistente"}: ${turn.text}`);
    }
    promptLines.push("");
  }

  if (input.operationalMode) {
    promptLines.push("Modo operacional ativo:");
    promptLines.push(`modo_operacional=${input.operationalMode.kind}`);
    promptLines.push(`motivo=${input.operationalMode.reason}`);
    promptLines.push("");
  }

  promptLines.push("Mensagem atual do usuário:");
  promptLines.push(input.text);
  return promptLines.join("\n");
}

export function buildWhatsAppChannelPrompt(input: {
  chatId: string;
  remoteJid: string;
  number: string;
  pushName?: string;
  text: string;
  history: ChannelConversationTurn[];
}): string {
  const lines = [
    "Contexto do WhatsApp:",
    "canal=whatsapp",
    "chat_type=private",
    `chat_id=${input.chatId}`,
    `remote_jid=${input.remoteJid}`,
    `number=${input.number}`,
    input.pushName ? `push_name=${input.pushName}` : undefined,
    "responda de forma curta, natural e operacional para WhatsApp",
    "",
  ].filter(Boolean) as string[];

  if (input.history.length > 0) {
    lines.push("Histórico recente do chat:");
    for (const turn of input.history) {
      lines.push(`${turn.role === "user" ? "Usuário" : "Assistente"}: ${turn.text}`);
    }
    lines.push("");
  }

  lines.push("Mensagem atual do usuário:");
  lines.push(input.text);
  return lines.join("\n");
}

export function buildCliChannelPrompt(input: {
  text: string;
  history?: ChannelConversationTurn[];
}): string {
  const lines = [
    "Contexto do operador:",
    "canal=cli",
    "",
  ];

  if (input.history && input.history.length > 0) {
    lines.push("Histórico recente do chat:");
    for (const turn of input.history) {
      lines.push(`${turn.role === "user" ? "Usuário" : "Assistente"}: ${turn.text}`);
    }
    lines.push("");
  }

  lines.push("Mensagem atual do usuário:");
  lines.push(input.text);
  return lines.join("\n");
}
