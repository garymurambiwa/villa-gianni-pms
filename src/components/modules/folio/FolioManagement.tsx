import React, { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useData } from "../../../context/DataContext";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import FolioList from "./FolioList";
import FolioDetails from "./FolioDetails";
import AccountStatement from "./AccountStatement";
import TransferCharges from "./TransferCharges";
import PrintExportPanel from "./PrintExportPanel";
import { Folio, Transaction } from "@/types/folio";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import pmsAuthDb from "@/lib/pmsAuthDb";
import taxSvc from "@/lib/taxService";
import { errorTracker } from "@/lib/errorTracker";

const FolioManagement: React.FC = () => {
  const { guests, rooms, reservations, folioCharges, folios: foliosMetadata } = useData();
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedFolio, setSelectedFolio] = useState<Folio | null>(null);
  const [activeTab, setActiveTab] = useState("folios");
  const [folios, setFolios] = useState<Folio[]>([]);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideUsername, setOverrideUsername] = useState("");
  const [overridePassword, setOverridePassword] = useState("");
  const [overrideLoading, setOverrideLoading] = useState(false);
  const [pendingVoid, setPendingVoid] = useState<{ transactionId: string; reason: string } | null>(null);
  const [computedBalance, setComputedBalance] = useState<{ subtotal: number; tax: number; total: number; payments: number } | null>(null);
  
  // Generate folios from checked-in guests
  useEffect(() => {
    const checkedInGuests = guests.filter(guest => guest.roomNumber);
    const newFolios = checkedInGuests.map(guest => {
      // Get all folio charges for this guest
      const guestTransactions = folioCharges
        .filter(charge => charge.guestId === guest.id)
        .map(charge => {
          const txnType: 'charge' | 'payment' = charge.type === 'payment' ? 'payment' : 'charge';
          return {
            id: charge.id,
            folioId: `folio-${guest.id}`,
            amount: Number(charge.amount || 0),
            description: charge.description,
            date: new Date(charge.date),
            type: txnType,
            createdBy: charge.source || 'system',
            authorizationLevel: 'staff' as const,
            category: charge.category,
            voidedBy: charge.voidedBy,
            voidedAt: charge.voidedAt
          };
        });
      
      // Calculate actual balance from transactions
      // Balance = sum of charges - sum of payments (payments are typically negative or marked as payment type)
      const charges = guestTransactions
        .filter(t => t.type === 'charge' && !t.voidedBy)
        .reduce((sum, t) => sum + Math.abs(Number(t.amount || 0)), 0);
      const payments = guestTransactions
        .filter(t => t.type === 'payment' && !t.voidedBy)
        .reduce((sum, t) => sum + Math.abs(Number(t.amount || 0)), 0);
      const computedBalance = Number((charges - payments).toFixed(2));
      
      return {
        id: `folio-${guest.id}`,
        guestId: guest.id,
        roomNumber: guest.roomNumber || "",
        createdAt: new Date(),
        updatedAt: new Date(),
        balance: computedBalance > 0 ? computedBalance : (guest.folioBalance || 0),
        status: "open" as const,
        transactions: guestTransactions,
        paymentMethod: foliosMetadata.find((fm: any) => fm.guest_id === guest.id && fm.status === 'open')?.payment_method
      };
    });
    
    setFolios(newFolios);
  }, [guests, folioCharges, foliosMetadata]);

  const handleFolioSelect = (folio: Folio) => {
    setSelectedFolio(folio);
    setActiveTab("details");
  };

  useEffect(() => {
    let canceled = false;
    const run = async () => {
      if (!selectedFolio) { setComputedBalance(null); return; }
      const charges = (selectedFolio.transactions || []).filter(t => t.type === "charge" && !t.voidedBy);
      const calcs = await Promise.all(charges.map(async t => {
        const d = String(t.description || "").toLowerCase();
        let cat: "accommodation"|"pos"|"services" = "services";
        if (d.includes("room") || d.includes("accommodation")) cat = "accommodation";
        else if (d.includes("restaurant") || d.includes("bar") || d.includes("f&b") || d.includes("dinner") || d.includes("meal")) cat = "pos";
        const c = await taxSvc.calculateTaxesForAmount(Number(t.amount || 0), cat);
        return c;
      }));
      const subtotal = calcs.reduce((s,c)=> s + Number(c.subtotal || 0), 0);
      const tax = calcs.reduce((s,c)=> s + Number(c.taxTotal || 0), 0);
      const chargesTotal = calcs.reduce((s,c)=> s + Number(c.total || 0), 0);
      const payments = (selectedFolio.transactions || []).filter(t => t.type === "payment" && !t.voidedBy).reduce((s,t)=> s + Number(t.amount || 0), 0);
      const total = Number((chargesTotal + payments).toFixed(2));
      if (!canceled) setComputedBalance({ subtotal: Number(subtotal.toFixed(2)), tax: Number(tax.toFixed(2)), total, payments: Number(payments.toFixed(2)) });
    };
    run();
    return () => { canceled = true; };
  }, [selectedFolio]);

  const handleVoid = (transactionId: string, reason: string) => {
    setPendingVoid({ transactionId, reason });
    setOverrideOpen(true);
  };

  const handleTransfer = (sourceId: string, targetId: string, txnIds: string[]) => {
    setFolios(prev => {
      const sourceIndex = prev.findIndex(f => f.id === sourceId);
      if (sourceIndex === -1) return prev;
      
      const sourceFolio = prev[sourceIndex];
      const transactionsToTransfer = sourceFolio.transactions.filter(t => txnIds.includes(t.id));
      
      if (transactionsToTransfer.length === 0) return prev;

      const totalAmount = transactionsToTransfer.reduce((sum, t) => sum + Number(t.amount || 0), 0);
      const now = new Date();
      const currentUser = user?.username || 'system';

      const transferOutTx: Transaction = {
        id: `tx-${Date.now()}-tr-out`,
        folioId: sourceId,
        amount: -totalAmount,
        description: `Transfer to ${targetId.startsWith('cl:') ? 'City Ledger' : 'Folio'}`,
        date: now,
        type: 'transfer',
        createdBy: currentUser,
        authorizationLevel: 'staff'
      };

      const updatedSourceFolio = {
        ...sourceFolio,
        transactions: [...sourceFolio.transactions, transferOutTx],
        balance: sourceFolio.balance - totalAmount,
        updatedAt: now
      };

      const nextFolios = [...prev];
      nextFolios[sourceIndex] = updatedSourceFolio;

      if (!targetId.startsWith('cl:')) {
        const targetIndex = nextFolios.findIndex(f => f.id === targetId);
        if (targetIndex > -1) {
          const targetFolio = nextFolios[targetIndex];
          const transferredTxns = transactionsToTransfer.map(t => ({
            ...t,
            id: `tx-${Date.now()}-${t.id.substring(0,8)}`,
            folioId: targetId,
            description: `${t.description} (From Rm ${sourceFolio.roomNumber})`,
            date: now
          }));

          nextFolios[targetIndex] = {
            ...targetFolio,
            transactions: [...targetFolio.transactions, ...transferredTxns],
            balance: targetFolio.balance + totalAmount,
            updatedAt: now
          };
        }
      }

      if (selectedFolio?.id === sourceId) {
        setSelectedFolio(updatedSourceFolio);
      }

      return nextFolios;
    });
    
    toast({ title: "Transfer complete", description: `${txnIds.length} items transferred.` });
  };

  return (
    <div className="container mx-auto p-4">
      <div className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b shadow-sm px-6 -mx-6 py-3 mb-6">
        <h1 className="text-2xl font-bold">Folio Management</h1>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>In-House Guests</CardTitle>
              <CardDescription>
                Select a guest folio to manage
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FolioList 
                folios={folios.filter(f => f.status === "open")} 
                guests={guests}
                onSelect={handleFolioSelect}
                selectedFolioId={selectedFolio?.id}
              />
            </CardContent>
          </Card>
        </div>
        
        <div className="md:col-span-2">
          {selectedFolio ? (
            <>
            <Card>
              <CardHeader>
                <CardTitle>
                  Room {selectedFolio.roomNumber} - 
                  {guests.find(g => g.id === selectedFolio.guestId)?.name}
                </CardTitle>
                <CardDescription>
                  Folio #{selectedFolio.id} | Balance: ${(computedBalance ? computedBalance.total : selectedFolio.balance).toFixed(2)}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList className="grid w-full grid-cols-5">
                    <TabsTrigger value="details">Account Details</TabsTrigger>
                    <TabsTrigger value="statement">Statement</TabsTrigger>
                    <TabsTrigger value="transfer">Transfer Charges</TabsTrigger>
                    <TabsTrigger value="audit">Audit Trail</TabsTrigger>
                    <TabsTrigger value="print">Print/Export</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="details">
                    <FolioDetails 
                      folio={selectedFolio} 
                      guests={guests}
                      onVoid={handleVoid}
                      onTransfer={handleTransfer}
                      availableFolios={folios.filter(f => f.id !== selectedFolio.id && f.status === "open")}
                    />
                  </TabsContent>
                  
                  <TabsContent value="statement">
                    <AccountStatement folio={selectedFolio} guests={guests} />
                  </TabsContent>
                  
                  <TabsContent value="transfer">
                    <TransferCharges 
                      sourceFolio={selectedFolio}
                      availableFolios={folios.filter(f => f.id !== selectedFolio.id && f.status === "open")}
                      guests={guests}
                      onTransfer={handleTransfer}
                    />
                  </TabsContent>
                  
                  <TabsContent value="audit">
                    <div className="p-4">
                      <h3 className="text-lg font-medium">Audit Trail</h3>
                      <p className="text-sm text-gray-500 mb-4">Complete history of actions for this folio</p>
                      <div className="rounded-md border">
                        <div className="grid grid-cols-5 gap-2 px-3 py-2 text-xs font-medium text-muted-foreground border-b">
                          <div>Date</div>
                          <div>Type</div>
                          <div>Description</div>
                          <div>Amount</div>
                          <div>Actor</div>
                        </div>
                        {(selectedFolio?.transactions || [])
                          .filter(t => t.type === 'void' || t.type === 'transfer')
                          .sort((a,b) => (b.date?.valueOf?.() || 0) - (a.date?.valueOf?.() || 0))
                          .map(tx => (
                            <div key={tx.id} className="grid grid-cols-5 gap-2 px-3 py-2 text-sm">
                              <div>{tx.date ? new Date(tx.date).toLocaleString() : ''}</div>
                              <div className="uppercase">{tx.type}</div>
                              <div className="truncate" title={tx.description}>{tx.description}</div>
                              <div>{Number(tx.amount || 0).toFixed(2)}</div>
                              <div>{tx.createdBy || tx.voidedBy || 'system'}</div>
                            </div>
                          ))}
                        {!(selectedFolio?.transactions || []).some(t => t.type === 'void' || t.type === 'transfer') && (
                          <div className="px-3 py-4 text-sm text-muted-foreground">No audit entries yet</div>
                        )}
                      </div>
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="print">
                    <PrintExportPanel 
                      folio={selectedFolio}
                      availableFolios={folios.filter(f => f.status === "open")}
                      guests={guests}
                      rooms={rooms}
                    />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
            <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Manager Authorization Required</DialogTitle>
                </DialogHeader>
                <div className="grid gap-3 py-2">
                  <div className="grid gap-1">
                    <Label htmlFor="mgr-username">Username</Label>
                    <Input id="mgr-username" value={overrideUsername} onChange={(e) => setOverrideUsername(e.target.value)} autoComplete="username" />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="mgr-password">Password</Label>
                    <Input id="mgr-password" type="password" value={overridePassword} onChange={(e) => setOverridePassword(e.target.value)} autoComplete="current-password" />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => { setOverrideOpen(false); setOverrideUsername(""); setOverridePassword(""); setPendingVoid(null); }}>Cancel</Button>
                  <Button disabled={overrideLoading || !overrideUsername.trim() || !overridePassword} onClick={async () => {
                    if (overrideLoading || !pendingVoid) return;
                    setOverrideLoading(true);
                    try {
                      const res = await pmsAuthDb.verifyLogin(overrideUsername.trim(), overridePassword);
                      const ok = !!res?.ok && !!res.user;
                      const role = String(res?.user?.role || '').toLowerCase();
                      const authorized = role === 'admin' || role === 'manager' || role === 'auditor';
                      if (!ok || !authorized) {
                        toast({ title: 'Authorization failed', description: 'Manager credentials required.', variant: 'destructive', duration: 2500 });
                        return;
                      }
                      const actor = res.user?.username || 'manager';
                      const transactionId = pendingVoid.transactionId;
                      const reason = pendingVoid.reason;
                      setFolios(prev => {
                        const f = prev.find(x => x.id === selectedFolio?.id);
                        if (!f) return prev;
                        const idx = f.transactions.findIndex(t => t.id === transactionId);
                        if (idx === -1) return prev;
                        const target = f.transactions[idx];
                        if (target.voidedBy) return prev;
                        const now = new Date();
                        const updatedTx = { ...target, voidedBy: actor, voidedAt: now, voidReason: reason };
                        const delta = target.type === 'charge' ? -target.amount : target.type === 'payment' ? target.amount : 0;
                        const auditVoid = {
                          id: `audit-${Date.now()}-void`,
                          folioId: f.id,
                          amount: 0,
                          description: `Void ${target.type} ${target.id}: ${reason || 'No reason provided'}`,
                          date: now,
                          type: 'void' as const,
                          createdBy: actor,
                          authorizationLevel: role as any
                        };
                        const updatedFolio: Folio = {
                          ...f,
                          transactions: f.transactions.map(t => t.id === transactionId ? updatedTx : t).concat([auditVoid]),
                          balance: Math.max(0, f.balance + delta),
                          updatedAt: now
                        };
                        const next = prev.map(x => x.id === f.id ? updatedFolio : x);
                        toast({ title: 'Transaction voided', description: `Voided by ${actor}`, duration: 1800 });
                        setSelectedFolio(updatedFolio);
                        return next;
                      });
                      setOverrideOpen(false);
                      setOverrideUsername("");
                      setOverridePassword("");
                      setPendingVoid(null);
                    } finally {
                      setOverrideLoading(false);
                    }
                  }}>{overrideLoading ? 'Verifying…' : 'Authorize & Void'}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            </>
          ) : (
            <Card>
              <CardContent className="p-8 text-center">
                <p className="text-muted-foreground">
                  Select a folio from the list to view details
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default FolioManagement;
