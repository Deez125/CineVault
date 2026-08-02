"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/actions";

/**
 * The shared shell for every auth form.
 *
 * All of them are the same shape: a server action, a single error or success line, and a
 * submit button that has to disable itself while in flight. Writing that four times is four
 * chances for one of them to let a double-click create two accounts.
 */

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export function AuthForm({
  action,
  submitLabel,
  pendingLabel,
  children,
}: {
  action: Action;
  submitLabel: string;
  pendingLabel: string;
  children: React.ReactNode;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, null);

  return (
    <form action={formAction} className="space-y-4">
      {children}

      {state?.error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {state?.success && (
        <Alert>
          <CircleCheck className="text-success" />
          <AlertDescription>{state.success}</AlertDescription>
        </Alert>
      )}

      <SubmitButton label={submitLabel} pendingLabel={pendingLabel} />
    </form>
  );
}

/**
 * Must be its own component: useFormStatus only reports the status of a form ABOVE it in the
 * tree, so calling it inside AuthForm itself would always report idle.
 */
function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? (
        <>
          <LoaderCircle className="animate-spin" />
          {pendingLabel}
        </>
      ) : (
        label
      )}
    </Button>
  );
}
