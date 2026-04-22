import type { Logger } from "../types/logger.js";
import type { TimeOsOverview } from "../types/time-os.js";
import type { ExecutiveMorningBrief } from "./personal-os.js";

interface PersonalOsLike {
  getExecutiveMorningBrief(): Promise<ExecutiveMorningBrief>;
}

export class TimeOsService {
  constructor(
    private readonly personalOs: PersonalOsLike,
    private readonly logger: Logger,
  ) {}

  async getOverview(): Promise<TimeOsOverview> {
    const brief = await this.personalOs.getExecutiveMorningBrief();
    const overview: TimeOsOverview = {
      generatedAt: new Date().toISOString(),
      nextEvent: brief.events[0]?.summary,
      agendaCount: brief.events.length,
      conflictCount: brief.conflictSummary.overlaps + brief.events.filter((item) => item.hasConflict).length,
      overdueTasks: brief.taskBuckets.overdue.length,
      todayTasks: brief.taskBuckets.today.length,
      mobilityAlerts: brief.mobilityAlerts.slice(0, 3),
      nextAction: brief.nextAction,
      overloadLevel: brief.overloadLevel,
    };
    this.logger.debug("Built time OS overview", {
      generatedAt: overview.generatedAt,
      nextEvent: overview.nextEvent,
      agendaCount: overview.agendaCount,
      conflictCount: overview.conflictCount,
      overdueTasks: overview.overdueTasks,
      todayTasks: overview.todayTasks,
      overloadLevel: overview.overloadLevel,
    });
    return overview;
  }

  async renderOverview(): Promise<string> {
    const overview = await this.getOverview();
    return [
      "Tempo e agenda:",
      `- Compromissos hoje: ${overview.agendaCount}`,
      `- Próximo compromisso: ${overview.nextEvent ?? "nenhum compromisso imediato"}`,
      `- Conflitos: ${overview.conflictCount}`,
      `- Tarefas vencidas: ${overview.overdueTasks}`,
      `- Tarefas de hoje: ${overview.todayTasks}`,
      `- Carga do dia: ${overview.overloadLevel}`,
      ...(overview.mobilityAlerts.length > 0 ? overview.mobilityAlerts.map((item) => `- Mobilidade: ${item}`) : []),
      `- Próxima ação recomendada: ${overview.nextAction ?? "sem próxima ação definida"}`,
    ].join("\n");
  }
}
