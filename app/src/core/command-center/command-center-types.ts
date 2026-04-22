export interface CommandCenterSnapshot {
  generatedAt: string;
  operatorMode: string;
  currentFocus: string[];
  topRisk?: string;
  nextBestAction?: string;
  agenda: {
    todayCount: number;
    conflicts: number;
    nextEvent?: string;
  };
  inboxes: {
    proactiveSuggestions: number;
    approvalsPending: number;
    commitmentsPending: number;
    importantMessages: number;
  };
  revenue: {
    openPipeline: number;
    projectedThisMonth: number;
    receivedThisMonth: number;
    staleLeads: number;
  };
  system: {
    integrations: Record<string, "ok" | "disabled" | "error">;
    lastAutonomyRunAt?: string;
    recentErrors: string[];
  };
}
