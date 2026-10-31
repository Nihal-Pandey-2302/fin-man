import { Trash2, Unlink } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { Kind, Sms, Txn } from "@shared/api";
import { formatPaise, rupeesToPaise } from "@shared/money";
import { fromIstInput, toIstInput } from "@shared/time";
import { CategoryPicker } from "@/components/category-picker";
import { NativeSelect } from "@/components/native-select";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { del, patch, post } from "@/lib/api";
import { INCOME_SOURCE_LABEL, isPairedKind, KIND_LABEL, KINDS_FOR } from "@/lib/labels";
import { useLedgerMutation, useLookups } from "@/lib/queries";

export type EditorTarget =
  | { mode: "edit"; txn: Txn }
  | { mode: "create"; sms?: Sms; defaults?: Partial<Pick<Txn, "accountId" | "direction" | "amountPaise" | "merchant" | "kind">> };

type Props = { target: EditorTarget | null; onClose: () => void };

/** Parser output stored with an unparsed SMS (when the account was missing) can prefill the form. */
function smsDefaults(sms?: Sms): Partial<Txn> {
  if (!sms?.parsedJson) return {};
  try {
    const p = JSON.parse(sms.parsedJson);
    return p.type === "txn" ? { amountPaise: p.amountPaise, direction: p.direction, merchant: p.counterparty, occurredAt: p.occurredAt } : {};
  } catch {
    return {};
  }
}

export function TxnEditor({ target, onClose }: Props) {
  return (
    <ResponsiveSheet
      open={target !== null}
      onOpenChange={(o) => !o && onClose()}
      title={target?.mode === "edit" ? "Edit transaction" : target?.sms ? "Create from SMS" : "Add transaction"}
    >
      {target && <EditorForm key={target.mode === "edit" ? target.txn.id : (target.sms?.id ?? "new")} target={target} onDone={onClose} />}
    </ResponsiveSheet>
  );
}

function EditorForm({ target, onDone }: { target: EditorTarget; onDone: () => void }) {
  const { activeCategories, activeAccounts, accounts } = useLookups();
  const initial: Partial<Txn> =
    target.mode === "edit" ? target.txn : { direction: "debit", kind: "expense", ...smsDefaults(target.sms), ...target.defaults };
  const cash = activeAccounts.find((a) => a.kind === "cash");

  const [amount, setAmount] = useState(initial.amountPaise ? (initial.amountPaise / 100).toFixed(2).replace(/\.00$/, "") : "");
  const [direction, setDirection] = useState<"debit" | "credit">(initial.direction ?? "debit");
  const [kind, setKind] = useState<Kind>(initial.kind ?? "expense");
  const [categoryId, setCategoryId] = useState<number | null>(initial.categoryId ?? null);
  const [accountId, setAccountId] = useState<number | undefined>(initial.accountId ?? cash?.id ?? activeAccounts[0]?.id);
  const sms = target.mode === "create" ? target.sms : undefined;
  const [when, setWhen] = useState(() => toIstInput(initial.occurredAt ?? sms?.receivedAt ?? Date.now()));
  const [merchant, setMerchant] = useState(initial.merchant ?? "");
  const [note, setNote] = useState(initial.note ?? "");
  const [incomeSource, setIncomeSource] = useState<Txn["incomeSource"]>(initial.incomeSource ?? null);

  const amountPaise = rupeesToPaise(amount);
  const paired = isPairedKind(kind);

  const save = useLedgerMutation(
    async () => {
      const body = {
        accountId,
        amountPaise,
        direction,
        kind,
        categoryId: paired ? null : categoryId,
        merchant: merchant.trim() || null,
        note: note.trim() || null,
        occurredAt: fromIstInput(when),
        incomeSource: kind === "income" ? incomeSource : null,
      };
      if (target.mode === "edit") return patch<{ appliedTo: number }>(`/transactions/${target.txn.id}`, body);
      return post(`/transactions`, { ...body, smsId: sms?.id });
    },
    (r) => {
      const applied = (r as { appliedTo?: number })?.appliedTo ?? 0;
      return applied > 0 ? `Saved · also categorised ${applied} similar` : "Saved";
    },
  );
  const remove = useLedgerMutation(() => del(`/transactions/${(target as { txn: Txn }).txn.id}`), "Deleted");
  const unpair = useLedgerMutation(() => post(`/transfers/${(target as { txn: Txn }).txn.transferGroupId}/unpair`), "Unpaired");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!amountPaise || !accountId) return;
    save.mutate(undefined, { onSuccess: onDone });
  };

  const switchDirection = (d: "debit" | "credit") => {
    setDirection(d);
    if (!KINDS_FOR[d].includes(kind)) setKind(KINDS_FOR[d][0]);
  };

  return (
    <form onSubmit={submit} className="space-y-4 pb-2">
      {target.mode === "create" && target.sms && (
        <p className="rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap text-muted-foreground">{target.sms.body}</p>
      )}

      <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
        {(["debit", "credit"] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => switchDirection(d)}
            className={`h-9 rounded-md text-sm font-medium transition-colors ${direction === d ? "bg-background shadow-sm" : "text-muted-foreground"}`}
          >
            {d === "debit" ? "Money out" : "Money in"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="amount">Amount (₹)</Label>
          <Input
            id="amount"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
            className="h-11 text-lg tabular-nums"
            placeholder="0"
            aria-invalid={amount !== "" && amountPaise === null}
            autoFocus={target.mode === "create" && !amount}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="kind">Type</Label>
          <NativeSelect id="kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {KINDS_FOR[direction].map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="account">Account</Label>
          <NativeSelect id="account" value={accountId ?? ""} onChange={(e) => setAccountId(Number(e.target.value))}>
            {(target.mode === "edit" ? accounts : activeAccounts).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="when">When (IST)</Label>
          <Input id="when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="h-11 md:h-9" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="merchant">{direction === "debit" ? "Paid to" : "Received from"}</Label>
        <Input id="merchant" value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="Merchant or person" className="h-11 md:h-9" />
      </div>

      {kind === "income" && (
        <div className="space-y-1.5">
          <Label htmlFor="source">Income source</Label>
          <NativeSelect id="source" value={incomeSource ?? ""} onChange={(e) => setIncomeSource((e.target.value || null) as Txn["incomeSource"])}>
            <option value="">—</option>
            {Object.entries(INCOME_SOURCE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}

      {!paired && (
        <div className="space-y-1.5">
          <Label>Category</Label>
          <CategoryPicker categories={activeCategories} value={categoryId} onChange={setCategoryId} direction={direction} />
          {merchant.trim() && <p className="text-xs text-muted-foreground">Future “{merchant.trim()}” transactions get this category automatically.</p>}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="note">Note</Label>
        <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Optional" />
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center gap-2 bg-background pt-2">
        {target.mode === "edit" && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="Delete" className="text-destructive">
                <Trash2 />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this transaction?</AlertDialogTitle>
                <AlertDialogDescription>
                  {formatPaise(target.txn.amountPaise)} · {target.txn.merchant ?? KIND_LABEL[target.txn.kind]}. If it came from an SMS, that SMS won't be re-imported.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => remove.mutate(undefined, { onSuccess: onDone })}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {target.mode === "edit" && target.txn.transferGroupId && (
          <Button type="button" variant="outline" onClick={() => unpair.mutate(undefined, { onSuccess: onDone })}>
            <Unlink /> Not a transfer
          </Button>
        )}
        <Button type="submit" className="ml-auto h-11 min-w-28 md:h-9" disabled={!amountPaise || !accountId || save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
