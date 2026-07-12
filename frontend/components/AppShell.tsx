"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3,
  Building2,
  CalendarRange,
  ChevronDown,
  ClipboardList,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_GROUPS = [
  {
    label: "Decide",
    items: [
      { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
      { to: "/predict", label: "Predict", icon: Sparkles, core: true },
      { to: "/calendar", label: "Content plan", icon: CalendarRange },
    ],
  },
  {
    label: "Learn",
    items: [
      { to: "/insights", label: "Published results", icon: BarChart3 },
      { to: "/history", label: "Prediction ledger", icon: History },
    ],
  },
  {
    label: "Manage",
    items: [
      { to: "/niches", label: "Brands", icon: Building2 },
      { to: "/model-health", label: "Research evidence", icon: ClipboardList },
    ],
  },
] as const;

const PAGE_CONTEXT: Record<string, { title: string; description: string }> = {
  "/dashboard": { title: "Overview", description: "Your content decision workspace" },
  "/predict": { title: "Predict", description: "Evaluate a draft before publishing" },
  "/calendar": { title: "Content plan", description: "Plan, evaluate, and learn" },
  "/insights": { title: "Published results", description: "Learn from verified outcomes" },
  "/history": { title: "Prediction ledger", description: "Review every decision version" },
  "/niches": { title: "Brands", description: "Connections, data, and readiness" },
  "/model-health": { title: "Research evidence", description: "Scientific evaluation records" },
};

const THEME_STORAGE_KEY = "faiv-theme";
const MOTION = { duration: 0.2, ease: [0.2, 0, 0, 1] as const };

function isActive(pathname: string, to: string) {
  return pathname === to || (to !== "/dashboard" && pathname.startsWith(to));
}

function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-foreground text-sm font-bold text-background shadow-sm">
        F
      </div>
      {!compact && (
        <div className="min-w-0 leading-tight">
          <div className="font-display text-sm font-bold tracking-[-0.02em]">FAIV Predict</div>
          <div className="mt-0.5 text-[11px] font-medium text-muted-foreground">Content intelligence</div>
        </div>
      )}
    </div>
  );
}

function Navigation({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Primary navigation" className="flex-1 overflow-y-auto px-3 py-5">
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="mb-6 last:mb-0">
          <div className="mb-2 px-3 text-[11px] font-semibold text-muted-foreground">{group.label}</div>
          <ul className="space-y-1">
            {group.items.map((item) => {
              const active = isActive(pathname, item.to);
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <Link
                    href={item.to}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex min-h-11 items-center gap-3 rounded-xl px-3 text-[13px] font-semibold transition-[background-color,color,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
                      active
                        ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                        : "text-sidebar-foreground/72 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    )}
                  >
                    <Icon
                      aria-hidden="true"
                      className={cn(
                        "h-[17px] w-[17px] shrink-0",
                        active ? "text-sidebar-primary-foreground" : "text-muted-foreground group-hover:text-sidebar-foreground",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {"core" in item && item.core && !active && (
                      <span className="text-[10px] font-semibold text-primary">Core</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function UserMenuPanel({
  displayName,
  userEmail,
  onLogout,
  className,
}: {
  displayName: string;
  userEmail: string;
  onLogout: () => void;
  className?: string;
}) {
  return (
    <motion.div
      role="menu"
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
        role="menuitem"
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
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [userEmail, setUserEmail] = React.useState("");
  const mobileTriggerRef = React.useRef<HTMLButtonElement>(null);
  const mobileCloseRef = React.useRef<HTMLButtonElement>(null);
  const mobileNavRef = React.useRef<HTMLElement>(null);
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

  React.useEffect(() => {
    if (!mobileOpen) return;
    const mobileTrigger = mobileTriggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    mobileCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        mobileNavRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      mobileTrigger?.focus();
    };
  }, [mobileOpen]);

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
        className="sr-only fixed left-3 top-3 z-[100] rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background focus:not-sr-only"
      >
        Skip to main content
      </a>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex md:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={MOTION}
          >
            <button
              type="button"
              aria-label="Close navigation"
              className="fixed inset-0 bg-foreground/30"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              ref={mobileNavRef}
              id="mobile-navigation"
              initial={{ x: -24 }}
              animate={{ x: 0 }}
              exit={{ x: -24 }}
              transition={MOTION}
              className="relative flex h-full w-[286px] max-w-[88vw] flex-col border-r border-sidebar-border bg-sidebar shadow-[var(--shadow-elevated)]"
            >
              <div className="flex h-[72px] items-center justify-between border-b border-sidebar-border px-4">
                <BrandLockup />
                <button
                  ref={mobileCloseRef}
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className="grid h-10 w-10 place-items-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Close menu"
                >
                  <X aria-hidden="true" className="h-5 w-5" />
                </button>
              </div>
              <Navigation pathname={pathname} onNavigate={() => setMobileOpen(false)} />
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex min-w-0">
        <aside className="sticky top-0 hidden h-[100dvh] w-[240px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
          <div className="flex h-[72px] shrink-0 items-center border-b border-sidebar-border px-5">
            <BrandLockup />
          </div>
          <Navigation pathname={pathname} />
          <div ref={sidebarUserRef} className="relative shrink-0 border-t border-sidebar-border p-3">
            <AnimatePresence>
              {sidebarUserOpen && (
                <UserMenuPanel
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
              aria-haspopup="menu"
              className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-foreground text-xs font-bold text-background">{avatarInitial}</div>
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
              <button
                ref={mobileTriggerRef}
                type="button"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation"
                aria-expanded={mobileOpen}
                aria-controls="mobile-navigation"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
              >
                <Menu aria-hidden="true" className="h-5 w-5" />
              </button>
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
                  className={cn(buttonVariants({ size: "sm" }), "h-10 px-3 sm:px-4")}
                  aria-label="Start a new content prediction"
                >
                  <Sparkles aria-hidden="true" className="h-4 w-4" />
                  <span className="hidden sm:inline">New prediction</span>
                </Link>
              )}
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
                  aria-haspopup="menu"
                  className="grid h-10 w-10 place-items-center rounded-[10px] bg-foreground text-xs font-bold text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <span aria-hidden="true">{avatarInitial}</span>
                  <span className="sr-only">Open account menu</span>
                </button>
                <AnimatePresence>
                  {topbarUserOpen && (
                    <UserMenuPanel
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

          <main id="main-content" tabIndex={-1} key={pathname} className="page-enter min-w-0 flex-1">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
