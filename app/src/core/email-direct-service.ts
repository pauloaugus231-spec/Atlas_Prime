import type { AgentRunResult } from "./agent-core.js";
import type { Logger } from "../types/logger.js";
import type { ConversationMessage } from "../types/llm.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type { EmailOperationalGroup, EmailOperationalSummary } from "../integrations/email/email-analysis.js";
import type { EmailMessageSummary, EmailReader } from "../integrations/email/email-reader.js";

interface EmailLookupRequestLike {
  senderQuery?: string;
  category?: EmailOperationalGroup;
  unreadOnly: boolean;
  sinceHours: number;
  existenceOnly: boolean;
}

interface ResolvedEmailReferenceLike {
  message?: EmailMessageSummary;
  label: string;
  totalMatches: number;
  request: EmailLookupRequestLike;
}

interface CommunicationRoutingLike {
  relationship: string;
  persona: string;
  actionPolicy: string;
}

interface CommunicationRouterLike {
  classify(input: {
    channel: string;
    identifier: string | null | undefined;
    displayName?: string | null;
    subject?: string;
    text?: string;
  }): CommunicationRoutingLike;
}

interface EmailDirectHelpers {
  isEmailSummaryPrompt: (prompt: string) => boolean;
  extractEmailUidFromPrompt: (prompt: string) => string | undefined;
  summarizeEmailForOperations: (input: {
    subject: string;
    from: string[];
    text: string;
  }) => EmailOperationalSummary;
  extractEmailIdentifier: (from: string[]) => string | undefined;
  buildEmailSummaryReply: (input: {
    uid: string;
    subject: string;
    from: string[];
    summary: EmailOperationalSummary;
    routing?: {
      relationship: string;
      persona: string;
      policy: string;
    };
  }) => string;
  extractEmailLookupRequest: (prompt: string) => EmailLookupRequestLike | undefined;
  isEmailDraftPrompt: (prompt: string) => boolean;
  isInboxTriagePrompt: (prompt: string) => boolean;
  buildEmailLookupMissReply: (request: EmailLookupRequestLike) => string;
  buildEmailLookupReply: (input: {
    resolved: ResolvedEmailReferenceLike & { message: EmailMessageSummary };
    summary: EmailOperationalSummary;
  }) => string;
}

export interface EmailDirectServiceDependencies {
  logger: Logger;
  email: EmailReader;
  communicationRouter: CommunicationRouterLike;
  resolveEmailReferenceFromPrompt: (
    prompt: string,
    logger: Logger,
  ) => Promise<ResolvedEmailReferenceLike | null>;
  buildBaseMessages: (userPrompt: string, orchestration: OrchestrationContext) => ConversationMessage[];
  helpers: EmailDirectHelpers;
}

interface EmailDirectInput {
  userPrompt: string;
  requestId: string;
  requestLogger: Logger;
  orchestration: OrchestrationContext;
}

export class EmailDirectService {
  constructor(private readonly deps: EmailDirectServiceDependencies) {}

  async tryRunEmailSummary(input: EmailDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isEmailSummaryPrompt(input.userPrompt)) {
      return null;
    }

    const uid = this.deps.helpers.extractEmailUidFromPrompt(input.userPrompt);
    if (!uid) {
      return null;
    }

    const emailStatus = await this.deps.email.getStatus();
    if (!emailStatus.ready) {
      return {
        requestId: input.requestId,
        reply: `A integração de email não está pronta para leitura. ${emailStatus.message}`,
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
        toolExecutions: [],
      };
    }

    input.requestLogger.info("Using direct email summary route", {
      uid,
    });

    const emailMessage = await this.deps.email.readMessage(uid);
    const summary = this.deps.helpers.summarizeEmailForOperations({
      subject: emailMessage.subject,
      from: emailMessage.from,
      text: emailMessage.text,
    });
    const routing = this.deps.communicationRouter.classify({
      channel: "email",
      identifier: this.deps.helpers.extractEmailIdentifier(emailMessage.from),
      displayName: emailMessage.from.join(", "),
      subject: emailMessage.subject,
      text: emailMessage.text,
    });

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildEmailSummaryReply({
        uid: emailMessage.uid,
        subject: emailMessage.subject,
        from: emailMessage.from,
        summary,
        routing: {
          relationship: routing.relationship,
          persona: routing.persona,
          policy: routing.actionPolicy,
        },
      }),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
      toolExecutions: [
        {
          toolName: "read_email_message",
          resultPreview: JSON.stringify(
            {
              uid: emailMessage.uid,
              subject: emailMessage.subject,
              from: emailMessage.from,
            },
            null,
            2,
          ).slice(0, 240),
        },
      ],
    };
  }

  async tryRunEmailLookup(input: EmailDirectInput): Promise<AgentRunResult | null> {
    const lookupRequest = this.deps.helpers.extractEmailLookupRequest(input.userPrompt);
    if (!lookupRequest || this.deps.helpers.isEmailDraftPrompt(input.userPrompt) || this.deps.helpers.isInboxTriagePrompt(input.userPrompt)) {
      return null;
    }

    const emailStatus = await this.deps.email.getStatus();
    if (!emailStatus.ready) {
      return {
        requestId: input.requestId,
        reply: `A integração de email não está pronta para leitura. ${emailStatus.message}`,
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
        toolExecutions: [],
      };
    }

    input.requestLogger.info("Using direct email lookup route", {
      senderQuery: lookupRequest.senderQuery,
      category: lookupRequest.category,
      unreadOnly: lookupRequest.unreadOnly,
      sinceHours: lookupRequest.sinceHours,
    });

    const resolved = await this.deps.resolveEmailReferenceFromPrompt(input.userPrompt, input.requestLogger);
    if (!resolved) {
      return null;
    }

    if (!resolved.message) {
      return {
        requestId: input.requestId,
        reply: this.deps.helpers.buildEmailLookupMissReply(resolved.request),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
        toolExecutions: [
          {
            toolName: "list_recent_emails",
            resultPreview: JSON.stringify(
              {
                totalMatches: 0,
                label: resolved.label,
                sinceHours: resolved.request.sinceHours,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    const summary = this.deps.helpers.summarizeEmailForOperations({
      subject: resolved.message.subject,
      from: resolved.message.from,
      text: resolved.message.preview,
    });

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildEmailLookupReply({
        resolved: resolved as ResolvedEmailReferenceLike & { message: EmailMessageSummary },
        summary,
      }),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
      toolExecutions: [
        {
          toolName: "list_recent_emails",
          resultPreview: JSON.stringify(
            {
              totalMatches: resolved.totalMatches,
              label: resolved.label,
              match: {
                uid: resolved.message.uid,
                subject: resolved.message.subject,
                from: resolved.message.from,
              },
            },
            null,
            2,
          ).slice(0, 240),
        },
      ],
    };
  }
}
