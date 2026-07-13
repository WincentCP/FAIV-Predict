"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3,
  CalendarDays,
  ChevronDown,
  Home,
  LogOut,
  Moon,
  Sparkles,
  Sun,
  Users,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { buttonVariants } from "@/components/ui/button";
import { GlossaryPopover } from "@/components/GlossaryPopover";
import { cn } from "@/lib/utils";

const NAV_ITEMS: ReadonlyArray<{ to: string; label: string; icon: LucideIcon }> = [
  { to: "/dashboard", label: "Home", icon: Home },
  { to: "/predict", label: "Predict", icon: Sparkles },
  { to: "/calendar", label: "Planner", icon: CalendarDays },
  { to: "/results", label: "Results", icon: BarChart3 },
  { to: "/brands", label: "Brands", icon: Users },
];

const PAGE_CONTEXT: Record<string, { title: string; description: string }> = {
  "/dashboard": { title: "Home", description: "Your workspace at a glance" },
  "/predict": { title: "Predict", description: "Estimate performance before publishing" },
  "/calendar": { title: "Planner", description: "Plan upcoming content" },
  "/results": { title: "Results", description: "Published posts and prediction outcomes" },
  "/brands": { title: "Brands", description: "Workspaces, connections, and model quality" },
};

const THEME_STORAGE_KEY = "faiv-theme";
const MOTION = { duration: 0.2, ease: [0.2, 0, 0, 1] as const };

function isActive(pathname: string, to: string) {
  return pathname === to || (to !== "/dashboard" && pathname.startsWith(to));
}

function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <div className="min-w-0 leading-tight">
      <div className="font-display text-sm font-bold tracking-[-0.025em] text-primary">FAIV Predict</div>
      {!compact && (
        <div>
          <div className="mt-0.5 text-[11px] font-medium text-muted-foreground">Creative partner</div>
        </div>
      )}
    </div>
  );
}

