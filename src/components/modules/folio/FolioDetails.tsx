import React, { useRef, useState } from "react";
import { Folio, Transaction } from "@/types/folio";
import { Guest } from "@/types";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import PostPaymentModal from "./PostPaymentModal";

interface FolioDetailsProps {
  folio: Folio;
  guests: Guest[];
  onVoid?: (transactionId: string, reason: string) => void;
  onTransfer?: (sourceId: string, targetId: string, txnIds: string[]) => void;
  onPaymentPosted?: (updatedFolio: Folio) => void;
  onRoomTransfer?: (guestId: string, newRoomId: string) => Promise<void>;
  onExtendStay?: (reservationId: string, newCheckoutDate: Date) => Promise<void>;
  availableFolios?: Folio[];
  rooms?: Array<{ id: string; number: string; status: string }>;
  reservations?: Array<{ id: string; guest_id: string; check_out_date: string; room_id: string }>;
}

const FolioDetails: React.FC<FolioDetailsProps> = ({ folio, guests, onVoid, onTransfer, onPaymentPosted, availableFolios = [], onRoomTransfer, onExtendStay, rooms = [], reservations = [] }) => {
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

  // Transfer Room State
  const [transferRoomOpen, setTransferRoomOpen] = useState(false);
  const [selectedNewRoom, setSelectedNewRoom] = useState("");

  // Extend Stay State
  const [extendStayOpen, setExtendStayOpen] = useState(false);
  const [newCheckoutDate, setNewCheckoutDate] = useState("");

  // Post Payment State
  const [postPaymentOpen, setPostPaymentOpen] = useState(false);
  const { toast } = useToast();

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

  const handleTransferRoom = async () => {
    if (!selectedNewRoom || !folio.guestId) return;
    try {
      await onRoomTransfer?.(folio.guestId, selectedNewRoom);
      toast({ title: "Success", description: "Guest has been transferred to the new room." });
      setTransferRoomOpen(false);
      setSelectedNewRoom("");
    } catch (error) {
      toast({ 
        title: "Error", 
        description: error instanceof Error ? error.message : "Failed to transfer room", 
        variant: "destructive" 
      });
    }
  };

  const handleExtendStay = async () => {
    if (!newCheckoutDate) return;
    const reservation = reservations.find(r => r.guest_id === folio.guestId);
    if (!reservation) {
      toast({ title: "Error", description: "No reservation found for this guest", variant: "destructive" });
      return;
    }
    try {
      await onExtendStay?.(reservation.id, new Date(newCheckoutDate));
      toast({ title: "Success", description: "Guest stay has been extended." });
      setExtendStayOpen(false);
      setNewCheckoutDate("");
    } catch (error) {
      toast({ 
        title: "Error", 
        description: error instanceof Error ? error.message : "Failed to extend stay", 
        variant: "destructive" 
      });
    }
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
          <p>Name: {guest?.name || guest?.full_name || <span className="text-gray-400">Unassigned Guest</span>}</p>
          <p>Email: {guest?.email || <span className="text-gray-400">—</span>}</p>
          <p>Phone: {guest?.phone || <span className="text-gray-400">—</span>}</p>
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
              <span className="text-blue-700">${Number(balanceSummary.balance || 0).toFixed(2)}</span>
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
           <div className="flex gap-2 w-full md:w-auto justify-end flex-wrap">
             <Button 
               variant="outline" 
               size="sm" 
               onClick={() => setPostPaymentOpen(true)}
               className="bg-green-50 hover:bg-green-100 text-green-700 border-green-200"
               aria-label="Post a payment to the guest folio"
             >
               Post Payment
             </Button>
             <Button 
               variant="outline" 
               size="sm" 
               disabled={selectedIds.length === 0}
               onClick={() => setTransferDialogOpen(true)}
             >
               Transfer Selected ({selectedIds.length})
             </Button>
             <Button 
               variant="outline" 
               size="sm"
               onClick={() => setTransferRoomOpen(true)}
               className="bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200"
               aria-label="Transfer guest to a different room"
             >
               Transfer Room
             </Button>
             <Button 
               variant="outline" 
               size="sm"
               onClick={() => setExtendStayOpen(true)}
               className="bg-purple-50 hover:bg-purple-100 text-purple-700 border-purple-200"
               aria-label="Extend guest stay checkout date"
             >
               Extend Stay
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
                    ${Number(transaction.amount || 0).toFixed(2)}
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
                  <div>${Number(selectedTransaction.amount || 0).toFixed(2)}</div>
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

      <PostPaymentModal
        open={postPaymentOpen}
        onOpenChange={setPostPaymentOpen}
        folio={folio}
        guests={guests}
        currentBalance={balanceSummary.balance}
        onPaymentPosted={onPaymentPosted}
      />

      <Dialog open={transferRoomOpen} onOpenChange={setTransferRoomOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer Guest to Different Room</DialogTitle>
            <DialogDescription>
              Select a new room to transfer {guest?.name || "the guest"} from room {folio.roomNumber}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Select New Room</Label>
              <Select value={selectedNewRoom} onValueChange={setSelectedNewRoom}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a room..." />
                </SelectTrigger>
                <SelectContent>
                  {rooms
                    .filter(r => r.id !== folio.roomNumber && r.status === 'vacant')
                    .map(r => (
                      <SelectItem key={r.id} value={r.id}>
                        Room {r.number} (Status: {r.status})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferRoomOpen(false)}>Cancel</Button>
            <Button onClick={handleTransferRoom} disabled={!selectedNewRoom}>Transfer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={extendStayOpen} onOpenChange={setExtendStayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Extend Guest Stay</DialogTitle>
            <DialogDescription>
              Extend the checkout date for {guest?.name || "the guest"}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="new-checkout-date">New Checkout Date</Label>
              <Input
                id="new-checkout-date"
                type="date"
                value={newCheckoutDate}
                onChange={(e) => setNewCheckoutDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendStayOpen(false)}>Cancel</Button>
            <Button onClick={handleExtendStay} disabled={!newCheckoutDate}>Extend Stay</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FolioDetails;
