export interface TimeOsOverview {
  generatedAt: string;
  nextEvent?: string;
  agendaCount: number;
  conflictCount: number;
  overdueTasks: number;
  todayTasks: number;
  mobilityAlerts: string[];
  nextAction?: string;
  overloadLevel: "leve" | "moderado" | "pesado";
}
