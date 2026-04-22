export interface FinanceGoal {
  id: number;
  title: string;
  targetAmount: number;
  referenceMonth: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFinanceGoalInput {
  title: string;
  targetAmount: number;
  referenceMonth: string;
  notes?: string;
}
