import type { Logger } from "../../types/logger.js";
import type { FinanceEntry } from "../../types/finance-entry.js";
import type { FinanceGoal } from "../../types/finance-goal.js";
import { FinanceStore } from "./finance-store.js";

function formatMoney(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function currentMonthReference(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export class FinanceReviewService {
  constructor(
    private readonly store: FinanceStore,
    private readonly logger: Logger,
  ) {}

  summarize(now = new Date()): {
    overdue: FinanceEntry[];
    dueSoon: FinanceEntry[];
    expensesMonth: number;
    incomeMonth: number;
    goals: FinanceGoal[];
  } {
    const entries = this.store.listEntries({ limit: 200 });
    const nowMs = now.getTime();
    const monthKey = currentMonthReference(now);
    const overdue = entries.filter((item) => item.dueAt && item.status !== "paid" && Date.parse(item.dueAt) < nowMs);
    const dueSoon = entries.filter((item) => item.dueAt && item.status !== "paid" && Date.parse(item.dueAt) >= nowMs).slice(0, 5);
    const expensesMonth = entries
      .filter((item) => item.kind !== "income" && item.createdAt.startsWith(monthKey))
      .reduce((sum, item) => sum + item.amount, 0);
    const incomeMonth = entries
      .filter((item) => item.kind === "income" && item.createdAt.startsWith(monthKey))
      .reduce((sum, item) => sum + item.amount, 0);
    const goals = this.store.listGoals(monthKey);
    const summary = { overdue, dueSoon, expensesMonth, incomeMonth, goals };
    this.logger.debug("Built finance summary", { overdue: overdue.length, dueSoon: dueSoon.length, goals: goals.length });
    return summary;
  }

  renderOverview(now = new Date()): string {
    const summary = this.summarize(now);
    return [
      "Finanças:",
      `- Despesas no mês: ${formatMoney(summary.expensesMonth)}`,
      `- Entradas no mês: ${formatMoney(summary.incomeMonth)}`,
      `- Vencidas: ${summary.overdue.length}`,
      `- Próximos vencimentos: ${summary.dueSoon.length}`,
      ...(summary.overdue.slice(0, 3).map((item) => `- Em atraso: ${item.title} | ${formatMoney(item.amount)}`)),
      ...(summary.dueSoon.slice(0, 3).map((item) => `- A vencer: ${item.title} | ${formatMoney(item.amount)}`)),
      ...(summary.goals.slice(0, 2).map((goal) => `- Meta financeira: ${goal.title} | ${formatMoney(goal.targetAmount)}`)),
    ].join("\n");
  }
}
