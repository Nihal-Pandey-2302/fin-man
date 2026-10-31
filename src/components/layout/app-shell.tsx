import { Plus, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { QuickAddDrawer } from "@/components/quick-add-drawer";
import { NAV_ITEMS, type NavItem } from "./nav-items";

export function AppShell() {
  const [quickAddOpen, setQuickAddOpen] = useState(false);

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
        {NAV_ITEMS.map((item) => (
          <SidebarLink key={item.to} {...item} />
        ))}
      </aside>

      <main className="mx-auto w-full max-w-6xl px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-28 lg:px-8 lg:py-8">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="mx-auto grid h-16 max-w-md grid-cols-5 items-center">
          <TabLink {...NAV_ITEMS[0]} />
          <TabLink {...NAV_ITEMS[1]} />
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

function SidebarLink({ to, label, icon: Icon }: NavItem) {
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
    </NavLink>
  );
}

function TabLink({ to, label, icon: Icon }: NavItem) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        cn(
          "flex h-full flex-col items-center justify-center gap-1 text-[11px] text-muted-foreground",
          isActive && "text-foreground",
        )
      }
    >
      <Icon className="size-5" />
      {label}
    </NavLink>
  );
}
