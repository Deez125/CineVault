"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { initial, type Nameable } from "@/lib/display-name";
import { updateAvatarAction } from "@/lib/auth/account-actions";
import type { FormState } from "@/lib/auth/actions";

/**
 * The avatar row in Settings.
 *
 * Auto-submits on file choice — a settings-style row with a Save button on TOP of the
 * profile form's Save button would need explanation about which Save affects which field.
 * The picture is one round-trip on its own.
 */
export function AvatarField({
  avatarUrl,
  user,
}: {
  avatarUrl: string | null;
  user: Nameable;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    updateAvatarAction,
    null
  );
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<string | null>(avatarUrl);
  const fileRef = useRef<HTMLInputElement>(null);

  // Actions return either an error to display or a success message to toast. Toast on
  // success keeps the row itself uncluttered; the picture visibly updated is confirmation.
  useEffect(() => {
    if (state?.success) toast.success(state.success);
    if (state?.error) toast.error(state.error);
  }, [state]);

  function onFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setPreview(URL.createObjectURL(file));

    const formData = new FormData();
    formData.set("avatar", file);
    startTransition(() => formAction(formData));

    // Reset the input so choosing the same file twice still fires onChange.
    event.target.value = "";
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-4">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={pending}
        className={cn(
          "group relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-xl font-semibold text-primary-foreground",
          "outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
          pending && "cursor-wait opacity-70"
        )}
        aria-label="Change profile picture"
      >
        {preview ? (
          // Regular <img>: same reason as the sidebar — Supabase Storage URL with a
          // cache-busting query, and the optimizer would either miss the update or add a
          // hop that doesn't pay for itself on a 64px thumbnail.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="size-full object-cover" />
        ) : (
          <span aria-hidden>{initial(user)}</span>
        )}

        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center bg-black/40 text-white transition-opacity",
            pending
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
          )}
          aria-hidden
        >
          {pending ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />}
        </span>
      </button>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={onFileChosen}
      />

      <div>
        <p className="text-sm font-medium">Profile picture</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          PNG, JPEG or WebP. Up to 10 MB.
        </p>
      </div>
    </div>
  );
}
