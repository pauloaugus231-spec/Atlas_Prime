import type { LogLevel, Logger } from "../types/logger.js";

const PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function serializeContext(context?: Record<string, unknown>): string {
  if (!context || Object.keys(context).length === 0) {
    return "";
  }
  return ` ${JSON.stringify(context)}`;
}

class ConsoleLogger implements Logger {
  constructor(
    private readonly level: LogLevel,
    private readonly bindings: Record<string, unknown> = {},
  ) {}

  debug(message: string, context?: Record<string, unknown>): void {
    this.write("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.write("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.write("warn", message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.write("error", message, context);
  }

  child(bindings: Record<string, unknown>): Logger {
    return new ConsoleLogger(this.level, {
      ...this.bindings,
      ...bindings,
    });
  }

  private write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (PRIORITY[level] < PRIORITY[this.level]) {
      return;
    }

    const payload = {
      ...this.bindings,
      ...context,
    };

    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${serializeContext(payload)}`;

    if (level === "error") {
      console.error(line);
      return;
    }

    if (level === "warn") {
      console.warn(line);
      return;
    }

    console.log(line);
  }
}

export function createLogger(level: LogLevel): Logger {
  return new ConsoleLogger(level);
}
