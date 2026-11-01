import { useQuery } from "@tanstack/react-query";
import { Plus, Users, X } from "lucide-react";
import { useState } from "react";
import type { Loan, Txn } from "@shared/api";
import { formatPaise, rupeesToPaise } from "@shared/money";
import { NativeSelect } from "@/components/native-select";
import { RupeeInput } from "@/components/rupee-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, del, put } from "@/lib/api";
import { paiseToInput } from "@/lib/format";
import { useLedgerMutation, useLoans } from "@/lib/queries";

type SplitLoan = Loan & { paidPaise: number };

/**
 * Editor section for money shared with friends: split a payment you made (their parts become IOUs, your
 * share stays spending), or mark money as a payback of an IOU (then it's neither income nor spending).
 */
export function FriendsSection({ txn, onDone }: { txn: Txn; onDone: () => void }) {
  const splittable = txn.direction === "debit" && (txn.kind === "expense" || txn.kind === "fee") && !txn.transferGroupId;
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Users className="size-4" /> Friends
      </p>
      {splittable && <SplitPart txn={txn} onDone={onDone} />}
      {!txn.transferGroupId && <PaybackPart txn={txn} onDone={onDone} />}
    </div>
  );
}

function SplitPart({ txn, onDone }: { txn: Txn; onDone: () => void }) {
  const isSplit = txn.sharePaise !== null;
  const { data: split } = useQuery({ queryKey: ["split", txn.id], queryFn: () => api<SplitLoan[]>(`/transactions/${txn.id}/split`), enabled: isSplit });
  const [editing, setEditing] = useState(false);
  const remove = useLedgerMutation(() => del(`/transactions/${txn.id}/split`), "Split removed");

  if (isSplit && !editing) {
    const anyPaid = split?.some((l) => l.paidPaise > 0);
    return (
      <div className="space-y-2 text-sm">
        <p>
          Your share <b className="tabular-nums">{formatPaise(txn.sharePaise!)}</b> of {formatPaise(txn.amountPaise)}
        </p>
        {split?.map((l) => (
          <p key={l.id} className="flex justify-between text-muted-foreground">
            <span>{l.person} owes</span>
            <span className="tabular-nums">
              {formatPaise(l.principalPaise)}
              {l.paidPaise > 0 && ` · ${l.paidPaise >= l.principalPaise ? "paid" : `${formatPaise(l.paidPaise)} paid`}`}
            </span>
          </p>
        ))}
        {!anyPaid && (
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit split
            </Button>
            <Button type="button" size="sm" variant="ghost" className="text-muted-foreground" onClick={() => remove.mutate(undefined, { onSuccess: onDone })}>
              Remove split
            </Button>
          </div>
        )}
      </div>
    );
  }
  if (!editing) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
        Split with friends
      </Button>
    );
  }
  return <SplitForm txn={txn} initial={split} onDone={onDone} onCancel={() => setEditing(false)} />;
}

function SplitForm({ txn, initial, onDone, onCancel }: { txn: Txn; initial?: SplitLoan[]; onDone: () => void; onCancel: () => void }) {
  const { data: loans } = useLoans();
  const [rows, setRows] = useState(() => (initial?.length ? initial.map((l) => ({ person: l.person, amount: paiseToInput(l.principalPaise) })) : [{ person: "", amount: "" }]));
  const owed = rows.reduce((s, r) => s + (rupeesToPaise(r.amount) ?? 0), 0);
  const share = txn.amountPaise - owed;
  const valid = rows.every((r) => r.person.trim() && rupeesToPaise(r.amount)) && owed > 0 && share >= 0;
  const people = [...new Set((loans ?? []).map((l) => l.person))];
  const save = useLedgerMutation(
    () => put(`/transactions/${txn.id}/split`, { friends: rows.map((r) => ({ person: r.person.trim(), amountPaise: rupeesToPaise(r.amount) })) }),
    `Split saved · your share ${formatPaise(Math.max(0, share))}`,
  );
  const update = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  // Everyone (you included) pays the same; any leftover paise stay with you.
  const equal = () => {
    const each = Math.floor(txn.amountPaise / (rows.length + 1));
    setRows((rs) => rs.map((r) => ({ ...r, amount: paiseToInput(each) })));
  };

  return (
    <div className="space-y-2">
      <datalist id="friend-names">
        {people.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input list="friend-names" value={r.person} onChange={(e) => update(i, { person: e.target.value })} placeholder="Friend's name" className="h-11 flex-1 md:h-9" aria-label="Friend's name" />
          <div className="w-32">
            <RupeeInput value={r.amount} onChange={(v) => update(i, { amount: v })} placeholder="Their part" aria-label="Their part" />
          </div>
          {rows.length > 1 && (
            <Button type="button" variant="ghost" size="icon" aria-label="Remove" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
              <X />
            </Button>
          )}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setRows((rs) => [...rs, { person: "", amount: "" }])}>
          <Plus /> Friend
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={equal}>
          Equal shares ({rows.length + 1} people)
        </Button>
      </div>
      <p className={share < 0 ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
        {share < 0 ? "Friends' parts are more than the payment." : `Your share: ${formatPaise(share)} (counts as your spending). Their parts become IOUs in Plan.`}
      </p>
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={!valid || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onDone })}>
          Save split
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function PaybackPart({ txn, onDone }: { txn: Txn; onDone: () => void }) {
  const { data: loans } = useLoans();
  const [loanId, setLoanId] = useState<number | "">("");
  const link = useLedgerMutation(() => put(`/transactions/${txn.id}/repayment`, { loanId }), "Linked as a payback");
  const unlink = useLedgerMutation(() => del(`/transactions/${txn.id}/repayment`), "Unlinked");
  const linked = loans?.find((l) => l.id === txn.loanId);

  if (linked) {
    return (
      <div className="flex items-center justify-between gap-2 text-sm">
        <span>
          {linked.direction === "they_owe" ? `${linked.person} paying you back` : `Paying ${linked.person} back`}
          <span className="text-muted-foreground"> · {linked.reason ?? "IOU"}</span>
        </span>
        <Button type="button" size="sm" variant="ghost" className="text-muted-foreground" onClick={() => unlink.mutate(undefined, { onSuccess: onDone })}>
          Unlink
        </Button>
      </div>
    );
  }
  // Money in can pay back what friends owe you; money out, what you owe them.
  const direction = txn.direction === "credit" ? "they_owe" : "you_owe";
  const open = (loans ?? []).filter((l) => l.direction === direction && l.status !== "settled" && l.principalPaise - l.paidPaise >= txn.amountPaise);
  if ((txn.kind !== "income" && txn.kind !== "expense") || open.length === 0) return null;
  return (
    <div className="flex items-center gap-2">
      <NativeSelect value={loanId} onChange={(e) => setLoanId(e.target.value ? Number(e.target.value) : "")} aria-label="Payback for" className="flex-1">
        <option value="">{txn.direction === "credit" ? "It's a payback from…" : "It's me paying back…"}</option>
        {open.map((l) => (
          <option key={l.id} value={l.id}>
            {l.person} · {formatPaise(l.principalPaise - l.paidPaise)} left{l.reason ? ` · ${l.reason}` : ""}
          </option>
        ))}
      </NativeSelect>
      <Button type="button" size="sm" disabled={!loanId || link.isPending} onClick={() => link.mutate(undefined, { onSuccess: onDone })}>
        Link
      </Button>
    </div>
  );
}
