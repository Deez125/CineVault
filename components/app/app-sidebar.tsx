"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
} from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
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

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutGrid;
  soon?: boolean;
};

const ACCOUNT_NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutGrid },
  { href: "/dashboard/plex", label: "Plex", icon: Play },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
  { href: "/dashboard/support", label: "Support", icon: MessageSquare },
  { href: "/dashboard/referrals", label: "Referrals", icon: Gift },
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

export function AppSidebar({ user }: { user: SessionUser }) {
  const pathname = usePathname();

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
              {ACCOUNT_NAV.map((item) => (
                <NavRow key={item.href} item={item} pathname={pathname} exact={item.href === "/dashboard"} />
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
}: {
  item: NavItem;
  pathname: string;
  exact: boolean;
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
      <SidebarMenuButton isActive={active} tooltip={item.label} render={<Link href={item.href} />}>
        <item.icon />
        <span>{item.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
