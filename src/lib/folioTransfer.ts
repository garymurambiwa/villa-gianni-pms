import { Folio, Transaction } from "@/types/folio";

// Filters transactions to only transferable charges: non-voided, type 'charge', positive amount
export const filterTransferable = (transactions: Transaction[]): Transaction[] =>
  transactions.filter((t) => !t.voidedBy && t.type === "charge" && Number(t.amount) > 0);

// Computes updated folios for a folio-to-folio transfer (without mutating inputs)
export const computeFolioToFolioUpdate = (
  source: Folio,
  target: Folio,
  txnIds: string[]
): { updatedSource: Folio; updatedTarget: Folio; amountDelta: number } => {
  const toMoveAll = source.transactions.filter((t) => txnIds.includes(t.id));
  const toMove = filterTransferable(toMoveAll);
  const amountDelta = toMove.reduce((sum, t) => sum + t.amount, 0);
  const now = new Date();
  const auditOut: Transaction = {
    id: `audit-${Date.now()}-out`,
    folioId: source.id,
    amount: 0,
    description: `Transfer out: ${toMove.length} transaction(s) to ${target.id}`,
    date: now,
    type: "transfer",
    createdBy: "system",
    authorizationLevel: "staff",
    transferredTo: target.id,
  };
  const auditIn: Transaction = {
    id: `audit-${Date.now()}-in`,
    folioId: target.id,
    amount: 0,
    description: `Transfer in: ${toMove.length} transaction(s) from ${source.id}`,
    date: now,
    type: "transfer",
    createdBy: "system",
    authorizationLevel: "staff",
    transferredFrom: source.id,
  };
  const updatedSource: Folio = {
    ...source,
    transactions: [...source.transactions.filter((t) => !txnIds.includes(t.id)), auditOut],
    balance: Math.max(0, source.balance - amountDelta),
    updatedAt: now,
  };
  const updatedTarget: Folio = {
    ...target,
    transactions: [
      ...target.transactions,
      ...toMove.map((t) => ({
        ...t,
        folioId: target.id,
        transferredFrom: source.id,
        transferredTo: target.id,
      })),
      auditIn,
    ],
    balance: target.balance + amountDelta,
    updatedAt: now,
  };
  return { updatedSource, updatedTarget, amountDelta };
};

// Computes updated source folio for a folio-to-city-ledger transfer (removes charges and adds audit)
export const computeFolioToLedgerUpdate = (
  source: Folio,
  txnIds: string[],
  ledgerId: string
): { updatedSource: Folio; amountDelta: number } => {
  const toMoveAll = source.transactions.filter((t) => txnIds.includes(t.id));
  const toMove = filterTransferable(toMoveAll);
  const amountDelta = toMove.reduce((sum, t) => sum + t.amount, 0);
  const now = new Date();
  const auditOut: Transaction = {
    id: `audit-${Date.now()}-out`,
    folioId: source.id,
    amount: 0,
    description: `Transfer out: ${toMove.length} transaction(s) to ${ledgerId}`,
    date: now,
    type: "transfer",
    createdBy: "system",
    authorizationLevel: "staff",
    transferredTo: ledgerId,
  };
  const updatedSource: Folio = {
    ...source,
    transactions: [...source.transactions.filter((t) => !txnIds.includes(t.id)), auditOut],
    balance: Math.max(0, source.balance - amountDelta),
    updatedAt: now,
  };
  return { updatedSource, amountDelta };
};

export default { filterTransferable, computeFolioToFolioUpdate, computeFolioToLedgerUpdate };
