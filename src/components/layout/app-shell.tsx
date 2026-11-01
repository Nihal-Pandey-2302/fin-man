import { CloudOff, Plus, RotateCw, Wallet } from "lucide-react";
import { Suspense, useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router";
import { cn } from "cn";
import { QuickAddDrawer } from "@/components/quick-add-drawer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useOnline } from "@/hooks/use-online";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { queryClient, useBootstrap } from "@/lib/queries";
import { NAV_ITEMS, SIDEBAR_EXTRA, type NavItem } from "./nav-items";

export function AppShell() {
  // Home-screen shortcut "Quick add" launches /?add=1.
  const [quickAddOpen, setQuickAddOpen] = useState(() => new URLSearchParams(window.location.search).get("add") === "1");
  const { data } = useBootstrap();
  const review = data?.reviewCount ?? 0;
  const { pathname, hash } = useLocation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const online = useOnline();
  const refresh = useCallback(() => queryClient.refetchQueries({ type: "active" }), []);
  const { pull, refreshing, ready } = usePullToRefresh(refresh);

  useEffect(() => {
    if (params.has("add")) navigate(pathname, { replace: true });
  }, [params, pathname, navigate]);

  // New page: start at the top, or at `#id` (e.g. /plan#savings); lazy pages may need a few frames to render it.
  // Braced bodies: Chrome's scrollTo now returns a Promise, which React would treat as a cleanup.
  useEffect(() => {
    const id = hash.slice(1);
    if (!id) {
      window.scrollTo({ top: 0 });
      return;
    }
    let tries = 0;
    let frame = 0;
    let settle = 0;
    const find = () => {
      const el = document.getElementById(id);
      if (!el) {
        if (tries++ < 60) frame = requestAnimationFrame(find);
        return;
      }
      el.scrollIntoView({ block: "start" });
      // Cards above swap skeletons for data and shift the page: line it up again once they've loaded.
      settle = window.setTimeout(() => el.scrollIntoView({ block: "start" }), 600);
    };
    find();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
    };
  }, [pathname, hash]);

  // Laptop shortcut: `n` opens quick add (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      if (e.key === "n" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setQuickAddOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-dvh bg-background text-foreground lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-1 border-r bg-sidebar p-3 lg:flex">
        <div className="flex items-center gap-2 px-2 py-3 font-heading text-lg font-semibold">
          <Wallet className="size-5" /> fintrack
        </div>
        <Button className="mb-3 justify-start" onClick={() => setQuickAddOpen(true)}>
          <Plus /> Quick add
          <kbd className="ml-auto rounded border border-primary-foreground/30 px-1.5 text-xs">N</kbd>
        </Button>
        {NAV_ITEMS.slice(0, 3).map((item) => (
          <SidebarLink key={item.to} {...item} badge={item.to === "/activity" ? review : 0} />
        ))}
        <div className="mt-4 mb-1 px-3 text-xs font-medium text-muted-foreground">Manage</div>
        {SIDEBAR_EXTRA.map((item) => (
          <SidebarLink key={item.to} {...item} />
        ))}
      </aside>

      {/* Pull-to-refresh indicator: follows the finger, spins while refreshing. */}
      {(pull > 0 || refreshing) && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center" style={{ transform: `translateY(${refreshing ? 56 : pull}px)` }} aria-hidden>
          <span className={cn("flex size-9 items-center justify-center rounded-full border bg-card shadow-md transition-colors", (ready || refreshing) && "text-primary")}>
            <RotateCw className={cn("size-4", refreshing && "animate-spin")} style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }} />
          </span>
        </div>
      )}
      <main className="mx-auto w-full max-w-6xl px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-28 lg:px-8 lg:py-8">
        {!online && (
          <p className="mb-3 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground" role="status">
            <CloudOff className="size-4" /> Offline: showing saved data. Changes need a connection.
          </p>
        )}
        <Suspense fallback={<Skeleton className="h-64 rounded-xl" />}>
          <Outlet />
        </Suspense>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="mx-auto grid h-16 max-w-md grid-cols-5 items-center">
          <TabLink {...NAV_ITEMS[0]} />
          <TabLink {...NAV_ITEMS[1]} badge={review} />
          <div className="flex justify-center">
            <Button
              size="icon"
              aria-label="Quick add"
              className="size-14 -translate-y-3 rounded-full shadow-lg [&_svg]:size-7"
              onClick={() => setQuickAddOpen(true)}
            >
              <Plus />
            </Button>
          </div>
          <TabLink {...NAV_ITEMS[2]} />
          <TabLink {...NAV_ITEMS[3]} />
        </div>
      </nav>

      <QuickAddDrawer open={quickAddOpen} onOpenChange={setQuickAddOpen} />
    </div>
  );
}

function SidebarLink({ to, label, icon: Icon, badge = 0 }: NavItem & { badge?: number }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          isActive && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
        )
      }
    >
      <Icon className="size-4" /> {label}
      {badge > 0 && <span className="ml-auto rounded-full bg-amber-500 px-1.5 text-xs font-medium text-black tabular-nums">{badge}</span>}
    </NavLink>
  );
}

function TabLink({ to, label, icon: Icon, badge = 0 }: NavItem & { badge?: number }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        cn("relative flex h-full flex-col items-center justify-center gap-1 text-[11px] text-muted-foreground", isActive && "text-foreground")
      }
    >
      <span className="relative">
        <Icon className="size-5" />
        {badge > 0 && (
          <span className="absolute -top-1.5 -right-2.5 min-w-4 rounded-full bg-amber-500 px-1 text-center text-[10px] leading-4 font-semibold text-black tabular-nums">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </span>
      {label}
    </NavLink>
  );
}
