export function Panel({
  id,
  title,
  subtitle,
  actions,
  children,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4 border-b border-border/60 pb-3">
        <div>
          <h3 className="font-display text-xs font-bold tracking-tight text-foreground uppercase">{title}</h3>
          {subtitle && <p className="mt-1 text-[10px] text-muted-foreground leading-relaxed">{subtitle}</p>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground/80 mb-1.5">
      {children}
    </div>
  );
}
