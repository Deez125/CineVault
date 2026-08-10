"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  CreditCard,
  Gift,
  LayoutGrid,

  Megaphone,
  MessageSquare,
  Play,
  Settings,
  ShieldCheck,
  SlidersHorizontal,

  Users,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { UserMenu } from "./user-menu";
import type { SessionUser } from "@/lib/auth/session";

/**
 * The signed-in navigation.
 *
 * Two sections: what a member does with their own account, and — for admins only — what an
 * admin does with everyone else's. Keeping them apart matters more than it looks: an admin is
 * also a customer, and "Settings" meaning your own password in one place and the service's
 * configuration in another is exactly the kind of ambiguity that gets something changed
 * globally when somebody meant to change it for themselves.
 *
 * Every destination the product will have is listed from day one, with the unbuilt ones
 * marked "Soon" and not clickable. The shape of the app then stops moving under people every
 * time something ships.
 */

/**
 * A notification dot. Presence means "something here wants you", colour says what kind.
 *
 * Deliberately a dot and not a count. A number implies you can clear it by reading exactly
 * that many things, which is a promise the sidebar cannot keep — and an unread ticket and a
 * newly unlocked page are not quantities of the same thing.
 */
export type NavDot = "red" | "blue";

/** Which item a dot belongs to, keyed by href so the layout never repeats a label. */
export type NavDots = Record<string, NavDot | undefined>;

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutGrid;
  soon?: boolean;
  /** Only visible to somebody with a live plan. */
  member?: boolean;
};

/**
 * `member: true` means a plan buys it.
 *
 * Those pages 404 for anybody without one, so listing them would be a link to a dead end.
 * Hidden rather than shown-and-disabled: an account that has not paid yet is not missing a
 * feature, it just has a smaller app until it does.
 */
const ACCOUNT_NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutGrid },
  { href: "/dashboard/plex", label: "Plex", icon: Play, member: true },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
  { href: "/dashboard/support", label: "Support", icon: MessageSquare },
  { href: "/dashboard/referrals", label: "Referrals", icon: Gift, member: true },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Overview", icon: ShieldCheck },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/support", label: "Support inbox", icon: MessageSquare },
  { href: "/admin/announcements", label: "Announcements", icon: Megaphone },
  { href: "/admin/activity", label: "Activity log", icon: Activity },
  { href: "/admin/settings", label: "Service settings", icon: SlidersHorizontal },
];

export function AppSidebar({ user, dots }: { user: SessionUser; dots?: NavDots }) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();

  // Close the mobile sheet AFTER the route has actually changed, not during the click that
  // caused it. Closing in the click handler unmounts the <Link> before its own navigation runs
  // and the tap lands on nothing. Watching pathname means the sheet closes once the new page
  // has taken over. Skipped on the first render so opening the sheet on the current page does
  // not immediately close it.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (isMobile) setOpenMobile(false);
  }, [pathname, isMobile, setOpenMobile]);

  /**
   * Rows whose dot has been cleared in this browser already.
   *
   * Local state as well as the server write, so the dot goes the instant it is clicked rather
   * than on whatever the next full render happens to be. The write is what makes it stick;
   * this is what makes it feel like it worked.
   */
  const [dismissed, setDismissed] = useState<string[]>([]);

  const dotFor = (href: string) =>
    href === pathname || dismissed.includes(href) ? undefined : dots?.[href];

  // Purely cosmetic, and deliberately so. The page itself records the visit server-side
  // when it renders, which is what makes it durable and works without JavaScript; this only
  // removes the dot the instant it is clicked, rather than after the navigation completes.
  function dismiss(href: string) {
    if (!dots?.[href] || dismissed.includes(href)) return;
    setDismissed((prev) => [...prev, href]);
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link href="/" className="flex items-center gap-2.5 px-2 py-1.5">
          <Image src="/logo.png" alt="" width={26} height={26} className="shrink-0 rounded-md" />
          <span className="truncate text-base font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            CineVault
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {ACCOUNT_NAV.filter((item) => !item.member || user.isMember || user.isAdmin).map((item) => (
                <NavRow
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  exact={item.href === "/dashboard"}
                  dot={dotFor(item.href)}
                  onSeen={dismiss}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {user.isAdmin && (
          <SidebarGroup>
            {/* Hidden when the rail is collapsed to icons, where a text heading has nowhere
                to go. The separation still reads, because the groups keep their spacing. */}
            <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden">
              Admin
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {ADMIN_NAV.map((item) => (
                  <NavRow
                    key={item.href}
                    item={item}
                    pathname={pathname}
                    exact={item.href === "/admin"}
                    dot={dotFor(item.href)}
                    onSeen={dismiss}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col">
          <UserMenu user={user} />
          <ThemeToggle className="shrink-0" />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

function NavRow({
  item,
  pathname,
  exact,
  dot,
  onSeen,
}: {
  item: NavItem;
  pathname: string;
  exact: boolean;
  dot?: NavDot;
  onSeen: (href: string) => void;
}) {
  // Section roots match exactly, everything else by prefix. Otherwise /admin/users would
  // light up "Admin Overview" as well as itself.
  const active = exact ? pathname === item.href : pathname.startsWith(item.href);

  if (item.soon) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton disabled className="opacity-50">
          <item.icon />
          <span>{item.label}</span>
        </SidebarMenuButton>
        <SidebarMenuBadge className="group-data-[collapsible=icon]:hidden">Soon</SidebarMenuBadge>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        tooltip={item.label}
        onClick={() => onSeen(item.href)}
        render={<Link href={item.href} />}
      >
        <item.icon />
        <span>{item.label}</span>
        {dot && <Dot tone={dot} />}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * The dot.
 *
 * `ml-auto` puts it at the trailing edge of the row, and it survives the rail collapsing to
 * icons — where the label is hidden but the dot is not, so a collapsed sidebar still shows
 * that something is waiting.
 */
function Dot({ tone }: { tone: NavDot }) {
  return (
    <span
      aria-hidden
      className={cn(
        "ml-auto size-2 shrink-0 rounded-full",
        "group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:right-1.5 group-data-[collapsible=icon]:top-1.5 group-data-[collapsible=icon]:ml-0",
        tone === "red" ? "bg-destructive" : "bg-primary"
      )}
    />
  );
}
