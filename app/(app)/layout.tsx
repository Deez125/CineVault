import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app/app-sidebar";
import { DebugPanel } from "@/components/debug/debug-panel";
import { requireUser, isMemberOrAdmin } from "@/lib/auth";
import type { SessionUser } from "@/lib/auth/session";
import type { NavDots } from "@/components/app/app-sidebar";
import { newestUnreadForUser, newestAwaitingAdmin } from "@/lib/tickets";
import { hasAnyInvite } from "@/lib/referrals";
import { debugAllowed } from "@/lib/debug";

/**
 * The signed-in shell.
 *
 * requireUser() runs here, so every page under this layout is behind the gate by
 * construction rather than by each page remembering to check. Route handlers and server
 * actions still check for themselves — a layout does not protect the data routes.
 */
/**
 * Which sidebar rows are asking for attention.
 *
 * RED means somebody is waiting on you — a ticket with an unread reply. BLUE means something
 * is newly available and untouched, which is why both blue dots clear themselves by being
 * acted on rather than merely by being looked at: link a Plex account, create an invite, and
 * the dot is gone because the thing it pointed at is done.
 *
 * Computed on the server so the first paint is already right. Cheap, but not free — two
 * counts and a lookup per page load — so it lives here rather than in each page.
 */
async function navDots(user: SessionUser): Promise<NavDots> {
  const dots: NavDots = {};
  const seen = user.navSeen ?? {};

  /** Has this section been opened since `at`? A section never opened counts as never seen. */
  const unseenSince = (key: string, at: Date | null) => {
    if (!at) return false;
    const last = seen[key];
    return !last || at.getTime() > new Date(last).getTime();
  };

  // RED comes back whenever a reply is newer than the last visit, so dismissing it once does
  // not silence it forever.
  if (unseenSince("/dashboard/support", await newestUnreadForUser(user.id))) {
    dots["/dashboard/support"] = "red";
  }

  // BLUE is one-time: new until opened. Both also clear themselves by being ACTED on —
  // linking Plex, creating an invite — so the dot never outlives the thing it points at.
  if (isMemberOrAdmin(user)) {
    if (!user.plexUserId && !seen["/dashboard/plex"]) dots["/dashboard/plex"] = "blue";
    if (!seen["/dashboard/referrals"] && !(await hasAnyInvite(user.id))) {
      dots["/dashboard/referrals"] = "blue";
    }
  }

  if (user.isAdmin && unseenSince("/admin/support", await newestAwaitingAdmin())) {
    dots["/admin/support"] = "red";
  }

  return dots;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const dots = await navDots(user);

  return (
    <SidebarProvider>
      <AppSidebar user={user} dots={dots} />

      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
        </header>

        {/* The page container, and the ONLY place a dashboard page's width is decided.
            Pages render their content directly and must not wrap it in their own
            `mx-auto max-w-*`: every one that did left a column of dead space down both
            sides of a wide screen, and four separate opinions about how wide a page should
            be is four places to change when the answer changes. */}
        <div className="w-full flex-1 p-4 md:p-6">{children}</div>
      </SidebarInset>

      {/* Decided on the SERVER. Rendering it conditionally keeps it out of the bundle for
          people who may not use it, and every endpoint behind it re-checks anyway. */}
      {debugAllowed(user) && <DebugPanel />}
    </SidebarProvider>
  );
}
