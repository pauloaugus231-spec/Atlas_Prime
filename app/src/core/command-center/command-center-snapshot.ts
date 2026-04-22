import type { ApprovalInboxStore } from "../approval-inbox.js";
import type { SuggestionStore } from "../autonomy/suggestion-store.js";
import type { CommitmentStore } from "../autonomy/commitment-store.js";
import type { GrowthOpsStore } from "../growth-ops.js";
import type { PersonalOperationalMemoryStore } from "../personal-operational-memory.js";
import type { PersonalOSService } from "../personal-os.js";
import type { GoogleWorkspaceService } from "../../integrations/google/google-workspace.js";
import type { EmailReader } from "../../integrations/email/email-reader.js";
import type { WhatsAppConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";
import type { CommandCenterSnapshot } from "./command-center-types.js";
import { CommandCenterHealth } from "./command-center-health.js";

export interface CommandCenterSnapshotDependencies {
  logger: Logger;
  approvals: ApprovalInboxStore;
  suggestions: SuggestionStore;
  commitments: CommitmentStore;
  growthOps: GrowthOpsStore;
  personalMemory: PersonalOperationalMemoryStore;
  personalOs: PersonalOSService;
  googleWorkspace: GoogleWorkspaceService;
  email: EmailReader;
  whatsappConfig: WhatsAppConfig;
}

export class CommandCenterSnapshotBuilder {
  private readonly health = new CommandCenterHealth();

  constructor(private readonly deps: CommandCenterSnapshotDependencies) {}

  async build(): Promise<CommandCenterSnapshot> {
    const [brief, emailStatus] = await Promise.all([
      this.deps.personalOs.getExecutiveMorningBrief(),
      this.deps.email.getStatus().catch(() => ({ ready: false, message: "Email indisponível." })),
    ]);
    const state = this.deps.personalMemory.getOperationalState();
    const scoreboard = this.deps.growthOps.getMonthlyScoreboard();
    const suggestions = this.deps.suggestions.listByStatus(["queued", "notified"], 20);
    const commitments = this.deps.commitments.listByStatus(["candidate", "confirmed", "converted_to_task"], 20);

    return {
      generatedAt: new Date().toISOString(),
      operatorMode: state.mode,
      currentFocus: state.focus,
      topRisk: state.primaryRisk ?? brief.dayRecommendation ?? undefined,
      nextBestAction: brief.nextAction ?? state.briefing.nextAction ?? undefined,
      agenda: {
        todayCount: brief.events.length,
        conflicts: brief.events.filter((item) => item.hasConflict).length,
        nextEvent: brief.events[0]?.summary,
      },
      inboxes: {
        proactiveSuggestions: suggestions.length,
        approvalsPending: this.deps.approvals.listPendingAll(20).length,
        commitmentsPending: commitments.length,
        importantMessages: brief.emails.filter((item) => ["alta", "urgente", "urgent"].includes(item.priority.toLowerCase())).length,
      },
      revenue: {
        openPipeline: scoreboard.pipelineOpenValue,
        projectedThisMonth: scoreboard.totalProjected,
        receivedThisMonth: scoreboard.totalReceived,
        staleLeads: this.deps.growthOps.listLeads({ limit: 100 }).filter((lead) => lead.status === "dormant").length,
      },
      system: {
        integrations: this.health.summarizeIntegrations({
          googleReady: this.deps.googleWorkspace.getStatus().ready,
          emailReady: Boolean(emailStatus.ready),
          whatsappEnabled: this.deps.whatsappConfig.enabled,
        }),
        lastAutonomyRunAt: state.updatedAt,
        recentErrors: [],
      },
    };
  }
}