function SidebarNavigation({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Primary navigation" className="flex-1 overflow-y-auto px-3 py-5">
      <ul className="space-y-1.5">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.to);
          const Icon = item.icon;
          return (
            <li key={item.to}>
              <Link
                href={item.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex min-h-11 items-center gap-3 rounded-xl border-l-4 px-3 text-[13px] transition-[background-color,color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
                  active
                    ? "border-primary bg-primary/[0.07] font-bold text-primary"
                    : "border-transparent font-semibold text-sidebar-foreground/72 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                )}
              >
                <Icon
                  aria-hidden="true"
                  className={cn("h-[18px] w-[18px] shrink-0", active ? "text-primary" : "text-muted-foreground group-hover:text-sidebar-foreground")}
                  strokeWidth={active ? 2.4 : 2}
                />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function MobileBottomNav({ pathname }: { pathname: string }) {
  return (
    <nav
      aria-label="Primary navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <ul className="flex h-16 items-stretch justify-around">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.to);
          const Icon = item.icon;
          return (
            <li key={item.to} className="min-w-0 flex-1">
              <Link
                href={item.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-full flex-col items-center justify-center gap-1 text-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  active ? "font-bold text-primary" : "font-medium text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid h-7 w-12 place-items-center rounded-full transition-colors",
                    active && "bg-primary/[0.1]",
                  )}
                >
                  <Icon aria-hidden="true" className="h-[19px] w-[19px]" strokeWidth={active ? 2.4 : 2} />
                </span>
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function UserMenuPanel({
  id,
  displayName,
  userEmail,
  onLogout,
  className,
}: {
  id: string;
  displayName: string;
  userEmail: string;
  onLogout: () => void;
  className?: string;
}) {
  return (
    <motion.div
      id={id}
      initial={{ opacity: 0, y: 4, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={MOTION}
      className={cn("z-50 rounded-xl border border-border bg-popover p-1.5 shadow-[var(--shadow-elevated)]", className)}
    >
      <div className="border-b border-border px-3 py-2.5">
        <div className="truncate text-sm font-semibold text-foreground">{displayName}</div>
        <div className="mt-0.5 max-w-[220px] truncate text-xs text-muted-foreground">{userEmail || "Email unavailable"}</div>
      </div>
      <button
        type="button"
        onClick={onLogout}
        className="mt-1 flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-medium text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <LogOut aria-hidden="true" className="h-4 w-4" />
        Sign out
      </button>
    </motion.div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [theme, setTheme] = React.useState<"dark" | "light">("light");
  const [themeReady, setThemeReady] = React.useState(false);
  const [sidebarUserOpen, setSidebarUserOpen] = React.useState(false);
  const [topbarUserOpen, setTopbarUserOpen] = React.useState(false);
  const [userEmail, setUserEmail] = React.useState("");
  const sidebarUserRef = React.useRef<HTMLDivElement>(null);
  const topbarUserRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setUserEmail(data?.user?.email ?? ""));
  }, []);

  React.useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
    setThemeReady(true);
  }, []);

  React.useEffect(() => {
    if (!themeReady) return;
    const root = document.documentElement;
    root.classList.remove("dark", "light");
    root.classList.add(theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme, themeReady]);

  React.useEffect(() => {
    function closeMenus(event: MouseEvent) {
      if (!sidebarUserRef.current?.contains(event.target as Node)) setSidebarUserOpen(false);
      if (!topbarUserRef.current?.contains(event.target as Node)) setTopbarUserOpen(false);
    }
    function closeMenusWithKeyboard(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setSidebarUserOpen(false);
      setTopbarUserOpen(false);
    }
    document.addEventListener("mousedown", closeMenus);
    document.addEventListener("keydown", closeMenusWithKeyboard);
    return () => {
      document.removeEventListener("mousedown", closeMenus);
      document.removeEventListener("keydown", closeMenusWithKeyboard);
    };
  }, []);

  const displayName = userEmail ? userEmail.split("@")[0] : "Account";
  const avatarInitial = displayName.charAt(0).toUpperCase() || "?";
  const pageContext = PAGE_CONTEXT[pathname] ?? PAGE_CONTEXT[Object.keys(PAGE_CONTEXT).find((key) => pathname.startsWith(key)) ?? "/dashboard"];

  async function handleLogout() {
    setSidebarUserOpen(false);
    setTopbarUserOpen(false);
    try {
      await createClient().auth.signOut();
    } finally {
      router.push("/");
    }
  }

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only fixed left-3 top-3 z-[100] rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground focus:not-sr-only"
      >
        Skip to main content
      </a>

      <div className="flex min-w-0">
        <aside className="sticky top-0 hidden h-[100dvh] w-[240px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
          <div className="flex h-[72px] shrink-0 items-center border-b border-sidebar-border px-5">
            <BrandLockup />
          </div>
          <SidebarNavigation pathname={pathname} />
          <div ref={sidebarUserRef} className="relative shrink-0 border-t border-sidebar-border p-3">
            <AnimatePresence>
              {sidebarUserOpen && (
                <UserMenuPanel
                  id="sidebar-account-panel"
                  displayName={displayName}
                  userEmail={userEmail}
                  onLogout={handleLogout}
                  className="absolute bottom-full left-3 right-3 mb-2"
                />
              )}
            </AnimatePresence>
            <button
              type="button"
              onClick={() => setSidebarUserOpen((open) => !open)}
              aria-expanded={sidebarUserOpen}
              aria-controls="sidebar-account-panel"
              className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-primary text-xs font-bold text-primary-foreground">{avatarInitial}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-sidebar-foreground">{displayName}</div>
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{userEmail || "Signed in"}</div>
              </div>
              <ChevronDown aria-hidden="true" className={cn("h-4 w-4 text-muted-foreground transition-transform", sidebarUserOpen && "rotate-180")} />
            </button>
          </div>
        </aside>

        <div className="flex min-h-[100dvh] min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-[72px] shrink-0 items-center justify-between border-b border-border bg-surface/95 px-4 backdrop-blur-md sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="md:hidden"><BrandLockup compact /></div>
              <div className="hidden min-w-0 md:block">
                <div className="truncate text-sm font-semibold text-foreground">{pageContext.title}</div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">{pageContext.description}</div>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {pathname !== "/predict" && (
                <Link
                  href="/predict"
                  className={cn(buttonVariants({ size: "sm" }), "hidden h-10 rounded-full px-4 sm:inline-flex")}
                  aria-label="Start a new content prediction"
                >
                  <span>New prediction</span>
                </Link>
              )}
              <GlossaryPopover />
              <button
                type="button"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="grid h-10 w-10 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              >
                {theme === "dark" ? <Sun aria-hidden="true" className="h-[18px] w-[18px]" /> : <Moon aria-hidden="true" className="h-[18px] w-[18px]" />}
              </button>
              <div ref={topbarUserRef} className="relative md:hidden">
                <button
                  type="button"
                  onClick={() => setTopbarUserOpen((open) => !open)}
                  aria-expanded={topbarUserOpen}
                  aria-controls="mobile-account-panel"
                  className="grid h-10 w-10 place-items-center rounded-[10px] bg-primary text-xs font-bold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <span aria-hidden="true">{avatarInitial}</span>
                  <span className="sr-only">Open account menu</span>
                </button>
                <AnimatePresence>
                  {topbarUserOpen && (
                    <UserMenuPanel
                      id="mobile-account-panel"
                      displayName={displayName}
                      userEmail={userEmail}
                      onLogout={handleLogout}
                      className="absolute right-0 top-full mt-2 w-56"
                    />
                  )}
                </AnimatePresence>
              </div>
            </div>
          </header>

          <main id="main-content" tabIndex={-1} key={pathname} className="page-enter min-w-0 flex-1 pb-20 md:pb-0">
            {children}
          </main>
        </div>
      </div>

      <MobileBottomNav pathname={pathname} />
    </div>
  );
}
