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
          {subtitle && <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{subtitle}</p>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Label({ children, htmlFor, id }: { children: React.ReactNode; htmlFor?: string; id?: string }) {
  const className = "mb-1.5 block text-xs font-bold text-muted-foreground";
  return htmlFor ? (
    <label id={id} htmlFor={htmlFor} className={className}>{children}</label>
  ) : (
    <span id={id} className={className}>{children}</span>
  );
}
