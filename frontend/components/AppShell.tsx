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
  Building2,
  Cpu,
  Sun,
  Moon,
  ChevronDown,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_GROUPS = [
  {
    label: "Workspace",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/predict", label: "Prediction", icon: Sparkles },
      { to: "/calendar", label: "Calendar", icon: CalendarRange },
      { to: "/history", label: "History", icon: History },
    ],
  },
  {
    label: "Administrator",
    items: [
      { to: "/niches", label: "Niche Management", icon: Building2 },
      { to: "/model-health", label: "Model Health", icon: Cpu },
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
      className={cn(
        "z-50 rounded-xl border border-border bg-surface p-1.5 shadow-[var(--shadow-elevated)] backdrop-blur animate-[page-enter_0.15s_ease-out]",
        className
      )}
    >
      <div className="flex flex-col gap-0.5">
        <div className="px-2.5 py-1.5 border-b border-border/40 mb-1">
          <div className="text-xs font-semibold text-foreground">{displayName}</div>
          <div className="text-[10px] text-muted-foreground max-w-[180px] truncate">{userEmail || "—"}</div>
        </div>
        <button
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
  const [isSidebarMenuOpen, setIsSidebarMenuOpen] = React.useState(false);
  const [isTopbarMenuOpen, setIsTopbarMenuOpen] = React.useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const [userEmail, setUserEmail] = React.useState<string>("");

  React.useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data?.user?.email ?? "");
    });
  }, []);

  // Restore persisted theme preference.
  React.useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "dark" || stored === "light") {
      setTheme(stored);
    }
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
    const root = document.documentElement;
    root.classList.remove("dark", "light");
    root.classList.add(theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

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
    <div className="min-h-screen w-full text-foreground">
      {/* Clean background */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-background" />

      {/* Mobile Drawer Overlay */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-background/60 backdrop-blur-sm transition-opacity"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          <aside className="relative flex w-64 max-w-sm flex-col border-r border-border bg-sidebar h-full shadow-[var(--shadow-elevated)] p-4 pt-16 animate-[page-enter_0.2s_ease-out]">
            <button
              onClick={() => setIsMobileMenuOpen(false)}
              className="absolute top-4 right-4 grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground ring-focus"
              aria-label="Close menu"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-3 border-b border-border pb-4 mb-4">
              <Logo />
              <div className="min-w-0 leading-tight">
                <div className="font-display text-[14px] font-semibold tracking-tight">
                  FAIV<span className="text-primary"> Predict</span>
                </div>
                <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">
                  Performance Analytics
                </div>
              </div>
            </div>
            <nav className="flex-1 overflow-y-auto">
              {NAV_GROUPS.map((group) => (
                <div key={group.label} className="mb-5">
                  <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/50">
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
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
          {/* Logo row — same height as topbar */}
          <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-4">
            <Logo />
            <div className="min-w-0 leading-tight">
              <div className="font-display text-[14px] font-semibold tracking-tight">
                FAIV<span className="text-primary"> Predict</span>
              </div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">
                Performance Analytics
              </div>
            </div>
          </div>

          {/* Nav */}
          <nav className="flex-1 overflow-y-auto px-2 py-4">
            {NAV_GROUPS.map((group) => (
              <div key={group.label} className="mb-5">
                <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/50">
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
            <div
              onClick={() => setIsSidebarMenuOpen(!isSidebarMenuOpen)}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 transition-colors hover:bg-sidebar-accent/50 cursor-pointer"
            >
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-[11px] font-bold text-primary-foreground">
                {avatarInitial}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-sidebar-foreground">
                  {displayName}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-[oklch(0.72_0.16_150)]" />
                  <span className="truncate">{userEmail || "Signed in"}</span>
                </div>
              </div>
              <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-200", isSidebarMenuOpen && "rotate-180")} />
            </div>
          </div>
        </aside>

        {/* ── Main content ── */}
        <div className="flex min-h-screen flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur-xl md:px-6">
            {/* Left: mobile menu + logo */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-all hover:bg-surface-2 hover:text-foreground md:hidden ring-focus"
                aria-label="Toggle menu"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="md:hidden">
                <Logo />
              </div>
            </div>

            {/* Right: actions */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground ring-focus"
                aria-label="Toggle theme"
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <div ref={topbarRef} className="relative">
                <div
                  onClick={() => setIsTopbarMenuOpen(!isTopbarMenuOpen)}
                  className="ml-1 hidden cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface/60 px-2 py-1 transition-colors hover:bg-surface-2 sm:flex ring-focus"
                >
                  <div className="grid h-6 w-6 place-items-center rounded-md bg-primary text-[10px] font-bold text-primary-foreground">
                    {avatarInitial}
                  </div>
                  <div className="text-left leading-tight">
                    <div className="text-[12px] font-medium">{displayName}</div>
                    <div className="text-[10px] text-muted-foreground max-w-[140px] truncate">{userEmail || "Signed in"}</div>
                  </div>
                  <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform duration-200", isTopbarMenuOpen && "rotate-180")} />
                </div>
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

          <main key={pathname} className="flex-1 page-enter">{children}</main>
        </div>
      </div>
    </div>
  );
}

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <div
      className="relative grid shrink-0 place-items-center overflow-hidden rounded-lg bg-primary"
      style={{
        width: size,
        height: size,
      }}
    >
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none">
        <path
          d="M4 20V4h12M4 12h9M16 14l4 4-4 4M20 18H10"
          stroke="white"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
