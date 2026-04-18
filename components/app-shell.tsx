"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { GlobalSearch } from "@/components/global-search";
import type { AppToastEventDetail } from "@/lib/toast";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/expenses", label: "Expenses" },
  { href: "/investments", label: "Investments" },
  { href: "/subscriptions", label: "Subscriptions" },
  { href: "/loans", label: "Loans" },
  { href: "/analytics", label: "Analytics" },
  { href: "/settings", label: "Settings" },
];
const mobileNavItems = navItems.slice(0, 5);

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href;

  return (
    <Link
      href={href}
      className={`rounded-md px-3 py-2 text-sm ${
        active
          ? "bg-blue-600/20 text-blue-300"
          : "text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
      }`}
    >
      {label}
    </Link>
  );
}

export function AppShell({
  children,
  initialToastMessages = [],
}: {
  children: React.ReactNode;
  initialToastMessages?: string[];
}) {
  const [toasts, setToasts] = useState<
    { id: string; message: string; tone: "info" | "success" | "warning" | "error" }[]
  >(
    initialToastMessages.map((message, index) => ({
      id: `initial-${index}`,
      message,
      tone: "warning",
    }))
  );

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => setToasts((prev) => prev.slice(1)), 3500);
    return () => clearTimeout(timer);
  }, [toasts]);

  useEffect(() => {
    const onToast = (event: Event) => {
      const custom = event as CustomEvent<AppToastEventDetail>;
      setToasts((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${prev.length}`,
          message: custom.detail.message,
          tone: custom.detail.tone ?? "info",
        },
      ]);
    };
    window.addEventListener("app:toast", onToast);
    return () => window.removeEventListener("app:toast", onToast);
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="fixed right-4 top-4 z-50 space-y-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`rounded-md px-3 py-2 text-sm shadow-lg ${
              toast.tone === "success"
                ? "border border-green-700 bg-zinc-900 text-green-200"
                : toast.tone === "error"
                ? "border border-red-700 bg-zinc-900 text-red-200"
                : toast.tone === "warning"
                ? "border border-yellow-700 bg-zinc-900 text-yellow-200"
                : "border border-blue-700 bg-zinc-900 text-blue-200"
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
      <div className="mx-auto flex max-w-7xl">
        <aside className="hidden min-h-screen w-64 border-r border-zinc-800 p-4 md:flex md:flex-col md:gap-3">
          <h1 className="mb-2 text-lg font-semibold">Finance Terminal</h1>
          <GlobalSearch />
          <nav className="flex flex-col gap-1">
            {navItems.map((item) => (
              <NavLink key={item.href} {...item} />
            ))}
          </nav>
          <div className="mt-auto">
            <SignOutButton />
          </div>
        </aside>

        <main className="w-full p-4 pb-24 md:p-6 md:pb-6">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-800 bg-zinc-950/95 p-2 backdrop-blur md:hidden">
        <div className="grid grid-cols-5 gap-1">
          {mobileNavItems.map((item) => (
            <NavLink key={item.href} {...item} />
          ))}
        </div>
      </nav>
    </div>
  );
}
