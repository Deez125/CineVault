import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app/app-sidebar";
import { DebugPanel } from "@/components/debug/debug-panel";
import { requireUser } from "@/lib/auth";
import { debugAllowed } from "@/lib/debug";

/**
 * The signed-in shell.
 *
 * requireUser() runs here, so every page under this layout is behind the gate by
 * construction rather than by each page remembering to check. Route handlers and server
 * actions still check for themselves — a layout does not protect the data routes.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <SidebarProvider>
      <AppSidebar user={user} />

      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
        </header>

        <div className="flex-1 p-4 md:p-6">{children}</div>
      </SidebarInset>

      {/* Decided on the SERVER. Rendering it conditionally keeps it out of the bundle for
          people who may not use it, and every endpoint behind it re-checks anyway. */}
      {debugAllowed(user) && <DebugPanel />}
    </SidebarProvider>
  );
}
