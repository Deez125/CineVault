"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/money";
import {
  awardCreditAction,
  setCreditAction,
  type ProfileFormState,
} from "./actions";

/**
 * Credit-only admin action buttons rendered inside the admin profile page.
 *
 * Discount was tried and reverted — attaching Stripe coupons to an already-active sub
 * didn't work reliably. Credit is the equivalent remedy and stays trivially calculable.
 *
 * Everything posts to a server action; the action's revalidatePath is what redraws the
 * surrounding sections — this file doesn't try to reach up and reflect the new state on
 * its own.
 */
export function ProfileActionsBar({
  userId,
  userEmail,
  hasStripeCustomer,
  currentCreditCents,
}: {
  userId: string;
  userEmail: string;
  hasStripeCustomer: boolean;
  currentCreditCents: number;
}) {
  const [dialog, setDialog] = useState<"award" | "set" | null>(null);

  return (
    <>
      <div className="flex flex-wrap gap-3 p-5">
        <Button
          size="lg"
          disabled={!hasStripeCustomer}
          onClick={() => setDialog("award")}
        >
          <Plus className="size-4" />
          Award credit
        </Button>
        <Button
          size="lg"
          variant="secondary"
          disabled={!hasStripeCustomer}
          onClick={() => setDialog("set")}
        >
          <Pencil className="size-4" />
          Edit credit balance
        </Button>
      </div>

      {!hasStripeCustomer && (
        <p className="border-t bg-muted/40 px-5 py-2.5 text-xs text-muted-foreground">
          Credit actions need a Stripe customer. {userEmail} hasn&apos;t started checkout yet.
        </p>
      )}

      <AwardDialog
        key={`award-${dialog === "award"}`}
        open={dialog === "award"}
        onOpenChange={(open) => !open && setDialog(null)}
        userId={userId}
        userEmail={userEmail}
      />
      <SetBalanceDialog
        key={`set-${dialog === "set"}`}
        open={dialog === "set"}
        onOpenChange={(open) => !open && setDialog(null)}
        userId={userId}
        currentCreditCents={currentCreditCents}
      />
    </>
  );
}

// ── Award credit ────────────────────────────────────────────────────────────

function AwardDialog({
  open,
  onOpenChange,
  userId,
  userEmail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userEmail: string;
}) {
  const [state, formAction] = useActionState<ProfileFormState, FormData>(
    awardCreditAction,
    null
  );

  useEffect(() => {
    if (state?.success) {
      toast.success(state.success);
      onOpenChange(false);
    }
  }, [state, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Award credit</DialogTitle>
          <DialogDescription>
            Add credit to {userEmail}. It comes off their next Stripe invoice automatically.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="userId" value={userId} />

          <div className="space-y-2">
            <Label htmlFor="award-amount">Amount ($)</Label>
            <Input
              id="award-amount"
              name="amount"
              inputMode="decimal"
              placeholder="5.00"
              autoFocus
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="award-reason">Reason (shown to the user)</Label>
            <Input
              id="award-reason"
              name="reason"
              placeholder="Sorry about the weekend downtime"
              maxLength={140}
            />
            <p className="text-xs text-muted-foreground">
              Blank is fine — the notification will just say &quot;It&apos;ll come off your
              next bill.&quot; Your admin email is captured in the audit log regardless.
            </p>
          </div>

          {state?.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <DialogClose render={<Button variant="secondary" size="lg">Cancel</Button>} />
            <Submit label="Award credit" />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Set credit balance ──────────────────────────────────────────────────────

function SetBalanceDialog({
  open,
  onOpenChange,
  userId,
  currentCreditCents,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  currentCreditCents: number;
}) {
  const [state, formAction] = useActionState<ProfileFormState, FormData>(
    setCreditAction,
    null
  );

  useEffect(() => {
    if (state?.success) {
      toast.success(state.success);
      onOpenChange(false);
    }
  }, [state, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit credit balance</DialogTitle>
          <DialogDescription>
            Set the balance to an exact amount. Use this for glitch corrections.
            Current balance is <b>{formatMoney(currentCreditCents)}</b>.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="userId" value={userId} />

          <div className="space-y-2">
            <Label htmlFor="set-amount">New balance ($)</Label>
            <Input
              id="set-amount"
              name="amount"
              inputMode="decimal"
              defaultValue={(currentCreditCents / 100).toFixed(2)}
              required
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Zero wipes their credit entirely. A downward adjustment doesn&apos;t send a
              notification (bug fix ≠ good news); an upward one does.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="set-reason">Reason (audit log only)</Label>
            <Input
              id="set-reason"
              name="reason"
              placeholder="Duplicate credit from webhook retry"
              maxLength={140}
            />
          </div>

          {state?.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <DialogClose render={<Button variant="secondary" size="lg">Cancel</Button>} />
            <Submit label="Save" />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending}>
      {pending && <LoaderCircle className="size-4 animate-spin" />}
      {label}
    </Button>
  );
}
