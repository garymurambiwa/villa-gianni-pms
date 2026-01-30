export interface BudgetMonth {
  month: string; // YYYY-MM
  revenue: number;
  costCenters: Record<string, number>; // e.g., Rooms, F&B, Administration, Sales & Marketing
}

const BUDGET_KEY = 'corepms_budgets';
const readJSON = <T>(k:string,f:T):T=>{ try{ const r=localStorage.getItem(k); return r? JSON.parse(r) as T : f; }catch{ return f; } };
const writeJSON = (k:string,v:any)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} };

export const listBudgets = (): BudgetMonth[] => readJSON<BudgetMonth[]>(BUDGET_KEY, []);
export const getBudget = (month: string): BudgetMonth | undefined => listBudgets().find(b=> b.month === month);
export const setBudget = (b: BudgetMonth) => {
  const rows = listBudgets();
  const idx = rows.findIndex(x=> x.month === b.month);
  if (idx === -1) rows.push(b); else rows[idx] = b;
  writeJSON(BUDGET_KEY, rows);
};

export const sumYtdBudget = (year: string, upToMonthInclusive: number): { revenue: number; costCenters: Record<string, number> } => {
  const rows = listBudgets().filter(b=> b.month.startsWith(`${year}-`));
  const months = rows.filter(b=> Number(b.month.split('-')[1]) <= upToMonthInclusive);
  const revenue = months.reduce((s,b)=> s + (b.revenue||0), 0);
  const cc: Record<string, number> = {};
  months.forEach(b=> { Object.entries(b.costCenters||{}).forEach(([k,v])=> { cc[k] = (cc[k]||0) + (v||0); }); });
  return { revenue, costCenters: cc };
};

export default { listBudgets, getBudget, setBudget, sumYtdBudget };

