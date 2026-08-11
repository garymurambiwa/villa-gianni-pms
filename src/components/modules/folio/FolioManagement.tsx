import React, { useState, useEffect } from "react";
import { formatShortId } from "@/lib/formatId";
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
  const { 
    guests, rooms, reservations, folioCharges, 
    folios: foliosMetadata, voidFolioCharge, transferFolioCharge,
    checkInGuest, updateReservation
  } = useData();
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
  
  // Generate folios from checked-in reservations (NOT from guests, which have no room_number column)
  // Priority order: DB folios table → checked-in reservations → guests with charges
  useEffect(() => {
    // 1. Start with DB folios (authoritative source)
    const dbFolioMap: Record<string, any> = {};
    (foliosMetadata || []).forEach((fm: any) => {
      if (fm.status === 'open' || fm.status === 'pending') {
        dbFolioMap[fm.guest_id || fm.id] = fm;
      }
    });

    // 2. Build from checked-in reservations (reservations table has room_number joined)
    const checkedInReservations = reservations.filter(
      r => r.status === 'checked-in' || r.status === 'checked_in' || r.status === 'CHECKED_IN'
    );

    // 3. Also include guests who have folio charges (legacy path for guests without reservations)
    const guestsWithCharges = guests.filter(g =>
      folioCharges.some(c => c.guestId === g.id) &&
      !checkedInReservations.some(r => r.guest_id === g.id || r.guestId === g.id)
    );

    // Build folio list from reservations
    const fromReservations = checkedInReservations.map(res => {
      const guestId = res.guest_id || res.guestId;
      const roomNumber = res.room_number || res.roomNumber || '';
      const dbFolio = dbFolioMap[guestId];

      const guestTransactions = folioCharges
        .filter(charge => charge.guestId === guestId)
        .map(charge => ({
          id: charge.id,
          folioId: dbFolio?.id || `folio-${guestId}`,
          amount: Number(charge.amount || 0),
          description: charge.description,
          date: new Date(charge.date),
          type: (charge.type === 'payment' ? 'payment' : 'charge') as 'charge' | 'payment',
          createdBy: charge.source || 'system',
          authorizationLevel: 'staff' as const,
          category: charge.category,
          voidedBy: charge.voidedBy,
          voidedAt: charge.voidedAt,
        }));

      const charges = guestTransactions.filter(t => t.type === 'charge' && !t.voidedBy).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
      const payments = guestTransactions.filter(t => t.type === 'payment' && !t.voidedBy).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
      const bal = guestTransactions.length > 0 ? Number((charges - payments).toFixed(2)) : Number(dbFolio?.balance || res.rate || 0);

      return {
        id: dbFolio?.id || `folio-${guestId}`,
        guestId,
        roomNumber,
        createdAt: dbFolio?.inserted_at ? new Date(dbFolio.inserted_at) : new Date(),
        updatedAt: new Date(),
        balance: bal,
        status: 'open' as const,
        transactions: guestTransactions,
        paymentMethod: dbFolio?.payment_method || res.payment_method || null,
      };
    });

    // Build folio list from legacy guests-with-charges path
    const fromGuests = guestsWithCharges.map(guest => {
      const guestTransactions = folioCharges
        .filter(charge => charge.guestId === guest.id)
        .map(charge => ({
          id: charge.id,
          folioId: `folio-${guest.id}`,
          amount: Number(charge.amount || 0),
          description: charge.description,
          date: new Date(charge.date),
          type: (charge.type === 'payment' ? 'payment' : 'charge') as 'charge' | 'payment',
          createdBy: charge.source || 'system',
          authorizationLevel: 'staff' as const,
          category: charge.category,
          voidedBy: charge.voidedBy,
          voidedAt: charge.voidedAt,
        }));

      const charges = guestTransactions.filter(t => t.type === 'charge' && !t.voidedBy).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
      const payments = guestTransactions.filter(t => t.type === 'payment' && !t.voidedBy).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);

      return {
        id: `folio-${guest.id}`,
        guestId: guest.id,
        roomNumber: (guest as any).room_number || (guest as any).roomNumber || '',
        createdAt: new Date(),
        updatedAt: new Date(),
        balance: Number((charges - payments).toFixed(2)),
        status: 'open' as const,
        transactions: guestTransactions,
        paymentMethod: null,
      };
    });

    const allFolios = [...fromReservations, ...fromGuests];
    setFolios(allFolios);
  }, [guests, reservations, folioCharges, foliosMetadata]);

  // Handle deep-linking to specific folio from Availability Grid or other modules
  useEffect(() => {
    const guestId = sessionStorage.getItem('folio_guestId');
    const folioId = sessionStorage.getItem('folio_folioId');
    
    if ((guestId || folioId) && folios.length > 0) {
      const target = folios.find(f => f.guestId === guestId || f.id === folioId);
      if (target) {
        setSelectedFolio(target);
        setActiveTab("details");
        // Clear the markers after consumption
        sessionStorage.removeItem('folio_guestId');
        sessionStorage.removeItem('folio_folioId');
      }
    }
  }, [folios]);

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

  const handlePaymentPosted = (updatedFolio: Folio) => {
    setFolios(prev => prev.map(f => f.id === updatedFolio.id ? updatedFolio : f));
    setSelectedFolio(updatedFolio);
  };

  const handleTransfer = async (sourceId: string, targetId: string, txnIds: string[]) => {
    try {
      const actor = user?.username || 'system';
      
      // Perform persistent transfers via context
      const results = await Promise.all(
        txnIds.map(txnId => transferFolioCharge(txnId, targetId.startsWith('cl:') ? targetId : targetId.replace('folio-', ''), actor))
      );
      
      const successCount = results.filter(r => r).length;
      
      if (successCount > 0) {
        toast({ 
          title: "Transfer complete", 
          description: `${successCount} items transferred successfully.` 
        });
      } else {
        toast({ 
          title: "Transfer failed", 
          description: "Could not transfer the requested items.",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('Transfer error:', error);
      toast({ title: "Error", description: "An error occurred during transfer.", variant: "destructive" });
    }
  };

  const handleRoomTransfer = async (guestId: string, newRoomId: string) => {
    try {
      const reservation = reservations.find(r => r.guest_id === guestId && r.status !== 'checked-out');
      if (!reservation) {
        throw new Error('No active reservation found for this guest');
      }
      
      const success = await checkInGuest(reservation.id, newRoomId);
      if (success) {
        toast({ 
          title: "Success", 
          description: "Guest has been transferred to the new room." 
        });
      } else {
        throw new Error('Failed to transfer guest to new room');
      }
    } catch (error) {
      console.error('Room transfer error:', error);
      throw error;
    }
  };

  const handleExtendStay = async (reservationId: string, newCheckoutDate: Date) => {
    try {
      const result = await updateReservation(reservationId, { 
        checkOut: newCheckoutDate.toISOString().split('T')[0]
      });
      
      if (result.success) {
        toast({ 
          title: "Success", 
          description: "Guest stay has been extended." 
        });
      } else {
        throw new Error(result.error || 'Failed to extend stay');
      }
    } catch (error) {
      console.error('Extend stay error:', error);
      throw error;
    }
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
                  Folio {formatShortId(selectedFolio.id)} | Balance: ${(computedBalance ? computedBalance.total : Number(selectedFolio.balance || 0)).toFixed(2)}
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
                      onPaymentPosted={handlePaymentPosted}
                      onRoomTransfer={handleRoomTransfer}
                      onExtendStay={handleExtendStay}
                      rooms={rooms}
                      reservations={reservations}
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
                      
                      // Call persistent void method
                      const ok_void = await voidFolioCharge(transactionId, reason, actor);
                      
                      if (ok_void) {
                        setOverrideOpen(false);
                        setOverrideUsername("");
                        setOverridePassword("");
                        setPendingVoid(null);
                        toast({ title: 'Transaction voided', description: `Voided by ${actor}`, duration: 1800 });
                      } else {
                        toast({ title: 'Void failed', description: 'Could not persist void status to database.', variant: 'destructive' });
                      }
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
