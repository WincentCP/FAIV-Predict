"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  LayoutDashboard,
  Sparkles,
  CalendarRange,
  History,
  BarChart3,
  Building2,
  Sun,
  Moon,
  ChevronDown,
  LogOut,
  Menu,
  X,
  Cpu,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_GROUPS = [
  {
    label: "Workspace",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/predict", label: "Prediction", icon: Sparkles },
      { to: "/calendar", label: "Content Plan", icon: CalendarRange },
      { to: "/history", label: "History", icon: History },
      { to: "/insights", label: "Insights", icon: BarChart3 },
    ],
  },
  {
    label: "Administrator",
    items: [
      { to: "/niches", label: "Brands & Cohorts", icon: Building2 },
      { to: "/model-health", label: "Research Evidence", icon: Cpu },
    ],
  },
] as const;

const THEME_STORAGE_KEY = "faiv-theme";

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
    <div
      role="menu"
      className={cn(
        "z-50 rounded-xl border border-border bg-surface p-1.5 shadow-[var(--shadow-elevated)] backdrop-blur animate-[page-enter_0.15s_ease-out]",
        className
      )}
    >
      <div className="flex flex-col gap-0.5">
        <div className="px-2.5 py-1.5 border-b border-border/40 mb-1">
          <div className="text-xs font-semibold text-foreground">{displayName}</div>
          <div className="max-w-[180px] truncate text-xs text-muted-foreground">{userEmail || "Email unavailable"}</div>
        </div>
        <button
          type="button"
          role="menuitem"
          onClick={onLogout}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-semibold text-destructive hover:bg-destructive/10 transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" />
          Logout
        </button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [theme, setTheme] = React.useState<"dark" | "light">("light");
  const [themeReady, setThemeReady] = React.useState(false);
  const [isSidebarMenuOpen, setIsSidebarMenuOpen] = React.useState(false);
  const [isTopbarMenuOpen, setIsTopbarMenuOpen] = React.useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const [userEmail, setUserEmail] = React.useState<string>("");
  const mobileMenuButtonRef = React.useRef<HTMLButtonElement>(null);
  const mobileMenuCloseRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data?.user?.email ?? "");
    });
  }, []);

  React.useEffect(() => {
    if (!isMobileMenuOpen) return;
    const menuTrigger = mobileMenuButtonRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    mobileMenuCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMobileMenuOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      menuTrigger?.focus();
    };
  }, [isMobileMenuOpen]);

  // Restore persisted theme preference.
  React.useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
    setThemeReady(true);
  }, []);

  const displayName = userEmail ? userEmail.split("@")[0] : "Account";
  const avatarInitial = displayName ? displayName.charAt(0).toUpperCase() : "?";

  const handleLogout = async () => {
    setIsSidebarMenuOpen(false);
    setIsTopbarMenuOpen(false);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch (err) {
      console.warn("Failed to sign out via Supabase:", err);
    } finally {
      router.push("/");
    }
  };

  const sidebarRef = React.useRef<HTMLDivElement>(null);
  const topbarRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!themeReady) return;
    const root = document.documentElement;
    root.classList.remove("dark", "light");
    root.classList.add(theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme, themeReady]);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (sidebarRef.current && !sidebarRef.current.contains(event.target as Node)) {
        setIsSidebarMenuOpen(false);
      }
      if (topbarRef.current && !topbarRef.current.contains(event.target as Node)) {
        setIsTopbarMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <div className="min-h-[100dvh] w-full text-foreground">
      <a href="#main-content" className="sr-only fixed left-3 top-3 z-[100] rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground focus:not-sr-only">
        Skip to main content
      </a>
      {/* Clean background */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-background" />

      {/* Mobile Drawer Overlay */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex" role="dialog" aria-modal="true" aria-label="Mobile navigation">
          <button
            type="button"
            aria-label="Close navigation"
            className="fixed inset-0 bg-background/60 backdrop-blur-sm transition-opacity"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          <aside id="mobile-navigation" className="relative flex w-72 max-w-[88vw] flex-col border-r border-border bg-sidebar h-full shadow-[var(--shadow-elevated)] p-4 pt-16 animate-[page-enter_0.2s_ease-out]">
            <button
              ref={mobileMenuCloseRef}
              type="button"
              onClick={() => setIsMobileMenuOpen(false)}
              className="absolute top-4 right-4 grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground ring-focus"
              aria-label="Close menu"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-3 border-b border-border pb-4 mb-4">
              <div className="min-w-0 leading-tight">
                <div className="font-display text-[14px] font-semibold tracking-tight">
                  FAIV<span className="text-primary"> Predict</span>
                </div>
                <div className="text-xs font-semibold text-muted-foreground">
                  Performance Analytics
                </div>
              </div>
            </div>
            <nav className="flex-1 overflow-y-auto">
              {NAV_GROUPS.map((group) => (
                <div key={group.label} className="mb-5">
                  <div className="mb-1.5 px-3 text-xs font-semibold text-muted-foreground">
                    {group.label}
                  </div>
                  <ul className="space-y-0.5">
                    {group.items.map((item) => {
                      const active =
                        pathname === item.to ||
                        (item.to !== "/dashboard" && pathname.startsWith(item.to));
                      const Icon = item.icon;
                      return (
                        <li key={item.to}>
                          <Link
                            href={item.to}
                            onClick={() => setIsMobileMenuOpen(false)}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                              "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ring-focus",
                              active
                                ? "bg-sidebar-accent text-foreground"
                                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                            )}
                          >
                            <span
                              className={cn(
                                "grid h-[26px] w-[26px] shrink-0 place-items-center rounded-md transition-colors",
                                active
                                  ? "bg-[color-mix(in_oklab,hsl(var(--primary))_15%,transparent)] text-primary"
                                  : "text-muted-foreground/60 group-hover:text-muted-foreground"
                              )}
                            >
                              <Icon className="h-[14px] w-[14px]" />
                            </span>
                            <span>{item.label}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>
          </aside>
        </div>
      )}

      <div className="flex">
        {/* ── Sidebar ── */}
        <aside className="sticky top-0 hidden h-[100dvh] w-60 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
          {/* Logo row — same height as topbar */}
          <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-4">
            <div className="min-w-0 leading-tight">
              <div className="font-display text-[14px] font-semibold tracking-tight">
                FAIV<span className="text-primary"> Predict</span>
              </div>
              <div className="text-xs font-semibold text-muted-foreground">
                Performance Analytics
              </div>
            </div>
          </div>

          {/* Nav */}
          <nav className="flex-1 overflow-y-auto px-2 py-4">
            {NAV_GROUPS.map((group) => (
              <div key={group.label} className="mb-5">
                <div className="mb-1.5 px-3 text-xs font-semibold text-muted-foreground">
                  {group.label}
                </div>
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const active =
                      pathname === item.to ||
                      (item.to !== "/dashboard" && pathname.startsWith(item.to));
                    const Icon = item.icon;
                    return (
                      <li key={item.to}>
                        <Link
                          href={item.to}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ring-focus",
                            active
                              ? "bg-sidebar-accent text-foreground"
                              : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                          )}
                        >
                          <span
                            className={cn(
                              "grid h-[26px] w-[26px] shrink-0 place-items-center rounded-md transition-colors",
                              active
                                ? "bg-[color-mix(in_oklab,hsl(var(--primary))_15%,transparent)] text-primary"
                                : "text-muted-foreground/60 group-hover:text-muted-foreground"
                            )}
                          >
                            <Icon className="h-[14px] w-[14px]" />
                          </span>
                          <span>{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>

          {/* User footer */}
          <div ref={sidebarRef} className="relative shrink-0 border-t border-border p-2">
            {isSidebarMenuOpen && (
              <UserMenuPanel
                displayName={displayName}
                userEmail={userEmail}
                onLogout={handleLogout}
                className="absolute bottom-full left-2 right-2 mb-2"
              />
            )}
            <button
              type="button"
              onClick={() => setIsSidebarMenuOpen(!isSidebarMenuOpen)}
              aria-expanded={isSidebarMenuOpen}
              aria-haspopup="menu"
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-sidebar-accent/50"
            >
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
                {avatarInitial}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-sidebar-foreground">
                  {displayName}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-[oklch(0.72_0.16_150)]" />
                  <span className="truncate">{userEmail || "Signed in"}</span>
                </div>
              </div>
              <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-200", isSidebarMenuOpen && "rotate-180")} />
            </button>
          </div>
        </aside>

        {/* ── Main content ── */}
        <div className="flex min-h-[100dvh] flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur-xl md:px-6">
            {/* Left: mobile menu + logo */}
            <div className="flex items-center gap-3">
              <button
                ref={mobileMenuButtonRef}
                type="button"
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-all hover:bg-surface-2 hover:text-foreground md:hidden ring-focus"
                aria-label="Toggle menu"
                aria-expanded={isMobileMenuOpen}
                aria-controls="mobile-navigation"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="md:hidden font-display text-sm font-semibold tracking-tight">
                FAIV<span className="text-primary"> Predict</span>
              </div>
            </div>

            {/* Right: actions */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground ring-focus"
                aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <div ref={topbarRef} className="relative">
                <button
                  type="button"
                  onClick={() => setIsTopbarMenuOpen(!isTopbarMenuOpen)}
                  aria-expanded={isTopbarMenuOpen}
                  aria-haspopup="menu"
                  className="ml-1 hidden items-center gap-2 rounded-lg border border-border bg-surface/60 px-2 py-1 transition-colors hover:bg-surface-2 sm:flex ring-focus"
                >
                  <div className="grid h-6 w-6 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
                    {avatarInitial}
                  </div>
                  <div className="text-left leading-tight">
                    <div className="text-[12px] font-medium">{displayName}</div>
                    <div className="max-w-[140px] truncate text-xs text-muted-foreground">{userEmail || "Signed in"}</div>
                  </div>
                  <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform duration-200", isTopbarMenuOpen && "rotate-180")} />
                </button>
                {isTopbarMenuOpen && (
                  <UserMenuPanel
                    displayName={displayName}
                    userEmail={userEmail}
                    onLogout={handleLogout}
                    className="absolute right-0 top-full mt-2 w-48"
                  />
                )}
              </div>
            </div>
          </header>

          <main id="main-content" tabIndex={-1} key={pathname} className="flex-1 page-enter">{children}</main>
        </div>
      </div>
    </div>
  );
}
