import { Delete, StickyNote } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { haptic } from "@/lib/haptic";
import type { Category, Preset } from "@shared/api";
import { formatPaise, rupeesToPaise } from "@shared/money";
import { CategoryPicker } from "@/components/category-picker";
import { NativeSelect } from "@/components/native-select";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { del, post } from "@/lib/api";
import { invalidateLedger, useLookups } from "@/lib/queries";
import { load, save } from "@/lib/storage";

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];
const INCOME = new Set(["Salary", "Other income"]);

/** Append a keypad key to an amount string, keeping it a valid ≤ 2-decimal rupee amount. */
function press(amount: string, key: string): string {
  if (key === "⌫") return amount.slice(0, -1);
  if (key === "." && amount.includes(".")) return amount;
  const next = amount === "0" && key !== "." ? key : amount + key;
  if (/\.\d{3}$/.test(next) || next.replace(".", "").length > 9) return amount;
  return next === "." ? "0." : next;
}

/** Cash spends in three taps: amount → category (saves) → done. Big targets, one-handed. */
export function QuickAddDrawer({ open, onOpenChange }: Props) {
  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} title="Quick add">
      {open && <QuickAdd onDone={() => onOpenChange(false)} />}
    </ResponsiveSheet>
  );
}

function QuickAdd({ onDone }: { onDone: () => void }) {
  const { activeCategories, activeAccounts, data } = useLookups();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const defaultAccount = activeAccounts.find((a) => a.id === load<number | null>("quickAccount", null)) ?? activeAccounts.find((a) => a.kind === "cash") ?? activeAccounts[0];
  const [accountId, setAccountId] = useState<number | undefined>(defaultAccount?.id);

  const spendCategories = useMemo(() => activeCategories.filter((c) => !INCOME.has(c.name)), [activeCategories]);
  const frequent = useMemo(() => {
    const usage = load<Record<string, number>>("categoryUsage", {});
    return [...spendCategories].sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0) || a.sortOrder - b.sortOrder).slice(0, 8);
  }, [spendCategories]);

  const paise = rupeesToPaise(amount);

  // Laptop: type the amount on the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "SELECT") return;
      if (/^[\d.]$/.test(e.key)) setAmount((a) => press(a, e.key));
      else if (e.key === "Backspace") setAmount((a) => press(a, "⌫"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function commit(category: Category | undefined, overrides: Partial<Preset> = {}) {
    const amountPaise = overrides.amountPaise ?? paise;
    const account = overrides.accountId ?? accountId;
    if (!amountPaise) {
      toast.info("Enter an amount first");
      return;
    }
    if (!account || saving) return;
    setSaving(true);
    try {
      const txn = await post<{ id: number }>("/transactions", {
        accountId: account,
        amountPaise,
        direction: "debit",
        kind: "expense",
        categoryId: category?.id ?? null,
        note: (overrides.note ?? note.trim()) || null,
      });
      if (category) {
        const usage = load<Record<string, number>>("categoryUsage", {});
        save("categoryUsage", { ...usage, [category.id]: (usage[category.id] ?? 0) + 1 });
      }
      save("quickAccount", account);
      invalidateLedger();
      haptic();
      toast.success(`${formatPaise(amountPaise)} · ${category?.name ?? "Uncategorised"}`, {
        action: { label: "Undo", onClick: () => void del(`/transactions/${txn.id}`).then(() => invalidateLedger()) },
      });
      onDone();
    } catch {
      toast.error("Couldn't save. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  const presets = data?.presets ?? [];

  return (
    <div className="space-y-2.5 pb-1">
      <div className="flex items-center gap-2">
        <div className="w-40">
          <NativeSelect aria-label="Account" value={accountId ?? ""} onChange={(e) => setAccountId(Number(e.target.value))} className="h-9 text-sm">
            {activeAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setShowNote((s) => !s)}>
          <StickyNote /> Note
        </Button>
      </div>

      <div className="text-center text-5xl font-semibold tracking-tight tabular-nums" aria-live="polite">
        <span className="text-muted-foreground">₹</span>
        {amount || "0"}
      </div>

      {showNote && <Input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="h-10" />}

      {presets.length > 0 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {presets.map((p) => (
            <Button
              key={p.id}
              variant="secondary"
              size="sm"
              className="shrink-0 rounded-full"
              onClick={() => {
                if (p.accountId) setAccountId(p.accountId);
                if (p.note) setNote(p.note);
                if (p.amountPaise) setAmount(String(p.amountPaise / 100));
                void commit(spendCategories.find((c) => c.id === p.categoryId), p);
              }}
            >
              {p.name}
              {p.amountPaise ? ` · ${formatPaise(p.amountPaise)}` : ""}
            </Button>
          ))}
        </div>
      )}

      {showAll ? (
        <CategoryPicker categories={spendCategories} value={null} onChange={(id) => void commit(spendCategories.find((c) => c.id === id))} />
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {frequent.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={saving}
              onClick={() => void commit(c)}
              className="flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl bg-muted/60 px-1 py-1.5 text-[11px] leading-tight transition active:scale-95 disabled:opacity-50"
            >
              <span className="text-xl leading-none">{c.emoji}</span>
              <span className="line-clamp-1">{c.name}</span>
            </button>
          ))}
        </div>
      )}
      <Button variant="link" size="sm" className="h-7 w-full" onClick={() => setShowAll((s) => !s)}>
        {showAll ? "Fewer categories" : "All categories"}
      </Button>

      <div className="grid grid-cols-3 gap-2 select-none">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setAmount((a) => press(a, k))}
            onContextMenu={(e) => {
              if (k === "⌫") {
                e.preventDefault();
                setAmount("");
              }
            }}
            className="flex h-12 items-center justify-center rounded-xl bg-muted/40 text-2xl font-medium tabular-nums transition active:scale-95 active:bg-muted"
            aria-label={k === "⌫" ? "Backspace" : k}
          >
            {k === "⌫" ? <Delete className="size-6" /> : k}
          </button>
        ))}
      </div>
    </div>
  );
}
