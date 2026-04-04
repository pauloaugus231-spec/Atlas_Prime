export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
}

export interface TelegramMessageEntity {
  offset: number;
  length: number;
  type: string;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  entities?: TelegramMessageEntity[];
  caption_entities?: TelegramMessageEntity[];
  reply_to_message?: {
    message_id: number;
    from?: TelegramUser;
  };
  document?: {
    file_id: string;
    file_name?: string;
    mime_type?: string;
  };
  voice?: {
    file_id: string;
    duration?: number;
    mime_type?: string;
    file_size?: number;
  };
  audio?: {
    file_id: string;
    duration?: number;
    mime_type?: string;
    file_name?: string;
    title?: string;
    performer?: string;
    file_size?: number;
  };
  photo?: Array<{
    file_id: string;
    width: number;
    height: number;
  }>;
}

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  data?: string;
  message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramApiResponse<TResult> {
  ok: boolean;
  result: TResult;
  description?: string;
}

export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}
