import React, { useState, useEffect, useCallback } from "react";
import { Folio } from "@/types/folio";
import { Guest } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { syncFolioChargeToDb } from "@/lib/dbSync";
import { printFolio } from "@/lib/documentUtils";
import { AlertTriangle, Printer } from "lucide-react";

interface PostPaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folio: Folio;
  guests: Guest[];
  currentBalance: number;
  onPaymentPosted?: (updatedFolio: Folio) => void;
}

const PAYMENT_TYPES = [
  { id: "cash", label: "Cash" },
  { id: "swipe", label: "Swipe" },
  { id: "ecocash", label: "Ecocash" },
] as const;

type PaymentTypeId = typeof PAYMENT_TYPES[number]["id"];

const PostPaymentModal: React.FC<PostPaymentModalProps> = ({
  open,
  onOpenChange,
  folio,
  guests,
  currentBalance,
  onPaymentPosted,
}) => {
  const { toast } = useToast();

  const [paymentType, setPaymentType] = useState<PaymentTypeId>("cash");
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showOverpayConfirm, setShowOverpayConfirm] = useState(false);

  const guest = guests.find((g) => g.id === folio.guestId);

  useEffect(() => {
    if (open) {
      setPaymentType("cash");
      setAmount("");
      setPaymentDate(format(new Date(), "yyyy-MM-dd"));
      setErrors({});
      setShowOverpayConfirm(false);
      setIsSubmitting(false);
    }
  }, [open]);

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    if (!paymentType) {
      newErrors.paymentType = "Payment type is required.";
    }

    const parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount)) {
      newErrors.amount = "Amount is required.";
    } else if (parsedAmount <= 0) {
      newErrors.amount = "Amount must be a positive number.";
    }

    if (!paymentDate) {
      newErrors.paymentDate = "Payment date is required.";
    } else {
      const selected = new Date(paymentDate);
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      if (selected > today) {
        newErrors.paymentDate = "Payment date cannot be in the future.";
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [paymentType, amount, paymentDate]);

  const executePayment = async () => {
    setIsSubmitting(true);
    try {
      const parsedAmount = parseFloat(amount);
      const paymentId = `PAY${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const typeName = PAYMENT_TYPES.find((t) => t.id === paymentType)?.label || "Cash";

      const newPayment = {
        id: paymentId,
        guestId: folio.guestId,
        description: `Payment - ${typeName}`,
        amount: -Math.abs(parsedAmount),
        date: new Date(paymentDate).toISOString(),
        category: "Payment",
        type: "payment" as const,
        method: typeName,
        source: "front_office" as const,
      };

      // Sync to database
      const syncResult = await syncFolioChargeToDb({
        id: newPayment.id,
        guest_id: newPayment.guestId,
        description: newPayment.description,
        amount: Math.abs(newPayment.amount),
        posting_date: paymentDate,
        category: newPayment.category,
        charge_type: "payment",
        source: "front_office",
        total_amount: Math.abs(newPayment.amount),
      });

      if (!syncResult.success) {
        toast({
          title: "Sync Error",
          description: "Payment saved locally but failed to sync to database.",
          variant: "destructive",
        });
      }

      // Build updated folio with new transaction
      const newTransaction = {
        id: paymentId,
        folioId: folio.id,
        amount: parsedAmount,
        description: `Payment - ${typeName}`,
        date: new Date(paymentDate),
        type: "payment" as const,
        createdBy: "front_desk",
        authorizationLevel: "staff" as const,
      };

      const updatedFolio: Folio = {
        ...folio,
        transactions: [...(folio.transactions || []), newTransaction],
        balance: Math.max(0, currentBalance - parsedAmount),
        updatedAt: new Date(),
      };

      // Print receipt
      try {
        await printFolio(
          updatedFolio,
          { pageRange: { start: 1, end: 5 }, quality: "normal", colorMode: "color" },
          guest?.name,
          undefined,
          guest?.checkIn ? new Date(guest.checkIn) : undefined,
          guest?.checkOut ? new Date(guest.checkOut) : undefined
        );
      } catch (printErr) {
        console.error("Receipt print failed:", printErr);
      }

      // Notify parent of updated folio
      onPaymentPosted?.(updatedFolio);

      toast({
        title: "Payment Posted",
        description: `$${parsedAmount.toFixed(2)} ${typeName} payment recorded. Receipt sent to printer.`,
      });

      onOpenChange(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Could not post payment.";
      console.error("Post payment error:", err);
      toast({
        title: "Payment Failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = () => {
    if (!validate()) return;

    const parsedAmount = parseFloat(amount);
    if (parsedAmount > currentBalance && currentBalance > 0 && !showOverpayConfirm) {
      setShowOverpayConfirm(true);
      return;
    }

    executePayment();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[425px] w-[95vw] max-h-[90vh] overflow-y-auto"
        aria-label="Post a payment to the guest folio"
      >
        <DialogHeader>
          <DialogTitle>Post Payment</DialogTitle>
          <DialogDescription>
            Post a payment to the guest folio manually.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-4">
          {/* Payment Type */}
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Payment Type
            </legend>
            <RadioGroup
              value={paymentType}
              onValueChange={(val) => {
                setPaymentType(val as PaymentTypeId);
                setErrors((prev) => ({ ...prev, paymentType: "" }));
              }}
              className="flex flex-wrap gap-4"
              aria-label="Select payment type"
            >
              {PAYMENT_TYPES.map((type) => (
                <div key={type.id} className="flex items-center space-x-2">
                  <RadioGroupItem
                    value={type.id}
                    id={`payment-type-${type.id}`}
                    aria-label={type.label}
                  />
                  <Label
                    htmlFor={`payment-type-${type.id}`}
                    className="font-normal cursor-pointer"
                  >
                    {type.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
            {errors.paymentType && (
              <p className="text-sm text-red-500" role="alert">
                {errors.paymentType}
              </p>
            )}
          </fieldset>

          {/* Amount */}
          <div className="grid gap-2">
            <Label htmlFor="payment-amount">Amount ($)</Label>
            <div className="relative">
              <span
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                aria-hidden="true"
              >
                $
              </span>
              <Input
                id="payment-amount"
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setErrors((prev) => ({ ...prev, amount: "" }));
                  setShowOverpayConfirm(false);
                }}
                placeholder="0.00"
                className="pl-7"
                aria-describedby={errors.amount ? "amount-error" : undefined}
                aria-invalid={!!errors.amount}
              />
            </div>
            {errors.amount && (
              <p id="amount-error" className="text-sm text-red-500" role="alert">
                {errors.amount}
              </p>
            )}
          </div>

          {/* Payment Date */}
          <div className="grid gap-2">
            <Label htmlFor="payment-date">Payment Date</Label>
            <Input
              id="payment-date"
              type="date"
              value={paymentDate}
              onChange={(e) => {
                setPaymentDate(e.target.value);
                setErrors((prev) => ({ ...prev, paymentDate: "" }));
              }}
              max={format(new Date(), "yyyy-MM-dd")}
              aria-describedby={errors.paymentDate ? "date-error" : undefined}
              aria-invalid={!!errors.paymentDate}
            />
            {errors.paymentDate && (
              <p id="date-error" className="text-sm text-red-500" role="alert">
                {errors.paymentDate}
              </p>
            )}
          </div>

          {/* Current Balance Reference */}
          <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Current Balance: </span>
            <span className="font-semibold">${currentBalance.toFixed(2)}</span>
          </div>

          {/* Overpayment Warning */}
          {showOverpayConfirm && (
            <div
              className="flex items-start gap-3 rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm"
              role="alert"
              aria-live="assertive"
            >
              <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p className="font-medium text-yellow-800">
                  Payment exceeds balance
                </p>
                <p className="text-yellow-700">
                  The amount (${parseFloat(amount).toFixed(2)}) exceeds the
                  current balance (${currentBalance.toFixed(2)}). Do you want to
                  continue?
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowOverpayConfirm(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={executePayment}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? "Processing..." : "Confirm Overpayment"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || showOverpayConfirm}
            className="gap-2"
          >
            <Printer className="h-4 w-4" aria-hidden="true" />
            {isSubmitting ? "Processing..." : "Post Payment & Print"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PostPaymentModal;
