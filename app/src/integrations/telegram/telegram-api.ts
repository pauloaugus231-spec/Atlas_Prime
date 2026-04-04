import type {
  TelegramApiResponse,
  TelegramFile,
  TelegramInlineKeyboardMarkup,
  TelegramUpdate,
  TelegramUser,
} from "./types.js";

interface TelegramSendMessageOptions {
  reply_to_message_id?: number;
  disable_web_page_preview?: boolean;
  reply_markup?: TelegramInlineKeyboardMarkup;
}

interface TelegramGetUpdatesOptions {
  offset?: number;
  timeout?: number;
  allowed_updates?: string[];
}

export class TelegramApi {
  private readonly baseUrl: string;

  constructor(private readonly token: string) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async getMe(): Promise<TelegramUser> {
    return this.request<TelegramUser>("getMe", {});
  }

  async deleteWebhook(dropPendingUpdates = false): Promise<boolean> {
    return this.request<boolean>("deleteWebhook", {
      drop_pending_updates: dropPendingUpdates,
    });
  }

  async getUpdates(options: TelegramGetUpdatesOptions): Promise<TelegramUpdate[]> {
    return this.request<TelegramUpdate[]>("getUpdates", { ...options }, {
      timeoutMs: ((options.timeout ?? 30) + 10) * 1000,
    });
  }

  async sendMessage(
    chatId: number,
    text: string,
    options: TelegramSendMessageOptions = {},
  ): Promise<void> {
    await this.request("sendMessage", {
      chat_id: chatId,
      text,
      ...options,
    });
  }

  async answerCallbackQuery(
    callbackQueryId: string,
    options: {
      text?: string;
      show_alert?: boolean;
    } = {},
  ): Promise<void> {
    await this.request("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      ...options,
    });
  }

  async getFile(fileId: string): Promise<TelegramFile> {
    return this.request<TelegramFile>("getFile", {
      file_id: fileId,
    });
  }

  async downloadFile(filePath: string): Promise<Buffer> {
    const response = await fetch(`https://api.telegram.org/file/bot${this.token}/${filePath}`, {
      method: "GET",
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      throw new Error(`Telegram file download failed (${response.status}): ${details || response.statusText}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  private async request<TResult>(
    method: string,
    payload: Record<string, unknown>,
    options: { timeoutMs?: number } = {},
  ): Promise<TResult> {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(options.timeoutMs ?? 10000),
    });

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      throw new Error(`Telegram API request failed (${response.status}): ${details || response.statusText}`);
    }

    const data = (await response.json()) as TelegramApiResponse<TResult>;
    if (!data.ok) {
      throw new Error(`Telegram API error: ${data.description ?? "unknown error"}`);
    }

    return data.result;
  }
}
