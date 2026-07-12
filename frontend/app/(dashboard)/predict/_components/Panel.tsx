import { cn } from "@/lib/utils";

export function Panel({
  id,
  title,
  subtitle,
  actions,
  className,
  children,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={cn("rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-soft)] sm:p-6", className)}>
      <div className="mb-5 flex items-start justify-between gap-4 border-b border-border/60 pb-4">
        <div>
          <h3 className="font-display text-base font-semibold tracking-tight text-foreground">{title}</h3>
          {subtitle && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function Label({ children, htmlFor, id }: { children: React.ReactNode; htmlFor?: string; id?: string }) {
  const className = "mb-2 block text-sm font-semibold text-foreground";
  return htmlFor ? (
    <label id={id} htmlFor={htmlFor} className={className}>{children}</label>
  ) : (
    <span id={id} className={className}>{children}</span>
  );
}
