/**
 * The title block at the top of every signed-in page.
 *
 * No icon. The sidebar already shows which page you are on, with its own icon, highlighted —
 * repeating it beside the heading says nothing the reader does not already know and pushes
 * the actual title sideways.
 */
export function PageHeader({
  title,
  subtitle,
  badge,
  action,
}: {
  title: string;
  subtitle?: string;
  badge?: string | number;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {badge !== undefined && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
              {badge}
            </span>
          )}
        </div>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>

      {action}
    </div>
  );
}
