"use client";

import { useActionState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resendSignupAction } from "@/lib/auth/actions";

/**
 * "Didn't arrive? Send it again."
 *
 * The address travels in a hidden field because nobody is signed in at this point — there is
 * no session to read it from. That is fine: the action never confirms whether the address is
 * known, so putting one in costs an attacker nothing they could not already try on the signup
 * form itself.
 */
export function ResendLink({ email }: { email: string }) {
  const [state, action, pending] = useActionState(resendSignupAction, null);

  return (
    <form action={action} className="mt-6">
      <input type="hidden" name="email" value={email} />

      {state?.success ? (
        <p className="text-sm text-success">{state.success}</p>
      ) : (
        <>
          <Button variant="secondary" size="lg" type="submit" disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" />}
            {pending ? "Sending" : "Send it again"}
          </Button>
          {state?.error && <p className="mt-3 text-sm text-destructive">{state.error}</p>}
        </>
      )}
    </form>
  );
}
