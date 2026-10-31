import { useQueryClient } from "@tanstack/react-query";
import { CreditCard, Landmark, Plus, Trash2, Wallet } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import type { Account } from "@shared/api";
import { formatPaise, rupeesToPaise } from "@shared/money";
import { formatShortDate } from "@shared/time";
import { Money } from "@/components/money";
import { NativeSelect } from "@/components/native-select";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { RupeeInput } from "@/components/rupee-input";
import { paiseToInput } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { del, patch, post } from "@/lib/api";
import { ACCOUNT_KIND_LABEL, INSTITUTION_LABEL, ROLE_LABEL } from "@/lib/labels";
import { invalidateLedger, useBootstrap, useLookups } from "@/lib/queries";
import { relativeTime } from "@/lib/relative";
import { SubPageHeader } from "./more";

type Institution = Account["institution"];
type FormState = {
  name: string;
  institution: Institution;
  kind: Account["kind"];
  role: Account["role"];
  numbers: { last4: string; label: string }[];
  creditLimit: string;
  statementDay: string;
  dueDay: string;
  fdLien: string;
};

const blank: FormState = { name: "", institution: "OTHER", kind: "bank", role: "other", numbers: [], creditLimit: "", statementDay: "", dueDay: "", fdLien: "" };

/** PLAN.md §1: the owner's setup. Numbers are typed in by the owner, never stored in code. */
const PRESETS: FormState[] = [
  { ...blank, name: "HDFC Bank", institution: "HDFC", kind: "bank", role: "salary", numbers: [{ last4: "", label: "" }] },
  { ...blank, name: "IDFC FIRST", institution: "IDFC", kind: "bank", role: "spending", numbers: [{ last4: "", label: "" }] },
  { ...blank, name: "Indian Bank", institution: "INDIAN", kind: "bank", role: "autopay", numbers: [{ last4: "", label: "" }] },
  {
    ...blank,
    name: "IDFC Credit Card",
    institution: "IDFC",
    kind: "credit_card",
    role: "card",
    numbers: [
      { last4: "", label: "RuPay (UPI)" },
      { last4: "", label: "Mastercard" },
    ],
  },
  { ...blank, name: "Cash", institution: "CASH", kind: "cash", role: "other" },
];

const toBody = (f: FormState) => ({
  name: f.name.trim(),
  institution: f.institution,
  kind: f.kind,
  role: f.role,
  numbers: f.numbers.filter((n) => /^\d{4}$/.test(n.last4)).map((n) => ({ last4: n.last4, label: n.label.trim() || null })),
  creditLimitPaise: f.kind === "credit_card" ? rupeesToPaise(f.creditLimit) : null,
  statementDay: f.kind === "credit_card" && f.statementDay ? Number(f.statementDay) : null,
  dueDay: f.kind === "credit_card" && f.dueDay ? Number(f.dueDay) : null,
  fdLienPaise: f.kind === "credit_card" ? rupeesToPaise(f.fdLien) : null,
});

const fromAccount = (a: Account): FormState => ({
  name: a.name,
  institution: a.institution,
  kind: a.kind,
  role: a.role,
  numbers: a.numbers.map((n) => ({ last4: n.last4, label: n.label ?? "" })),
  creditLimit: paiseToInput(a.creditLimitPaise),
  statementDay: a.statementDay ? String(a.statementDay) : "",
  dueDay: a.dueDay ? String(a.dueDay) : "",
  fdLien: paiseToInput(a.fdLienPaise),
});

