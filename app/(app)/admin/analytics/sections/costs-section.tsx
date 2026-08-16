"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Eye, EyeOff, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { AdminCost } from "@/lib/db/schema";
import {
  createCostAction,
  deleteCostAction,
  toggleCostAction,
  updateCostAction,
  type CostFormState,
} from "./costs-actions";

/**
 * The costs table.
 *
 * Kept intentionally small — a name, a monthly amount, a notes column, and controls to
 * toggle a row out of the total or delete it. Yearly costs go in as `/12` — the note
 * column is where the admin writes "×12 for annual" as a reminder. No unit conversion
 * lives in the UI: a monthly cents integer is the only currency, matching MRR.
 */

export function CostsSection({ costs }: { costs: AdminCost[] }) {
  const active = costs.filter((c) => c.active);
  const totalActive = active.reduce((sum, c) => sum + c.monthlyCents, 0);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AdminCost | null>(null);

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5">
        <div>
          <h2 className="text-sm font-semibold">Costs</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Monthly fixed costs. {active.length} active — {formatMoney(totalActive)}/mo.
          </p>
        </div>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="size-3.5" />
          Add cost
        </Button>
      </div>

      {costs.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          Nothing on the ledger yet. Add hosting, Plex Pass, storage, whatever recurring
          bill goes out every month.
        </div>
      ) : (
        <ul className="divide-y">
          {costs.map((c) => (
            <CostRow
              key={c.id}
              cost={c}
              onEdit={() => setEditing(c)}
            />
          ))}
        </ul>
      )}

      <CostDialog
        key={`add-${adding}`}
        open={adding}
        onOpenChange={setAdding}
        mode="create"
      />

      <CostDialog
        key={`edit-${editing?.id ?? "none"}`}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        mode="edit"
        cost={editing}
      />
    </section>
  );
}

function CostRow({ cost, onEdit }: { cost: AdminCost; onEdit: () => void }) {
  const [toggleState, toggleAction] = useActionState<CostFormState, FormData>(
    toggleCostAction,
    null
  );
  const [deleteState, deleteAction] = useActionState<CostFormState, FormData>(
    deleteCostAction,
    null
  );

  useEffect(() => {
    if (toggleState?.success) toast.success(toggleState.success);
    if (toggleState?.error) toast.error(toggleState.error);
  }, [toggleState]);

  useEffect(() => {
    if (deleteState?.success) toast.success(deleteState.success);
    if (deleteState?.error) toast.error(deleteState.error);
  }, [deleteState]);

  return (
    <li className={cn("flex items-center gap-3 px-5 py-3", !cost.active && "opacity-60")}>
      <button
        type="button"
        onClick={onEdit}
        className="min-w-0 flex-1 rounded text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 -mx-1 px-1"
      >
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium">{cost.name}</span>
          {!cost.active && (
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              hidden
            </span>
          )}
        </div>
        {cost.notes && <p className="mt-0.5 truncate text-xs text-muted-foreground">{cost.notes}</p>}
      </button>

      <span className="w-24 shrink-0 text-right text-sm font-medium tabular-nums">
        {formatMoney(cost.monthlyCents)}
        <span className="text-xs text-muted-foreground">/mo</span>
      </span>

      <form action={toggleAction} className="shrink-0">
        <input type="hidden" name="id" value={cost.id} />
        <input type="hidden" name="active" value={String(!cost.active)} />
        <IconSubmit
          aria-label={cost.active ? "Hide from totals" : "Include in totals"}
          icon={cost.active ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
        />
      </form>

      <form action={deleteAction} className="shrink-0">
        <input type="hidden" name="id" value={cost.id} />
        <IconSubmit
          aria-label="Delete cost"
          icon={<Trash2 className="size-3.5" />}
          destructive
        />
      </form>
    </li>
  );
}

function IconSubmit({
  icon,
  destructive,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: React.ReactNode; destructive?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="ghost"
      size="sm"
      disabled={pending}
      className={cn(destructive && "text-destructive hover:text-destructive")}
      {...rest}
    >
      {pending ? <LoaderCircle className="size-3.5 animate-spin" /> : icon}
    </Button>
  );
}

function CostDialog({
  open,
  onOpenChange,
  mode,
  cost,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  cost?: AdminCost | null;
}) {
  const [state, formAction] = useActionState<CostFormState, FormData>(
    mode === "create" ? createCostAction : updateCostAction,
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
          <DialogTitle>{mode === "create" ? "Add a cost" : "Edit cost"}</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {mode === "edit" && cost && <input type="hidden" name="id" value={cost.id} />}

          <div className="space-y-2">
            <Label htmlFor="cost-name">Name</Label>
            <Input
              id="cost-name"
              name="name"
              defaultValue={cost?.name ?? ""}
              maxLength={80}
              placeholder="Hetzner server"
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cost-monthly">Monthly amount ($)</Label>
            <Input
              id="cost-monthly"
              name="monthly"
              inputMode="decimal"
              defaultValue={cost ? (cost.monthlyCents / 100).toFixed(2) : ""}
              placeholder="12.99"
              required
            />
            <p className="text-xs text-muted-foreground">
              Yearly bills get divided by 12 before typing. Add &quot;×12 for annual&quot; in
              the notes so you remember why the number is odd.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cost-notes">Notes (optional)</Label>
            <Input
              id="cost-notes"
              name="notes"
              defaultValue={cost?.notes ?? ""}
              maxLength={140}
              placeholder="Renews 15th"
            />
          </div>

          {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

          <DialogFooter>
            <DialogClose render={<Button variant="secondary" size="lg">Cancel</Button>} />
            <SaveSubmit label={mode === "create" ? "Add" : "Save"} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SaveSubmit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending}>
      {pending && <LoaderCircle className="size-4 animate-spin" />}
      {label}
    </Button>
  );
}
