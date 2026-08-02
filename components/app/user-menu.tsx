"use client";

import Link from "next/link";
import { ChevronsUpDown, LogOut, Settings, Shield } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logoutAction } from "@/lib/auth/actions";
import type { SessionUser } from "@/lib/auth/session";
import { displayName, initial } from "@/lib/display-name";

/** The account switcher at the bottom of the sidebar. */
export function UserMenu({ user }: { user: SessionUser }) {
  const label = displayName(user);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label="Account menu"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {initial(user)}
        </span>
        <span className="min-w-0 flex-1 truncate group-data-[collapsible=icon]:hidden">
          {label}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 opacity-50 group-data-[collapsible=icon]:hidden" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" side="top" className="w-56">
        <div className="px-2 py-1.5">
          <p className="truncate text-sm font-medium">{label}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem render={<Link href="/dashboard/settings" />}>
          <Settings />
          Settings
        </DropdownMenuItem>

        {user.isAdmin && (
          <DropdownMenuItem render={<Link href="/admin" />}>
            <Shield />
            Admin
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        {/* A form, not an onClick. Signing out changes server state, so it must be a POST:
            a GET link would let any page on the internet sign someone out with an <img>. */}
        <form action={logoutAction}>
          <DropdownMenuItem
            variant="destructive"
            render={<button type="submit" className="w-full" />}
          >
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
