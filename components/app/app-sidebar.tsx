"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CreditCard,
  Gift,
  LayoutGrid,
  ListVideo,
  MessageCircle,
  Play,
  Settings,
  Shield,
  Sparkles,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
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
 * Every destination the product will eventually have is listed from day one, with the
 * unbuilt ones marked "Soon" and not clickable. Two reasons: the shape of the app stops
 * moving under people every time something ships, and it is honest about what is coming
 * rather than pretending the product is only ever what exists today.
 */

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutGrid;
  soon?: boolean;
  adminOnly?: boolean;
};

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutGrid },
  { href: "/dashboard/plex", label: "Plex", icon: Play },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
  { href: "/dashboard/recently-added", label: "Recently added", icon: Sparkles, soon: true },
  { href: "/dashboard/requests", label: "Requests", icon: ListVideo, soon: true },
  { href: "/dashboard/support", label: "Support", icon: MessageCircle, soon: true },
  { href: "/dashboard/referrals", label: "Referrals", icon: Gift, soon: true },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
  { href: "/admin", label: "Admin", icon: Shield, adminOnly: true, soon: true },
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
              {NAV.filter((item) => !item.adminOnly || user.isAdmin).map((item) => {
                // Exact match for the overview, prefix match for everything else, or every
                // page would light up "Overview" as well as itself.
                const active =
                  item.href === "/dashboard"
                    ? pathname === "/dashboard"
                    : pathname.startsWith(item.href);

                if (item.soon) {
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton disabled className="opacity-50">
                        <item.icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                      <SidebarMenuBadge className="group-data-[collapsible=icon]:hidden">
                        Soon
                      </SidebarMenuBadge>
                    </SidebarMenuItem>
                  );
                }

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={item.label}
                      render={<Link href={item.href} />}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
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
