import { Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet } from "react-router";
import { cn } from "cn";
import type { Txn } from "@shared/api";
import { formatPaise } from "@shared/money";
import { formatDay, istDate } from "@shared/time";
import { NativeSelect } from "@/components/native-select";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { TxnEditor, type EditorTarget } from "@/components/txn-editor";
import { TxnRow } from "@/components/txn-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsDesktop } from "@/hooks/use-media-query";
import { KIND_LABEL, collapsePairs, type ListTxn } from "@/lib/labels";
import { useBootstrap, useLookups, useTransactions, type TxnFilters } from "@/lib/queries";

export function ActivityLayout() {
  const { data } = useBootstrap();
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn("flex h-9 items-center gap-2 rounded-md px-4 text-sm font-medium transition-colors", isActive ? "bg-card shadow-sm" : "text-muted-foreground");
  return (
    // A list reads best at a comfortable width; no point stretching rows across a wide screen.
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold">Activity</h1>
        <nav className="flex rounded-lg bg-muted p-1">
          <NavLink to="/activity" end className={tab}>
            All
          </NavLink>
          <NavLink to="/activity/review" className={tab}>
            Review
            {!!data?.reviewCount && <Badge className="h-5 min-w-5 px-1.5">{data.reviewCount}</Badge>}
          </NavLink>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}

const SPEND_KINDS = new Set<Txn["kind"]>(["expense", "fee"]);

export default function TransactionsPage() {
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim());
  const [filters, setFilters] = useState<Omit<TxnFilters, "q">>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const desktop = useIsDesktop();
  const { account, category } = useLookups();

  const query = useTransactions({ ...filters, q: q || undefined });
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);

  // Group by IST day, with the day's spending total.
  const groups = useMemo(() => {
    const out: { date: string; spent: number; items: ListTxn[] }[] = [];
    for (const t of collapsePairs(items)) {
      const date = istDate(new Date(t.occurredAt));
      let g = out.at(-1);
      if (!g || g.date !== date) out.push((g = { date, spent: 0, items: [] }));
      g.items.push(t);
      // Same as SPEND on the server: a split payment counts only your share.
      if (SPEND_KINDS.has(t.kind) && t.direction === "debit") g.spent += t.sharePaise ?? t.amountPaise;
      if (t.kind === "refund" && t.direction === "credit") g.spent -= t.amountPaise;
    }
    return out;
  }, [items]);

  // Infinite scroll.
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) void fetchNextPage();
    }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // "/" focuses search on laptops.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const chips = [
    filters.accountId && { key: "accountId", label: account(filters.accountId)?.name },
    filters.categoryId && { key: "categoryId", label: filters.categoryId === "none" ? "Uncategorised" : category(filters.categoryId)?.name },
    filters.kind && { key: "kind", label: KIND_LABEL[filters.kind] },
    (filters.from || filters.to) && { key: "range", label: `${filters.from ?? "…"} → ${filters.to ?? "…"}` },
  ].filter(Boolean) as { key: string; label: string }[];

  const clear = (key: string) =>
    setFilters((f) => {
      const next = { ...f };
      if (key === "range") {
        delete next.from;
        delete next.to;
      } else delete next[key as keyof typeof f];
      return next;
    });

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={desktop ? "Search merchant, note, VPA or amount  ( / )" : "Search"}
            className="h-11 pl-9 md:h-9"
            type="search"
          />
        </div>
        <Button variant="outline" className="h-11 md:h-9" onClick={() => setFiltersOpen(true)} aria-label="Filters">
          <SlidersHorizontal /> <span className="hidden sm:inline">Filters</span>
        </Button>
        <Button className="h-11 md:h-9" onClick={() => setEditing({ mode: "create" })}>
          <Plus /> <span className="hidden sm:inline">Add</span>
        </Button>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <Badge key={c.key} variant="secondary" className="h-7 gap-1 pr-1">
              {c.label}
              <button type="button" onClick={() => clear(c.key)} aria-label={`Remove ${c.label}`} className="rounded-full p-0.5 hover:bg-background">
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {query.isPending ? (
        <div className="space-y-2">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : groups.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">{q || chips.length ? "Nothing matches." : "No transactions yet. They'll appear here as bank SMS arrive."}</p>
      ) : (
        <div className={cn("space-y-4", query.isPlaceholderData && "opacity-60")}>
          {groups.map((g) => (
            <section key={g.date}>
              <h2 className="sticky top-0 z-10 flex justify-between bg-background/95 px-2 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
                <span>{formatDay(g.date)}</span>
                {g.spent > 0 && <span className="tabular-nums">spent {formatPaise(g.spent)}</span>}
              </h2>
              <div className="divide-y divide-border/50">
                {g.items.map((t) => (
                  <TxnRow key={t.id} txn={t} onOpen={(txn) => setEditing({ mode: "edit", txn })} />
                ))}
              </div>
            </section>
          ))}
          <div ref={sentinel} className="h-8">
            {isFetchingNextPage && <Skeleton className="h-8" />}
          </div>
        </div>
      )}

      <FiltersSheet open={filtersOpen} onOpenChange={setFiltersOpen} value={filters} onChange={setFilters} />
      <TxnEditor target={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function FiltersSheet({
  open,
  onOpenChange,
  value,
  onChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  value: Omit<TxnFilters, "q">;
  onChange: (f: Omit<TxnFilters, "q">) => void;
}) {
  const { accounts, activeCategories } = useLookups();
  const set = (patch: Partial<TxnFilters>) => onChange({ ...value, ...patch });
  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} title="Filters">
      <div className="grid gap-4 pb-2 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="f-account">Account</Label>
          <NativeSelect id="f-account" value={value.accountId ?? ""} onChange={(e) => set({ accountId: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-category">Category</Label>
          <NativeSelect
            id="f-category"
            value={value.categoryId ?? ""}
            onChange={(e) => set({ categoryId: e.target.value === "none" ? "none" : e.target.value ? Number(e.target.value) : undefined })}
          >
            <option value="">All categories</option>
            <option value="none">Uncategorised</option>
            {activeCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-kind">Type</Label>
          <NativeSelect id="f-kind" value={value.kind ?? ""} onChange={(e) => set({ kind: (e.target.value || undefined) as Txn["kind"] | undefined })}>
            <option value="">All types</option>
            {Object.entries(KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="f-from">From</Label>
            <Input id="f-from" type="date" value={value.from ?? ""} onChange={(e) => set({ from: e.target.value || undefined })} className="h-11 md:h-9" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-to">To</Label>
            <Input id="f-to" type="date" value={value.to ?? ""} onChange={(e) => set({ to: e.target.value || undefined })} className="h-11 md:h-9" />
          </div>
        </div>
        <div className="flex gap-2 sm:col-span-2">
          <Button variant="ghost" onClick={() => onChange({})}>
            Clear all
          </Button>
          <Button className="ml-auto" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </div>
    </ResponsiveSheet>
  );
}
