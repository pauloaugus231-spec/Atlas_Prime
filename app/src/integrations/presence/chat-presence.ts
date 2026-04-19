import type { PresenceConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";

export type PresenceStopReason = "completed" | "error" | "cancelled" | "replaced" | "timeout";

export interface PresenceSession {
  start(): void;
  stop(reason?: PresenceStopReason): Promise<void>;
}

interface ChatPresenceSessionOptions {
  channel: string;
  flow?: string;
  logger?: Logger;
  config: PresenceConfig;
  progressText?: string;
  timeoutText?: string;
  sendPresence: () => Promise<void>;
  sendProgress?: (text: string) => Promise<void>;
}

export class ChatPresenceSession implements PresenceSession {
  private readonly channel: string;
  private readonly flow?: string;
  private readonly logger?: Logger;
  private readonly config: PresenceConfig;
  private readonly progressText?: string;
  private readonly timeoutText?: string;
  private readonly sendPresenceFn: () => Promise<void>;
  private readonly sendProgressFn?: (text: string) => Promise<void>;
  private active = false;
  private presenceStarted = false;
  private progressSent = false;
  private timeoutReached = false;
  private startTimer?: NodeJS.Timeout;
  private refreshTimer?: NodeJS.Timeout;
  private progressTimer?: NodeJS.Timeout;
  private timeoutTimer?: NodeJS.Timeout;

  constructor(options: ChatPresenceSessionOptions) {
    this.channel = options.channel;
    this.flow = options.flow;
    this.logger = options.logger;
    this.config = options.config;
    this.progressText = options.progressText;
    this.timeoutText = options.timeoutText;
    this.sendPresenceFn = options.sendPresence;
    this.sendProgressFn = options.sendProgress;
  }

  start(): void {
    if (this.active || !this.config.enabled) {
      return;
    }

    this.active = true;
    this.startTimer = setTimeout(() => {
      void this.startPresence();
    }, this.config.startDelayMs);

    if (this.progressText && this.sendProgressFn) {
      this.progressTimer = setTimeout(() => {
        void this.sendStatusMessage(this.progressText as string, "progress");
      }, this.config.progressDelayMs);
    }

    this.timeoutTimer = setTimeout(() => {
      void this.handleTimeout();
    }, this.config.maxDurationMs);
  }

  async stop(reason: PresenceStopReason = "completed"): Promise<void> {
    const shouldLog = this.presenceStarted || this.progressSent || this.timeoutReached;
    this.active = false;
    this.clearTimers();

    if (shouldLog) {
      this.logger?.debug("Chat presence stopped", {
        channel: this.channel,
        flow: this.flow,
        reason,
        presenceStarted: this.presenceStarted,
        progressSent: this.progressSent,
        timeoutReached: this.timeoutReached,
      });
    }
  }

  private clearTimers(): void {
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = undefined;
    }
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    if (this.progressTimer) {
      clearTimeout(this.progressTimer);
      this.progressTimer = undefined;
    }
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = undefined;
    }
  }

  private async startPresence(): Promise<void> {
    if (!this.active || this.presenceStarted || this.timeoutReached) {
      return;
    }

    this.presenceStarted = true;
    this.logger?.debug("Chat presence started", {
      channel: this.channel,
      flow: this.flow,
      refreshIntervalMs: this.config.refreshIntervalMs,
    });
    await this.safePresence();
    this.refreshTimer = setInterval(() => {
      void this.safePresence();
    }, this.config.refreshIntervalMs);
  }

  private async safePresence(): Promise<void> {
    if (!this.active || this.timeoutReached) {
      return;
    }

    try {
      await this.sendPresenceFn();
    } catch (error) {
      this.logger?.warn("Chat presence refresh failed", {
        channel: this.channel,
        flow: this.flow,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async sendStatusMessage(text: string, kind: "progress" | "timeout"): Promise<void> {
    if (!this.active) {
      return;
    }
    if (kind === "progress" && (this.progressSent || this.timeoutReached || !this.sendProgressFn)) {
      return;
    }
    if (kind === "timeout" && !this.sendProgressFn) {
      return;
    }

    if (kind === "progress") {
      this.progressSent = true;
    }

    try {
      await this.sendProgressFn?.(text);
      this.logger?.debug("Chat presence progress sent", {
        channel: this.channel,
        flow: this.flow,
        kind,
      });
    } catch (error) {
      this.logger?.warn("Chat presence progress failed", {
        channel: this.channel,
        flow: this.flow,
        kind,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleTimeout(): Promise<void> {
    if (!this.active || this.timeoutReached) {
      return;
    }

    this.logger?.warn("Chat presence reached max duration", {
      channel: this.channel,
      flow: this.flow,
      maxDurationMs: this.config.maxDurationMs,
    });

    this.timeoutReached = true;
    if (this.timeoutText) {
      await this.sendStatusMessage(this.timeoutText, "timeout");
    }

    await this.stop("timeout");
  }
}
