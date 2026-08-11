import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/session";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Set up your profile" };

/**
 * Everybody sees this once, right after their first sign-in.
 *
 * The proxy sends any signed-in visitor with `setup_complete = false` here. If they somehow
 * reach this page after setup is done, we send them on rather than showing the form again.
 * If they aren't signed in at all, they belong at /login — the form has no meaning without
 * an account to attach the values to.
 */
export default async function SetupPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/setup");
  if (user.setupComplete) redirect("/dashboard");

  return (
    <>
      <div className="mb-6 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Set up your profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A few details before you get started.
        </p>
      </div>

      <SetupForm
        email={user.email}
        firstName={user.firstName}
        lastName={user.lastName}
        username={user.username}
        avatarUrl={user.avatarUrl}
      />
    </>
  );
}
