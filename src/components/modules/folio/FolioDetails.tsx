import React, { useRef, useState } from "react";
import { Folio, Transaction } from "@/types/folio";
import { Guest } from "@/types";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";

interface FolioDetailsProps {
  folio: Folio;
  guests: Guest[];
  onVoid?: (transactionId: string, reason: string) => void;
  onTransfer?: (sourceId: string, targetId: string, txnIds: string[]) => void;
  availableFolios?: Folio[];
}

const FolioDetails: React.FC<FolioDetailsProps> = ({ folio, guests, onVoid, onTransfer, availableFolios = [] }) => {
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [isVoiding, setIsVoiding] = useState(false);
  const voidClickTsRef = useRef<number>(0);

  // Selection & Pagination
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [searchQuery, setSearchQuery] = useState("");

  // Transfer State
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [targetFolioId, setTargetFolioId] = useState("");

  const guest = guests.find(g => g.id === folio.guestId);

  // Filter and sort transactions
  const transactions = folio.transactions || [];
  const sortedTransactions = [...transactions]
    .filter(t => !searchQuery || t.description.toLowerCase().includes(searchQuery.toLowerCase()) || t.amount.toString().includes(searchQuery))
    .sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );

  const totalPages = Math.ceil(sortedTransactions.length / itemsPerPage);
  const currentTransactions = sortedTransactions.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );
  
  const handleVoidTransaction = () => {
    if (!selectedTransaction) return;
    try {
      onVoid?.(selectedTransaction.id, voidReason.trim());
    } finally {
      setVoidDialogOpen(false);
      setVoidReason("");
    }
  };
  
  const openVoidDialog = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setVoidDialogOpen(true);
  };

  const onVoidButtonActivate = (e: React.MouseEvent | React.TouchEvent, transaction: Transaction) => {
    e.stopPropagation();
    const now = Date.now();
    if (now - voidClickTsRef.current < 600) return;
    voidClickTsRef.current = now;
    openVoidDialog(transaction);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(currentTransactions.map(t => t.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectRow = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedIds(prev => [...prev, id]);
    } else {
      setSelectedIds(prev => prev.filter(x => x !== id));
    }
  };

  const handleTransferSubmit = () => {
    if (!targetFolioId || selectedIds.length === 0) return;
    onTransfer?.(folio.id, targetFolioId, selectedIds);
    setTransferDialogOpen(false);
    setSelectedIds([]);
    setTargetFolioId("");
  };

  // Calculate totals from transactions
  const balanceSummary = React.useMemo(() => {
    const txns = folio.transactions || [];
    const charges = txns
      .filter(t => t.type === 'charge' && !t.voidedBy)
      .reduce((sum, t) => sum + Math.abs(Number(t.amount || 0)), 0);
    const payments = txns
      .filter(t => t.type === 'payment' && !t.voidedBy)
      .reduce((sum, t) => sum + Math.abs(Number(t.amount || 0)), 0);
    const balance = Number((charges - payments).toFixed(2));
    return { charges, payments, balance: balance > 0 ? balance : (folio.balance || 0) };
  }, [folio.transactions, folio.balance]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <h3 className="text-lg font-medium">Guest Information</h3>
          <p>Name: {guest?.name}</p>
          <p>Email: {guest?.email}</p>
          <p>Phone: {guest?.phone}</p>
        </div>
        <div>
          <h3 className="text-lg font-medium">Room Information</h3>
          <p>Room Number: {folio.roomNumber}</p>
          <p>Status: {folio.status}</p>
          <div className="mt-2 p-3 bg-blue-50 rounded-lg border border-blue-200">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Total Charges:</span>
              <span className="font-medium">${balanceSummary.charges.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Total Payments:</span>
              <span className="font-medium text-green-600">-${balanceSummary.payments.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-base font-semibold border-t border-blue-200 pt-2 mt-2">
              <span className="text-blue-700">Account Balance:</span>
              <span className="text-blue-700">${balanceSummary.balance.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>
      
      <div>
        <div className="flex flex-col md:flex-row justify-between items-center mb-4 gap-4">
          <div className="flex items-center gap-4 w-full md:w-auto">
            <h3 className="text-lg font-medium whitespace-nowrap">Recent Transactions</h3>
            <Input 
              placeholder="Search transactions..." 
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className="max-w-[250px]"
            />
          </div>
          <div className="flex gap-2 w-full md:w-auto justify-end">
             <Button 
               variant="outline" 
               size="sm" 
               disabled={selectedIds.length === 0}
               onClick={() => setTransferDialogOpen(true)}
             >
               Transfer Selected ({selectedIds.length})
             </Button>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]">
                <Checkbox 
                  checked={selectedIds.length > 0 && currentTransactions.every(t => selectedIds.includes(t.id))}
                  onCheckedChange={(c) => handleSelectAll(!!c)}
                />
              </TableHead>
              <TableHead>Date & Time</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {currentTransactions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center">No transactions found</TableCell>
              </TableRow>
            ) : (
              currentTransactions.map((transaction) => (
                <TableRow key={transaction.id} className={transaction.voidedBy ? "opacity-50" : ""}>
                  <TableCell>
                    <Checkbox 
                      checked={selectedIds.includes(transaction.id)}
                      onCheckedChange={(c) => handleSelectRow(transaction.id, !!c)}
                      disabled={!!transaction.voidedBy}
                    />
                  </TableCell>
                  <TableCell>{format(new Date(transaction.date), "MMM dd, yyyy HH:mm")}</TableCell>
                  <TableCell>
                    {transaction.description}
                    {transaction.voidedBy && <span className="text-red-500 ml-2">(Voided)</span>}
                  </TableCell>
                  <TableCell className="capitalize">{transaction.type}</TableCell>
                  <TableCell className="text-right">
                    ${transaction.amount.toFixed(2)}
                  </TableCell>
                  <TableCell>
                    {!transaction.voidedBy && (
                      <Button 
                        variant="outline" 
                        size="sm"
                        aria-label="Void transaction"
                        onClick={(e) => onVoidButtonActivate(e, transaction)}
                        onTouchStart={(e) => onVoidButtonActivate(e, transaction)}
                      >
                        Void
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {totalPages > 1 && (
           <div className="flex justify-end gap-2 mt-2">
             <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>Previous</Button>
             <div className="flex items-center text-sm">Page {currentPage} of {totalPages}</div>
             <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>Next</Button>
           </div>
        )}
      </div>
      
      <Dialog open={voidDialogOpen} onOpenChange={setVoidDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void Transaction</DialogTitle>
            <DialogDescription>
              Are you sure you want to void this transaction? This action requires authorization and will be logged.
            </DialogDescription>
          </DialogHeader>
          
          {selectedTransaction && (
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Description</Label>
                  <div>{selectedTransaction.description}</div>
                </div>
                <div>
                  <Label>Amount</Label>
                  <div>${selectedTransaction.amount.toFixed(2)}</div>
                </div>
              </div>
              
              <div className="grid gap-2">
                <Label htmlFor="void-reason">Reason for voiding</Label>
                <Input 
                  id="void-reason" 
                  value={voidReason} 
                  onChange={(e) => setVoidReason(e.target.value)}
                  placeholder="Enter reason for voiding this transaction"
                />
              </div>
            </div>
          )}
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidDialogOpen(false)}>Cancel</Button>
            <Button 
              aria-label="Confirm transaction void"
              onClick={() => {
                if (isVoiding) return;
                setIsVoiding(true);
                try {
                  handleVoidTransaction();
                } finally {
                  setTimeout(() => setIsVoiding(false), 200);
                }
              }}
              disabled={!voidReason.trim() || isVoiding}
            >
              {isVoiding ? "Voiding..." : "Confirm Void"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer Transactions</DialogTitle>
            <DialogDescription>
              Select a target folio to transfer {selectedIds.length} transaction(s).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Target Folio</Label>
              <Select value={targetFolioId} onValueChange={setTargetFolioId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select target folio..." />
                </SelectTrigger>
                <SelectContent>
                  {availableFolios.map(f => {
                    const g = guests.find(guest => guest.id === f.guestId);
                    return (
                      <SelectItem key={f.id} value={f.id}>
                        Room {f.roomNumber} - {g?.name || 'Unknown'}
                      </SelectItem>
                    );
                  })}
                  <SelectItem value="cl:master">City Ledger (Master)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleTransferSubmit} disabled={!targetFolioId}>Transfer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FolioDetails;
