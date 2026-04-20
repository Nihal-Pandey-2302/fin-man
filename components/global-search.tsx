"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type SearchGroup = { type: string; rows: { id: string; title: string; subtitle: string; href: string }[] };

export function GlobalSearch() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<SearchGroup[]>([]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const run = async () => {
      const keyword = query.trim();
      if (!keyword) {
        setGroups([]);
        return;
      }
      const like = `%${keyword}%`;
      const [expenses, subscriptions, investments, loans] = await Promise.all([
        supabase
          .from("expenses")
          .select("id, category, subcategory, note, amount, date")
          .or(`note.ilike.${like},subcategory.ilike.${like},category.ilike.${like}`)
          .order("date", { ascending: false })
          .limit(8),
        supabase
          .from("subscriptions")
          .select("id, name, category, amount, next_due_date")
          .or(`name.ilike.${like},category.ilike.${like}`)
          .order("next_due_date", { ascending: true })
          .limit(8),
        supabase
          .from("investments")
          .select("id, name, type, platform, current_value")
          .or(`name.ilike.${like},platform.ilike.${like},type.ilike.${like}`)
          .order("date", { ascending: false })
          .limit(8),
        supabase
          .from("loans")
          .select("id, person_name, reason, amount, status")
          .or(`person_name.ilike.${like},reason.ilike.${like}`)
          .order("date", { ascending: false })
          .limit(8),
      ]);

      const next: SearchGroup[] = [
        {
          type: "Expenses",
          rows: (expenses.data ?? []).map((row) => ({
            id: row.id,
            title: `${row.category} • ₹${Number(row.amount).toFixed(2)}`,
            subtitle: `${row.subcategory ?? "General"} • ${row.note ?? "No note"} • ${row.date}`,
            href: "/expenses",
          })),
        },
        {
          type: "Subscriptions",
          rows: (subscriptions.data ?? []).map((row) => ({
            id: row.id,
            title: `${row.name} • ₹${Number(row.amount).toFixed(2)}`,
            subtitle: `${row.category ?? "subscription"} • due ${row.next_due_date ?? "n/a"}`,
            href: "/subscriptions",
          })),
        },
        {
          type: "Investments",
          rows: (investments.data ?? []).map((row) => ({
            id: row.id,
            title: `${row.name} • ${row.type}`,
            subtitle: `${row.platform ?? "No platform"} • current ₹${Number(row.current_value ?? 0).toFixed(2)}`,
            href: "/investments",
          })),
        },
        {
          type: "Loans",
          rows: (loans.data ?? []).map((row) => ({
            id: row.id,
            title: `${row.person_name} • ₹${Number(row.amount).toFixed(2)}`,
            subtitle: `${row.reason ?? "No reason"} • ${row.status}`,
            href: "/loans",
          })),
        },
      ].filter((group) => group.rows.length > 0);
      setGroups(next);
    };
    void run();
  }, [query, supabase]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-300 md:block"
      >
        Search (Ctrl/Cmd+K)
      </button>
      {open ? (
        <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/60 p-4 pt-20">
          <div className="w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search expenses, subscriptions, investments, loans..."
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            />
            <div className="mt-3 max-h-[60vh] space-y-3 overflow-auto">
              {groups.length === 0 ? (
                <p className="empty-state text-sm">◌ No results yet. Start typing a keyword.</p>
              ) : (
                groups.map((group) => (
                  <div key={group.type}>
                    <p className="mb-1 text-xs uppercase tracking-wide text-zinc-400">{group.type}</p>
                    <div className="space-y-1">
                      {group.rows.map((row) => (
                        <Link
                          key={`${group.type}-${row.id}`}
                          href={row.href}
                          onClick={() => setOpen(false)}
                          className="block rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2"
                        >
                          <p className="text-sm text-zinc-100">{row.title}</p>
                          <p className="text-xs text-zinc-400">{row.subtitle}</p>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
