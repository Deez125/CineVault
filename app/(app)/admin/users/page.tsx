import Link from "next/link";
import type { Metadata } from "next";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/app/page-header";
import { UsersTable } from "./users-table";
import { listUsers, type UserFilter } from "@/lib/admin";
import { requireAdmin } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Users" };

const FILTERS: { value: UserFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "members", label: "Members" },
  { value: "unlinked", label: "Awaiting link" },
  { value: "inactive", label: "Inactive" },
  { value: "banned", label: "Banned" },
];

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string }>;
}) {
  const admin = await requireAdmin();
  const params = await searchParams;

  const filter = (FILTERS.find((f) => f.value === params.filter)?.value ?? "all") as UserFilter;
  const search = params.q ?? "";

  const users = await listUsers({ search, filter });

  return (
    <>
      <PageHeader title="Users" subtitle="Everyone with an account" badge={users.length} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* A plain GET form. Search that survives a reload, is linkable, and works without
            JavaScript is worth more here than one that filters as you type. */}
        <form className="relative flex-1 sm:max-w-xs" action="/admin/users">
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={search}
            placeholder="Email, name or Plex username"
            className="pl-9"
            aria-label="Search accounts"
          />
        </form>

        <nav className="flex flex-wrap gap-1.5">
          {FILTERS.map((option) => {
            const active = option.value === filter;
            const query = new URLSearchParams();
            if (option.value !== "all") query.set("filter", option.value);
            if (search) query.set("q", search);
            const href = `/admin/users${query.size ? `?${query}` : ""}`;

            return (
              <Link
                key={option.value}
                href={href}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "border-primary bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {option.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <UsersTable users={users} selfId={admin.id} />
    </>
  );
}
