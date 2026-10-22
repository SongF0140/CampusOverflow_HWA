export class RepairBudgetError extends Error {
  constructor() { super("self-check failed: 本次运行的返工次数已耗尽"); this.name = "RepairBudgetError"; }
}

export const createRepairBudget = () => {
  let used = 0;
  return Object.freeze({
    get used() { return used; },
    consume: () => { if (used >= 1) throw new RepairBudgetError(); used += 1; },
  });
};
export type RepairBudget = ReturnType<typeof createRepairBudget>;
