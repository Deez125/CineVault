"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { Camera, Loader2, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { USERNAME_MAX, USERNAME_MIN, checkUsername, initial } from "@/lib/display-name";
import { setupAction, type SetupState } from "./actions";

/**
 * Setup form.
 *
 * File input renders as a clickable avatar preview because a naked `<input type=file>` is
 * both ugly and unclear here — the goal is a picture of you, not a file. The preview reads
 * the chosen file via URL.createObjectURL so the user sees the crop before submitting.
 *
 * Submits everything (avatar included) as multipart FormData through a server action. The
 * action does the upload to Supabase Storage server-side using the service-role key — the
 * browser never talks to Storage directly, which means we do not need per-row RLS policies
 * to protect other users' avatars, and the file size limit is enforced somewhere the client
 * cannot bypass.
 */
export function SetupForm({
  email,
  firstName,
  lastName,
  username,
  avatarUrl,
}: {
  email: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  avatarUrl: string | null;
}) {
  const [state, formAction] = useActionState<SetupState, FormData>(setupAction, null);
  const [pending, startTransition] = useTransition();

  const [preview, setPreview] = useState<string | null>(avatarUrl);
  const [firstDraft, setFirstDraft] = useState(firstName ?? "");
  const [usernameDraft, setUsernameDraft] = useState(username ?? "");
  const fileRef = useRef<HTMLInputElement>(null);

  const usernameProblem =
    usernameDraft.trim().length > 0 ? checkUsername(usernameDraft) : null;

  // The initial for the placeholder — computed from whatever fields the visitor has already
  // typed, so it updates as they go rather than being frozen to the empty initial they had
  // when the page loaded.
  const placeholderInitial = initial({
    email,
    firstName: firstDraft || firstName,
    lastName,
    username: usernameDraft || username,
  });

  function onFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
  }

  function handleSubmit(formData: FormData) {
    startTransition(() => formAction(formData));
  }

  return (
    <form action={handleSubmit} className="space-y-5">
      {state?.error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className={cn(
            "group relative flex size-24 items-center justify-center overflow-hidden rounded-full bg-primary text-3xl font-semibold text-primary-foreground",
            "outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
            "sm:size-28"
          )}
          aria-label="Choose a profile picture"
        >
          {preview ? (
            // The whole point is a picture of them, so <img> is the right tag here — no
            // next/image because the source is a blob: URL during preview or a Supabase
            // public URL after upload, neither of which want the optimizer in the middle.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="size-full object-cover" />
          ) : (
            <span aria-hidden>{placeholderInitial}</span>
          )}

          <span
            className={cn(
              "absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 transition-opacity",
              "group-hover:opacity-100 group-focus-visible:opacity-100"
            )}
            aria-hidden
          >
            <Camera className="size-6" />
          </span>
        </button>

        <input
          ref={fileRef}
          name="avatar"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={onFileChosen}
        />

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="text-xs text-muted-foreground underline underline-offset-2"
        >
          {preview ? "Change photo" : "Add a photo (optional)"}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="firstName">First name</Label>
          <Input
            id="firstName"
            name="firstName"
            defaultValue={firstName ?? ""}
            onChange={(e) => setFirstDraft(e.target.value)}
            required
            autoComplete="given-name"
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Last name</Label>
          <Input
            id="lastName"
            name="lastName"
            defaultValue={lastName ?? ""}
            required
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
          onChange={(e) => setUsernameDraft(e.target.value)}
          required
          minLength={USERNAME_MIN}
          maxLength={USERNAME_MAX}
          autoComplete="off"
          aria-invalid={Boolean(usernameProblem)}
          placeholder="yourname"
        />
        <p
          className={cn(
            "text-xs",
            usernameProblem ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {usernameProblem ??
            `${USERNAME_MIN}–${USERNAME_MAX} characters. Letters, numbers, underscores and hyphens.`}
        </p>
      </div>

      <Button type="submit" className="w-full" disabled={pending || Boolean(usernameProblem)}>
        {pending ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            Saving
          </>
        ) : (
          "Continue"
        )}
      </Button>
    </form>
  );
}
