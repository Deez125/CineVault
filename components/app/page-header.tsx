import type { LucideIcon } from "lucide-react";

/** The title block at the top of every signed-in page. */
export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  badge,
  action,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  badge?: string | number;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon className="size-5 text-muted-foreground" />
        </span>

        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {badge !== undefined && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                {badge}
              </span>
            )}
          </div>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>

      {action}
    </div>
  );
}
