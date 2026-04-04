import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import type { Logger } from "../types/logger.js";
import type { LlmToolDefinition } from "../types/llm.js";
import type { LoadedToolPlugin, ToolExecutionContext, ToolPluginResult } from "../types/plugin.js";

const DEFAULT_PARAMETERS_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) {
    return "Unknown validation error";
  }

  return errors
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`.trim())
    .join("; ");
}

function coerceToolArguments(argumentsValue: unknown): Record<string, unknown> {
  if (argumentsValue == null) {
    return {};
  }

  if (typeof argumentsValue === "string") {
    const parsed = JSON.parse(argumentsValue) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Tool arguments must decode into an object");
    }
    return parsed as Record<string, unknown>;
  }

  if (typeof argumentsValue !== "object" || Array.isArray(argumentsValue)) {
    throw new Error("Tool arguments must be an object");
  }

  return argumentsValue as Record<string, unknown>;
}

function formatToolResult(result: ToolPluginResult): string {
  if (typeof result === "string") {
    return result;
  }

  if (result === undefined) {
    return JSON.stringify({ ok: true }, null, 2);
  }

  return JSON.stringify(result, null, 2);
}

export class ToolPluginRegistry {
  private readonly pluginsByName = new Map<string, LoadedToolPlugin>();
  private readonly validators = new Map<string, ValidateFunction<Record<string, unknown>>>();

  constructor(
    plugins: LoadedToolPlugin[],
    private readonly logger: Logger,
  ) {
    const ajv = new Ajv({ allErrors: true, strict: false });

    for (const loadedPlugin of plugins) {
      this.pluginsByName.set(loadedPlugin.plugin.name, loadedPlugin);
      const schema = loadedPlugin.plugin.parameters ?? DEFAULT_PARAMETERS_SCHEMA;
      this.validators.set(
        loadedPlugin.plugin.name,
        ajv.compile<Record<string, unknown>>(schema),
      );
    }
  }

  listPlugins(): LoadedToolPlugin[] {
    return [...this.pluginsByName.values()];
  }

  listToolsForModel(): LlmToolDefinition[] {
    return this.listPlugins()
      .filter(({ plugin }) => plugin.exposeToModel !== false)
      .map(({ plugin }) => ({
        type: "function",
        function: {
          name: plugin.name,
          description: plugin.description,
          parameters: plugin.parameters ?? DEFAULT_PARAMETERS_SCHEMA,
        },
      }));
  }

  hasTool(toolName: string): boolean {
    return this.pluginsByName.has(toolName);
  }

  async execute(
    toolName: string,
    rawArguments: unknown,
    context: ToolExecutionContext,
  ): Promise<{ content: string; rawResult: ToolPluginResult }> {
    const loadedPlugin = this.pluginsByName.get(toolName);
    if (!loadedPlugin) {
      throw new Error(`Unknown tool requested: ${toolName}`);
    }

    const validator = this.validators.get(toolName);
    if (!validator) {
      throw new Error(`No validator registered for tool: ${toolName}`);
    }

    const parameters = coerceToolArguments(rawArguments);
    const valid = validator(parameters);
    if (!valid) {
      throw new Error(`Invalid arguments for ${toolName}: ${formatAjvErrors(validator.errors)}`);
    }

    this.logger.info("Executing tool", {
      tool: toolName,
      source: loadedPlugin.sourcePath,
      requestId: context.requestId,
    });

    const rawResult = await loadedPlugin.plugin.execute(parameters, context);
    return {
      content: formatToolResult(rawResult),
      rawResult,
    };
  }
}