export default function AccountsPage() {
  const { isPending } = useBootstrap();
  const { accounts } = useLookups();
  const [editing, setEditing] = useState<Account | "new" | null>(null);
  const [correcting, setCorrecting] = useState<Account | null>(null);

  return (
    <div className="space-y-4">
      <SubPageHeader
        title="Accounts"
        action={
          accounts.length > 0 && (
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus /> Add
            </Button>
          )
        }
      />
      {!isPending && accounts.length === 0 ? (
        <SetupWizard />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {accounts.map((a) => (
            <AccountCard key={a.id} account={a} onEdit={() => setEditing(a)} onCorrect={() => setCorrecting(a)} />
          ))}
        </div>
      )}
      <ResponsiveSheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={editing === "new" ? "New account" : "Edit account"}>
        {editing !== null && <AccountForm initial={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      </ResponsiveSheet>
      <ResponsiveSheet
        open={correcting !== null}
        onOpenChange={(o) => !o && setCorrecting(null)}
        title={correcting?.kind === "credit_card" ? "Set card outstanding" : "Correct balance"}
        description="What the bank shows right now. Later SMS and transactions build on this."
      >
        {correcting && <BalanceForm account={correcting} onDone={() => setCorrecting(null)} />}
      </ResponsiveSheet>
    </div>
  );
}

function AccountCard({ account: a, onEdit, onCorrect }: { account: Account; onEdit: () => void; onCorrect: () => void }) {
  const Icon = a.kind === "credit_card" ? CreditCard : a.kind === "cash" ? Wallet : Landmark;
  const card = a.kind === "credit_card";
  return (
    <Card className={a.archived ? "opacity-50" : undefined}>
      <CardContent className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-muted">
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">{a.name}</p>
            <p className="text-xs text-muted-foreground">
              {ROLE_LABEL[a.role]} · {a.numbers.map((n) => `••${n.last4}${n.label ? ` ${n.label}` : ""}`).join(", ") || "no numbers"}
            </p>
          </div>
          {a.archived && <Badge variant="secondary">Archived</Badge>}
        </div>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{card ? "Outstanding" : "Balance"}</p>
            <Money paise={a.balance.balancePaise} className="text-2xl font-semibold" />
            <p className="text-xs text-muted-foreground">
              {a.balance.asOf ? `${a.balance.basis === "sms" ? "from SMS" : "set manually"} ${relativeTime(a.balance.asOf)}` : "not set yet"}
              {card && a.balance.nextDueOn && ` · due ${formatShortDate(a.balance.nextDueOn)}`}
            </p>
          </div>
          {card && a.creditLimitPaise && (
            <div className="text-right text-xs text-muted-foreground">
              <p>Limit {formatPaise(a.creditLimitPaise)}</p>
              {a.fdLienPaise ? <p>FD lien {formatPaise(a.fdLienPaise)} 🔒</p> : null}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onCorrect}>
            {card ? "Set outstanding" : "Correct balance"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Edit
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SetupWizard() {
  const [forms, setForms] = useState(PRESETS);
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();
  const set = (i: number, patchFn: (f: FormState) => FormState) => setForms((all) => all.map((f, j) => (j === i ? patchFn(f) : f)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      let recovered = 0;
      for (const f of forms) recovered += (await post<{ recoveredSms: number }>("/accounts", toBody(f))).recoveredSms;
      toast.success(`Accounts created${recovered ? ` · imported ${recovered} waiting SMS` : ""}`);
      invalidateLedger(qc);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up your accounts</CardTitle>
        <CardDescription>Enter the last 4 digits each bank shows in its SMS (e.g. “A/c XX1234”). Your card has two numbers that share one limit.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-5">
          {forms.map((f, i) => (
            <fieldset key={f.name} className="space-y-2">
              <legend className="text-sm font-medium">
                {f.name} <span className="font-normal text-muted-foreground">· {ROLE_LABEL[f.role]}</span>
              </legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {f.numbers.map((n, k) => (
                  <Input
                    key={k}
                    inputMode="numeric"
                    placeholder={n.label ? `${n.label} last 4` : "Last 4 digits"}
                    value={n.last4}
                    onChange={(e) => set(i, (x) => ({ ...x, numbers: x.numbers.map((m, kk) => (kk === k ? { ...m, last4: e.target.value.replace(/\D/g, "").slice(0, 4) } : m)) }))}
                    className="h-11 md:h-9"
                  />
                ))}
                {f.kind === "credit_card" && (
                  <>
                    <RupeeInput placeholder="Credit limit" value={f.creditLimit} onChange={(v) => set(i, (x) => ({ ...x, creditLimit: v }))} />
                    <Input inputMode="numeric" placeholder="Bill due day" value={f.dueDay} onChange={(e) => set(i, (x) => ({ ...x, dueDay: e.target.value.replace(/\D/g, "").slice(0, 2) }))} className="h-11 md:h-9" />
                    <Input inputMode="numeric" placeholder="Statement day" value={f.statementDay} onChange={(e) => set(i, (x) => ({ ...x, statementDay: e.target.value.replace(/\D/g, "").slice(0, 2) }))} className="h-11 md:h-9" />
                    <RupeeInput placeholder="FD lien" value={f.fdLien} onChange={(v) => set(i, (x) => ({ ...x, fdLien: v }))} />
                  </>
                )}
              </div>
            </fieldset>
          ))}
          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? "Creating…" : "Create accounts"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function AccountForm({ initial, onDone }: { initial: Account | null; onDone: () => void }) {
  const [f, setF] = useState<FormState>(initial ? fromAccount(initial) : blank);
  const qc = useQueryClient();
  const update = (p: Partial<FormState>) => setF((x) => ({ ...x, ...p }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const res = initial ? await patch<{ recoveredSms: number }>(`/accounts/${initial.id}`, toBody(f)) : await post<{ recoveredSms: number }>("/accounts", toBody(f));
    toast.success(`Saved${res.recoveredSms ? ` · imported ${res.recoveredSms} waiting SMS` : ""}`);
    invalidateLedger(qc);
    onDone();
  };
  const remove = async () => {
    const res = await del<{ archived?: boolean }>(`/accounts/${initial!.id}`);
    toast.success(res.archived ? "Archived (it has history)" : "Deleted");
    invalidateLedger(qc);
    onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-4 pb-2">
      <div className="space-y-1.5">
        <Label htmlFor="ac-name">Name</Label>
        <Input id="ac-name" value={f.name} onChange={(e) => update({ name: e.target.value })} className="h-11 md:h-9" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="ac-inst">Bank</Label>
          <NativeSelect id="ac-inst" value={f.institution} onChange={(e) => update({ institution: e.target.value as Institution })}>
            {Object.entries(INSTITUTION_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ac-kind">Kind</Label>
          <NativeSelect id="ac-kind" value={f.kind} onChange={(e) => update({ kind: e.target.value as Account["kind"] })}>
            {Object.entries(ACCOUNT_KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ac-role">Role</Label>
          <NativeSelect id="ac-role" value={f.role} onChange={(e) => update({ role: e.target.value as Account["role"] })}>
            {Object.entries(ROLE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="space-y-2">
        <Label>Numbers in SMS (last 4)</Label>
        {f.numbers.map((n, i) => (
          <div key={i} className="flex gap-2">
            <Input
              inputMode="numeric"
              placeholder="1234"
              value={n.last4}
              onChange={(e) => update({ numbers: f.numbers.map((m, j) => (j === i ? { ...m, last4: e.target.value.replace(/\D/g, "").slice(0, 4) } : m)) })}
              className="h-11 w-24 md:h-9"
            />
            <Input
              placeholder="Label (optional)"
              value={n.label}
              onChange={(e) => update({ numbers: f.numbers.map((m, j) => (j === i ? { ...m, label: e.target.value } : m)) })}
              className="h-11 md:h-9"
            />
            <Button type="button" variant="ghost" size="icon" aria-label="Remove number" onClick={() => update({ numbers: f.numbers.filter((_, j) => j !== i) })}>
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => update({ numbers: [...f.numbers, { last4: "", label: "" }] })}>
          <Plus /> Add number
        </Button>
      </div>
      {f.kind === "credit_card" && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Credit limit</Label>
            <RupeeInput value={f.creditLimit} onChange={(v) => update({ creditLimit: v })} />
          </div>
          <div className="space-y-1.5">
            <Label>FD lien</Label>
            <RupeeInput value={f.fdLien} onChange={(v) => update({ fdLien: v })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ac-stmt">Statement day</Label>
            <Input id="ac-stmt" inputMode="numeric" value={f.statementDay} onChange={(e) => update({ statementDay: e.target.value.replace(/\D/g, "").slice(0, 2) })} className="h-11 md:h-9" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ac-due">Due day</Label>
            <Input id="ac-due" inputMode="numeric" value={f.dueDay} onChange={(e) => update({ dueDay: e.target.value.replace(/\D/g, "").slice(0, 2) })} className="h-11 md:h-9" />
          </div>
        </div>
      )}
      <div className="flex gap-2">
        {initial && (
          <Button type="button" variant="ghost" className="text-destructive" onClick={remove}>
            <Trash2 /> {initial.archived ? "Delete" : "Remove"}
          </Button>
        )}
        {initial?.archived && (
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              await patch(`/accounts/${initial.id}`, { archived: false });
              invalidateLedger(qc);
              onDone();
            }}
          >
            Restore
          </Button>
        )}
        <Button type="submit" className="ml-auto" disabled={!f.name.trim()}>
          Save
        </Button>
      </div>
    </form>
  );
}

function BalanceForm({ account, onDone }: { account: Account; onDone: () => void }) {
  const [amount, setAmount] = useState(paiseToInput(account.balance.balancePaise));
  const qc = useQueryClient();
  const paise = rupeesToPaise(amount.replace(/^-/, ""));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (paise === null) return;
    await post(`/accounts/${account.id}/balance`, { balancePaise: amount.startsWith("-") ? -paise : paise });
    toast.success("Balance updated");
    invalidateLedger(qc);
    onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-4 pb-2">
      <RupeeInput value={amount} onChange={setAmount} autoFocus />
      <Button type="submit" className="w-full" disabled={paise === null}>
        Save
      </Button>
    </form>
  );
}
