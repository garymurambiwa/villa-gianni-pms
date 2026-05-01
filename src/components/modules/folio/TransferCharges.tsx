import React, { useRef, useState } from "react";
import { Folio, Transaction } from "@/types/folio";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectSeparator, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { format } from "date-fns";
import { Guest } from "@/types";
import { useData } from "../../../context/DataContext";
import { useToast } from "../../../hooks/use-toast";

interface TransferChargesProps {
  sourceFolio: Folio;
  availableFolios: Folio[];
  guests: Guest[];
  onTransfer?: (sourceFolioId: string, targetFolioId: string, transactionIds: string[]) => void;
}

const TransferCharges: React.FC<TransferChargesProps> = ({ sourceFolio, availableFolios, guests, onTransfer }) => {
  const [selectedTransactions, setSelectedTransactions] = useState<string[]>([]);
  const [targetFolioId, setTargetFolioId] = useState<string>("");
  
  // Early defensive checks
  if (!sourceFolio) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        No source folio selected
      </div>
    );
  }
  
  // Ensure all data is properly initialized
  const safeSelectedTransactions = Array.isArray(selectedTransactions) ? selectedTransactions : [];
  const safeTransactions = Array.isArray(sourceFolio.transactions) ? sourceFolio.transactions : [];
  const safeAvailableFolios = Array.isArray(availableFolios) ? availableFolios : [];
  const safeGuests = Array.isArray(guests) ? guests : [];
  
  const { cityLedger, addCityLedgerTransaction } = useData();
  const { toast } = useToast();
  
  // Safe city ledger data
  const safeCityLedger = Array.isArray(cityLedger) ? cityLedger : [];
  const transferClickTsRef = useRef<number>(0);

  const handleTransactionSelect = (transactionId: string) => {
    setSelectedTransactions(prev => {
      // Extra defensive check
      if (!transactionId) return prev || [];
      const current = Array.isArray(prev) ? prev : [];
      return current.includes(transactionId)
        ? current.filter(id => id !== transactionId)
        : [...current, transactionId];
    });
  };
  
  const handleTransfer = () => {
    if (!targetFolioId || safeSelectedTransactions.length === 0) {
      toast({ title: "Nothing to transfer", description: "Select a destination and at least one charge.", variant: "destructive" });
      return;
    }
    
    const isCityLedgerTarget = targetFolioId.startsWith("cl:");

    if (isCityLedgerTarget) {
      const accountId = targetFolioId.replace("cl:", "");
      const account = safeCityLedger.find(acc => acc.id === accountId);
      if (!account) {
        toast({ title: "Transfer failed", description: "City Ledger account not found.", variant: "destructive" });
        return;
      }
      if (account.status && account.status !== "Active") {
        toast({ title: "Transfer blocked", description: `Account is ${account.status}.`, variant: "destructive" });
        return;
      }

      const selectedTxns: Transaction[] = safeTransactions.filter(t => safeSelectedTransactions.includes(t.id));
      // Ensure only valid charge-type transactions are transferred to City Ledger
      const invalid = selectedTxns.filter((t) => t.type !== "charge" || Number(t.amount) <= 0 || !!t.voidedBy);
      if (invalid.length > 0) {
        toast({ title: "Invalid selection", description: "Only non-voided charges with positive amounts can be transferred.", variant: "destructive" });
        return;
      }
      const totalDebit = selectedTxns.reduce((sum, t) => sum + t.amount, 0);

      if (account.creditLimit && account.balance + totalDebit > account.creditLimit) {
        toast({
          title: "Credit limit exceeded",
          description: `Transfer amount (${totalDebit.toFixed(2)}) exceeds available credit.`,
          variant: "destructive"
        });
        return;
      }

      const isoDate = new Date().toISOString().split('T')[0];
      selectedTxns.forEach(t => {
        addCityLedgerTransaction(accountId, {
          date: isoDate,
          description: `Transfer from folio ${sourceFolio.id}: ${t.description}`,
          debit: t.amount,
        });
      });

      // Also remove transactions from the source folio and adjust balance via parent callback
      if (onTransfer) {
        onTransfer(sourceFolio.id, `cl:${accountId}`, safeSelectedTransactions);
      }

      toast({
        title: "Transfer successful",
        description: `${selectedTxns.length} transaction(s) transferred to City Ledger: ${account.name}.`
      });

      setSelectedTransactions([]);
      setTargetFolioId("");
      return;
    }

    // Folio-to-folio transfer
    if (onTransfer) {
      onTransfer(sourceFolio.id, targetFolioId, safeSelectedTransactions);
      toast({ title: "Transfer successful", description: "Transactions moved to the selected folio." });
    } else {
      console.log("Transferring transactions:", safeSelectedTransactions, "to folio:", targetFolioId);
      toast({ title: "Transfer initiated", description: "Transactions will be moved to the selected folio." });
    }
    
    setSelectedTransactions([]);
    setTargetFolioId("");
  };

  const onTransferActivate = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    const now = Date.now();
    if (now - transferClickTsRef.current < 600) return;
    transferClickTsRef.current = now;
    handleTransfer();
  };
  
  const transferableTransactions = safeTransactions.filter(
    (t) => !t.voidedBy && t.type === "charge" && Number(t.amount) > 0
  );
  
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Transfer Charges</h3>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Transfer to:</span>
          <Select value={targetFolioId} onValueChange={setTargetFolioId}>
            <SelectTrigger className="w-[280px]">
              <SelectValue placeholder="Select destination" />
            </SelectTrigger>
            <SelectContent>
              {safeAvailableFolios.map(folio => {
                const guest = safeGuests.find(g => g.id === folio.guestId);
                return (
                  <SelectItem key={folio.id} value={folio.id}>
                    Room {folio.roomNumber} - {guest?.name || 'Unknown Guest'}
                  </SelectItem>
                );
              })}
              {safeCityLedger.length > 0 && (
                <>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>City Ledger Accounts</SelectLabel>
                    {cityLedger.map(acc => (
                      <SelectItem key={`cl-${acc.id}`} value={`cl:${acc.id}`}>
                        City Ledger: {acc.name} (Bal ${Number(acc.balance || 0).toFixed(2)})
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>
      
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[50px]"></TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {transferableTransactions.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center">No transferable transactions found</TableCell>
            </TableRow>
          ) : (
            transferableTransactions.map((transaction) => (
              <TableRow key={transaction.id}>
                <TableCell>
                  <Checkbox
                    checked={safeSelectedTransactions.includes(transaction.id)}
                    onCheckedChange={() => handleTransactionSelect(transaction.id)}
                  />
                </TableCell>
                <TableCell>{format(new Date(transaction.date), "MMM dd, yyyy")}</TableCell>
                <TableCell>{transaction.description}</TableCell>
                <TableCell>{transaction.type}</TableCell>
                <TableCell className="text-right">
                  ${Number(transaction.amount || 0).toFixed(2)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      
      <div className="flex justify-between items-center">
        <div>
          {safeSelectedTransactions.length > 0 && (
            <span className="text-sm">
              {safeSelectedTransactions.length} transaction(s) selected
            </span>
          )}
        </div>
        <Button 
          aria-label="Transfer selected charges"
          onClick={onTransferActivate}
          onTouchStart={onTransferActivate}
          disabled={safeSelectedTransactions.length === 0 || !targetFolioId}
        >
          Transfer Selected
        </Button>
      </div>
    </div>
  );
};

export default TransferCharges;
