"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { Check, ChevronsUpDown, LogOut, Monitor, Moon, Palette, Settings, Sun } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logoutAction } from "@/lib/auth/actions";
import type { SessionUser } from "@/lib/auth/session";
import { displayName, initial } from "@/lib/display-name";

/** The account switcher at the bottom of the sidebar. */
export function UserMenu({ user }: { user: SessionUser }) {
  const label = displayName(user);
  const { theme, setTheme } = useTheme();

  // Reads the user's chosen mode (light | dark | system), not the resolved one — the
  // submenu shows the user's SELECTION, so "System" stays highlighted even when it
  // currently resolves to dark or light. Anything else would misrepresent what they picked.
  const chosen = (theme ?? "system") as "light" | "dark" | "system";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm outline-none transition-[colors,padding] duration-200 ease-linear hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/50 group-data-[collapsible=icon]:px-1"
        aria-label="Account menu"
      >
        {/* The avatar shrinks a step when the rail collapses (28px → 24px) so it stays
            in visual proportion to the icon-mode nav buttons alongside it. Left-aligned
            in both states — the trigger's flex layout keeps it at the same x-coordinate
            throughout the collapse transition, no drift toward the middle. */}
        <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-xs font-semibold text-primary-foreground group-data-[collapsible=icon]:size-6">
          {user.avatarUrl ? (
            // Regular <img>, not next/image: the source is a Supabase Storage URL that
            // rotates with a cache-busting timestamp on every re-upload, and the optimizer
            // would either miss those updates (cached transform) or add a hop that doesn't
            // pay for itself on a 28px thumbnail.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatarUrl} alt="" className="size-full object-cover" />
          ) : (
            initial(user)
          )}
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

        {/* The old "Admin" link was a duplicate of the Admin section already in the
            sidebar — same destination, one more click. Removed. */}

        <DropdownMenuSeparator />

        {/* Theme picker as a submenu with the three real states next-themes carries
            (light / dark / system). Each option shows its icon on the left and a checkmark
            on the right for the CURRENTLY-CHOSEN one — chosen, not resolved, because
            "System" should stay marked when picked even though it happens to render dark
            or light at any given moment. */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette />
            Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <ThemeOption
              value="light"
              current={chosen}
              onPick={setTheme}
              icon={<Sun />}
              label="Light"
            />
            <ThemeOption
              value="dark"
              current={chosen}
              onPick={setTheme}
              icon={<Moon />}
              label="Dark"
            />
            <ThemeOption
              value="system"
              current={chosen}
              onPick={setTheme}
              icon={<Monitor />}
              label="System"
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>

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

/**
 * One row in the theme submenu.
 *
 * preventDefault keeps the whole menu open when a row is picked, so the visitor sees the
 * check mark move and the app repaint under the still-open menu. Anything else and they
 * click, everything closes, they wonder if it took, they reopen — worse for what's
 * meant to be a light "toggle" affordance.
 */
function ThemeOption({
  value,
  current,
  onPick,
  icon,
  label,
}: {
  value: "light" | "dark" | "system";
  current: "light" | "dark" | "system";
  onPick: (v: string) => void;
  icon: React.ReactNode;
  label: string;
}) {
  const active = value === current;
  return (
    <DropdownMenuItem onClick={() => onPick(value)}>
      {icon}
      <span className="flex-1">{label}</span>
      {active && <Check className="size-4 opacity-70" />}
    </DropdownMenuItem>
  );
}
