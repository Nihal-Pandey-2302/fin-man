import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Check, MessageSquareWarning, Pencil, RotateCw, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import type { Review, Sms, Txn } from "@shared/api";
import { formatDay, formatTime } from "@shared/time";
import { CategoryBadge, CategoryPicker } from "@/components/category-picker";
import { Money } from "@/components/money";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { TxnEditor, type EditorTarget } from "@/components/txn-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useSwipe } from "@/hooks/use-swipe";
import { post } from "@/lib/api";
import { INSTITUTION_LABEL, txnTitle } from "@/lib/labels";
import { invalidateLedger, keys, useLookups, useReview } from "@/lib/queries";
import { relativeTime } from "@/lib/relative";
import { load } from "@/lib/storage";

type Item = { kind: "txn"; txn: Txn } | { kind: "pair"; legs: Txn[] };

export default function ReviewPage() {
  const { data, isPending } = useReview();
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  const [picking, setPicking] = useState<Txn | null>(null);
  const qc = useQueryClient();

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const seen = new Set<string>();
    for (const t of data?.transactions ?? []) {
      if (t.transferGroupId) {
        if (seen.has(t.transferGroupId)) continue;
        seen.add(t.transferGroupId);
        out.push({ kind: "pair", legs: data!.transactions.filter((x) => x.transferGroupId === t.transferGroupId) });
      } else out.push({ kind: "txn", txn: t });
    }
    return out;
  }, [data]);

  /** Optimistically drop items from the inbox, then confirm on the server. */
  async function confirm(ids: number[], categoryId?: number | null) {
    qc.setQueryData<Review>(keys.review, (r) => r && { ...r, transactions: r.transactions.filter((t) => !ids.includes(t.id)) });
    try {
      const results = await Promise.all(ids.map((id) => post<{ appliedTo: number }>(`/transactions/${id}/confirm`, categoryId !== undefined ? { categoryId } : {})));
      const applied = results.reduce((s, r) => s + (r.appliedTo ?? 0), 0);
      if (applied) toast.success(`Also categorised ${applied} similar`);
    } catch {
      toast.error("Couldn't confirm. Try again.");
    } finally {
      invalidateLedger(qc);
    }
  }

  async function unpair(groupId: string) {
    await post(`/transfers/${groupId}/unpair`);
    invalidateLedger(qc);
  }

  if (isPending) return <div className="space-y-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}</div>;

  const empty = items.length === 0 && (data?.sms.length ?? 0) === 0;
  return (
    <div className="space-y-3">
      {empty ? (
        <div className="py-20 text-center">
          <p className="text-4xl">✨</p>
          <p className="mt-2 font-medium">All caught up</p>
          <p className="text-sm text-muted-foreground">New SMS that need a decision will land here.</p>
        </div>
      ) : (
        <p className="px-1 text-xs text-muted-foreground">Swipe right to confirm · swipe left to edit</p>
      )}

      {items.map((item) =>
        item.kind === "pair" ? (
          <PairCard key={item.legs[0].transferGroupId} legs={item.legs} onConfirm={() => confirm(item.legs.map((l) => l.id))} onUnpair={() => unpair(item.legs[0].transferGroupId!)} />
        ) : (
          <ReviewCard
            key={item.txn.id}
            txn={item.txn}
            onConfirm={(categoryId) => (categoryId === undefined && !item.txn.categoryId && item.txn.kind === "expense" ? setPicking(item.txn) : confirm([item.txn.id], categoryId))}
            onEdit={() => setEditing({ mode: "edit", txn: item.txn })}
            onPick={() => setPicking(item.txn)}
          />
        ),
      )}

      {data?.sms.map((s) => <SmsCard key={s.id} sms={s} onCreate={() => setEditing({ mode: "create", sms: s })} />)}

      <PickCategory txn={picking} onClose={() => setPicking(null)} onPick={(id) => picking && confirm([picking.id], id)} />
      <TxnEditor target={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function frequentCategoryIds(): number[] {
  const usage = load<Record<string, number>>("categoryUsage", {});
  return Object.entries(usage)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => Number(id));
}

function ReviewCard({ txn, onConfirm, onEdit, onPick }: { txn: Txn; onConfirm: (categoryId?: number) => void; onEdit: () => void; onPick: () => void }) {
  const { category, account, activeCategories } = useLookups();
  const swipe = useSwipe({ onRight: () => onConfirm(), onLeft: onEdit });
  const cat = category(txn.categoryId);
  const credit = txn.direction === "credit";
  const suggestions = useMemo(() => {
    const preferred = credit ? activeCategories.filter((c) => c.name === "Salary" || c.name === "Other income").map((c) => c.id) : frequentCategoryIds();
    const ids = [...new Set([...preferred, ...activeCategories.map((c) => c.id)])];
    return ids.map((id) => activeCategories.find((c) => c.id === id)).filter((c) => c && (credit || (c.name !== "Salary" && c.name !== "Other income"))).slice(0, 4);
  }, [activeCategories, credit]);

  return (
    <div className="relative overflow-hidden rounded-xl">
      <div className="absolute inset-0 flex items-center justify-between px-6 text-sm font-medium" aria-hidden>
        <span className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400" style={{ opacity: swipe.dx > 0 ? 1 : 0 }}>
          <Check /> Confirm
        </span>
        <span className="flex items-center gap-2 text-muted-foreground" style={{ opacity: swipe.dx < 0 ? 1 : 0 }}>
          Edit <Pencil className="size-4" />
        </span>
      </div>
      <Card className="relative bg-card select-none" style={swipe.style} {...swipe.handlers}>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-3">
            <CategoryBadge category={cat} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{txnTitle(txn, cat?.name)}</p>
              <p className="truncate text-xs text-muted-foreground">
                {account(txn.accountId)?.name} · {formatDay(new Date(txn.occurredAt))}, {formatTime(new Date(txn.occurredAt))}
                {txn.channel && ` · ${txn.channel.toUpperCase()}`}
              </p>
            </div>
            <Money paise={txn.amountPaise} direction={txn.direction} className="text-lg font-semibold" />
          </div>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((c) => (
              <Button key={c!.id} variant={c!.id === txn.categoryId ? "default" : "secondary"} size="sm" className="h-9 rounded-full" onClick={() => onConfirm(c!.id)}>
                {c!.emoji} {c!.name}
              </Button>
            ))}
            <Button variant="ghost" size="sm" className="h-9 rounded-full" onClick={onPick}>
              More…
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onEdit}>
              <Pencil /> Edit
            </Button>
            <Button size="sm" className="ml-auto h-9" onClick={() => onConfirm()}>
              <Check /> {cat ? `Confirm · ${cat.name}` : credit ? "Confirm" : "Pick category"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PairCard({ legs, onConfirm, onUnpair }: { legs: Txn[]; onConfirm: () => void; onUnpair: () => void }) {
  const { account } = useLookups();
  const debit = legs.find((l) => l.direction === "debit");
  const credit = legs.find((l) => l.direction === "credit");
  const swipe = useSwipe({ onRight: onConfirm, onLeft: onUnpair });
  const lead = debit ?? credit!;
  return (
    <Card className="select-none" style={swipe.style} {...swipe.handlers}>
      <CardContent className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
            <ArrowLeftRight className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">{lead.kind === "card_payment" ? "Card bill payment?" : "Transfer between your accounts?"}</p>
            <p className="text-xs text-muted-foreground">
              {account(debit?.accountId)?.name ?? "?"} → {account(credit?.accountId)?.name ?? "?"} · {formatDay(new Date(lead.occurredAt))}
              {[debit?.merchant, credit?.merchant].filter(Boolean).length > 0 && ` · ${[debit?.merchant, credit?.merchant].filter(Boolean).join(" / ")}`}
            </p>
          </div>
          <Money paise={lead.amountPaise} neutral className="text-lg font-semibold" />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onUnpair}>
            <X /> Not a transfer
          </Button>
          <Button size="sm" className="ml-auto" onClick={onConfirm}>
            <Check /> Yes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SmsCard({ sms, onCreate }: { sms: Sms; onCreate: () => void }) {
  const missing = sms.error?.startsWith("no_account:") ? sms.error.split(":") : null;
  const retry = async () => {
    const out = await post<{ status: string }>(`/review/sms/${sms.id}/reprocess`);
    toast[out.status === "created" ? "success" : "info"](out.status === "created" ? "Imported" : "Still can't read it");
    invalidateLedger();
  };
  const dismiss = async () => {
    await post(`/review/sms/${sms.id}/dismiss`);
    invalidateLedger();
  };
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <MessageSquareWarning className="size-4" /> {sms.sender} · {relativeTime(sms.receivedAt)}
        </div>
        <p className="rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">{sms.body}</p>
        <p className="text-sm">
          {missing ? (
            <>
              No {INSTITUTION_LABEL[missing[1] as keyof typeof INSTITUTION_LABEL]} {missing[2] === "credit_card" ? "card" : "account"} ending <b>{missing[3]}</b>.{" "}
              <Link to="/more/accounts" className="underline underline-offset-2">
                Add it
              </Link>{" "}
              and this imports automatically.
            </>
          ) : (
            "This format isn't recognised yet."
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={dismiss}>
            <X /> Dismiss
          </Button>
          <Button variant="outline" size="sm" onClick={retry}>
            <RotateCw /> Retry
          </Button>
          <Button size="sm" className="ml-auto" onClick={onCreate}>
            Create transaction
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PickCategory({ txn, onClose, onPick }: { txn: Txn | null; onClose: () => void; onPick: (id: number) => void }) {
  const { activeCategories } = useLookups();
  return (
    <ResponsiveSheet open={txn !== null} onOpenChange={(o) => !o && onClose()} title="Pick a category" description={txn?.merchant ?? undefined}>
      <CategoryPicker
        categories={activeCategories}
        value={txn?.categoryId}
        direction={txn?.direction}
        onChange={(id) => {
          onPick(id);
          onClose();
        }}
      />
    </ResponsiveSheet>
  );
}
