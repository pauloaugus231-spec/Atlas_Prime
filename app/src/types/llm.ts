import type { JsonSchema } from "./json-schema.js";

export type ConversationRole = "system" | "user" | "assistant" | "tool";

export interface LlmToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
}

export interface LlmToolCall {
  id?: string;
  type?: "function";
  function: {
    name: string;
    arguments: unknown;
  };
}

export interface ConversationMessage {
  role: ConversationRole;
  content: string;
  tool_name?: string;
  tool_calls?: LlmToolCall[];
  tool_call_id?: string;
}

export interface LlmChatResponse {
  model: string;
  created_at?: string;
  done: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  message: {
    role: "assistant";
    content: string;
    tool_calls?: LlmToolCall[];
  };
}

export interface LlmClient {
  listModels(): Promise<string[]>;
  chat(input: {
    messages: ConversationMessage[];
    tools?: LlmToolDefinition[];
  }): Promise<LlmChatResponse>;
}
