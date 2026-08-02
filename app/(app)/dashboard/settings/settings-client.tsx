"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
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
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/constants";
import {
  changePasswordAction,
  deleteAccountAction,
  updateProfileAction,
} from "@/lib/auth/account-actions";
import { USERNAME_MAX, USERNAME_MIN, initial } from "@/lib/display-name";
import { resendVerificationAction } from "@/lib/auth/actions";
import type { FormState } from "@/lib/auth/actions";

export function SettingsClient({
  email,
  firstName,
  lastName,
  username,
  emailVerified,
  showVerification,
  isMember,
}: {
  email: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  emailVerified: boolean;
  showVerification: boolean;
  isMember: boolean;
}) {
  const [deleting, setDeleting] = useState(false);

  return (
    <div className="space-y-5">
      <Section title="Profile">
        <div className="mb-6 flex items-center gap-4">
          {/* The slot a profile picture will live in. Not a button, and it does not pretend
              to be one: an upload control that silently does nothing is worse than an
              obvious placeholder. */}
          <div
            className="flex size-16 shrink-0 items-center justify-center rounded-full bg-muted text-xl font-semibold text-muted-foreground"
            aria-hidden
          >
            {initial({ username, firstName, lastName, email })}
          </div>
          <div>
            <p className="text-sm font-medium">Profile picture</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Coming later. For now this is the first letter of your name.
            </p>
          </div>
        </div>

        <ActionForm action={updateProfileAction} submit="Save">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="firstName">First name</Label>
              <Input
                id="firstName"
                name="firstName"
                defaultValue={firstName ?? ""}
                maxLength={60}
                autoComplete="given-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last name</Label>
              <Input
                id="lastName"
                name="lastName"
                defaultValue={lastName ?? ""}
                maxLength={60}
                autoComplete="family-name"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              name="username"
              defaultValue={username ?? ""}
              maxLength={USERNAME_MAX}
              autoComplete="username"
              placeholder="yourname"
            />
            <p className="text-xs text-muted-foreground">
              {USERNAME_MIN} to {USERNAME_MAX} characters: letters, numbers, underscores and
              hyphens. This is what other people see. Leave it empty to use your name instead.
            </p>
          </div>
        </ActionForm>

        <div className="mt-5 space-y-2 border-t pt-5">
          <Label>Email</Label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">{email}</span>
            {showVerification &&
              (emailVerified ? (
                <span className="flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success ring-1 ring-inset ring-success/25">
                  <CircleCheck className="size-3" />
                  Confirmed
                </span>
              ) : (
                <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning ring-1 ring-inset ring-warning/25">
                  Not confirmed
                </span>
              ))}
          </div>

          {showVerification && !emailVerified && <ResendVerification />}
        </div>
      </Section>

      <Section title="Password">
        <ActionForm action={changePasswordAction} submit="Change password">
          <div className="space-y-2">
            <Label htmlFor="current">Current password</Label>
            <Input
              id="current"
              name="current"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="next">New password</Label>
            <Input
              id="next"
              name="next"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
            />
            <p className="text-xs text-muted-foreground">
              At least {MIN_PASSWORD_LENGTH} characters. You&apos;ll stay signed in here and be
              signed out everywhere else.
            </p>
          </div>
        </ActionForm>
      </Section>

      <section className="rounded-xl border border-destructive/30 bg-card p-5">
        <h2 className="text-sm font-semibold text-destructive">Close your account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {isMember
            ? "Your subscription is cancelled straight away, your Plex access is removed, and your account is deleted. This can't be undone."
            : "Your account and everything on it is deleted. This can't be undone."}
        </p>

        <Button variant="destructive" size="lg" className="mt-4" onClick={() => setDeleting(true)}>
          Delete my account
        </Button>
      </section>

      <DeleteDialog
        key={`delete-${deleting}`}
        open={deleting}
        onOpenChange={setDeleting}
        email={email}
        isMember={isMember}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** A form bound to a server action, with its own error/success line and a pending button. */
function ActionForm({
  action,
  submit,
  children,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  submit: string;
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

      <Submit label={submit} />
    </form>
  );
}

function Submit({ label }: { label: string }) {
  // Its own component: useFormStatus only reports on a form ABOVE it in the tree, so calling
  // it in the parent would always read as idle.
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" variant="secondary" disabled={pending}>
      {pending && <LoaderCircle className="animate-spin" />}
      {label}
    </Button>
  );
}

function ResendVerification() {
  const [state, formAction] = useActionState<FormState, FormData>(
    async () => resendVerificationAction(),
    null
  );

  return (
    <form action={formAction} className="mt-3">
      {state?.error && <p className="mb-2 text-sm text-destructive">{state.error}</p>}
      {state?.success && <p className="mb-2 text-sm text-success">{state.success}</p>}
      <Submit label="Resend confirmation email" />
    </form>
  );
}

function DeleteDialog({
  open,
  onOpenChange,
  email,
  isMember,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
  isMember: boolean;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(deleteAccountAction, null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>
            This can&apos;t be undone.
            {isMember && " Your subscription is cancelled immediately and access is removed."}
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {state?.error && (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="confirm">
              Type <span className="font-mono text-foreground">{email}</span> to confirm
            </Label>
            {/* Typing the address is deliberate friction. A dialog you can dismiss with a
                reflexive second click is not a confirmation of anything. */}
            <Input id="confirm" name="confirm" autoComplete="off" required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="delete-password">Your password</Label>
            <Input
              id="delete-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="secondary" size="lg">Never mind</Button>} />
            <DeleteSubmit />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" size="lg" disabled={pending}>
      {pending && <LoaderCircle className="animate-spin" />}
      Delete my account
    </Button>
  );
}
