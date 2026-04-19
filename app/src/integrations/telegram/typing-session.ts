interface TelegramTypingSessionOptions {
  startDelayMs?: number;
  heartbeatMs?: number;
  progressDelayMs?: number;
  fallbackDelayMs?: number;
  progressText?: string;
  fallbackText?: string;
  sendTyping: () => Promise<void>;
  sendProgress: (text: string) => Promise<void>;
}

export class TelegramTypingSession {
  private readonly startDelayMs: number;
  private readonly heartbeatMs: number;
  private readonly progressDelayMs: number;
  private readonly fallbackDelayMs: number;
  private readonly progressText?: string;
  private readonly fallbackText?: string;
  private readonly sendTypingFn: () => Promise<void>;
  private readonly sendProgressFn: (text: string) => Promise<void>;
  private active = false;
  private typingStarted = false;
  private progressSent = false;
  private fallbackSent = false;
  private startTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private progressTimer?: NodeJS.Timeout;
  private fallbackTimer?: NodeJS.Timeout;

  constructor(options: TelegramTypingSessionOptions) {
    this.startDelayMs = options.startDelayMs ?? 1200;
    this.heartbeatMs = options.heartbeatMs ?? 4000;
    this.progressDelayMs = options.progressDelayMs ?? 8000;
    this.fallbackDelayMs = options.fallbackDelayMs ?? 25000;
    this.progressText = options.progressText;
    this.fallbackText = options.fallbackText;
    this.sendTypingFn = options.sendTyping;
    this.sendProgressFn = options.sendProgress;
  }

  start(): void {
    if (this.active) {
      return;
    }
    this.active = true;
    this.startTimer = setTimeout(() => {
      void this.startTyping();
    }, this.startDelayMs);

    if (this.progressText) {
      this.progressTimer = setTimeout(() => {
        void this.sendProgressMessage(this.progressText as string, "progress");
      }, this.progressDelayMs);
    }

    if (this.fallbackText) {
      this.fallbackTimer = setTimeout(() => {
        void this.sendProgressMessage(this.fallbackText as string, "fallback");
      }, this.fallbackDelayMs);
    }
  }

  async stop(): Promise<void> {
    this.active = false;
    this.clearTimers();
  }

  private clearTimers(): void {
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = undefined;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    if (this.progressTimer) {
      clearTimeout(this.progressTimer);
      this.progressTimer = undefined;
    }
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = undefined;
    }
  }

  private async startTyping(): Promise<void> {
    if (!this.active || this.typingStarted || this.fallbackSent) {
      return;
    }
    this.typingStarted = true;
    await this.safeTyping();
    this.heartbeatTimer = setInterval(() => {
      void this.safeTyping();
    }, this.heartbeatMs);
  }

  private async safeTyping(): Promise<void> {
    if (!this.active || this.fallbackSent) {
      return;
    }
    try {
      await this.sendTypingFn();
    } catch {
      // Ignore transient Telegram typing failures.
    }
  }

  private async sendProgressMessage(text: string, kind: "progress" | "fallback"): Promise<void> {
    if (!this.active) {
      return;
    }
    if (kind === "progress" && (this.progressSent || this.fallbackSent)) {
      return;
    }
    if (kind === "fallback" && this.fallbackSent) {
      return;
    }

    if (kind === "fallback") {
      this.fallbackSent = true;
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = undefined;
      }
    } else {
      this.progressSent = true;
    }

    try {
      await this.sendProgressFn(text);
    } catch {
      // Ignore transient Telegram progress message failures.
    }
  }
}
