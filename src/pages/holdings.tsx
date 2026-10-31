import { useQueryClient } from "@tanstack/react-query";
import { Lock, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { Holding } from "@shared/api";
import { formatPaise, rupeesToPaise } from "@shared/money";
import { Money } from "@/components/money";
import { NativeSelect } from "@/components/native-select";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { RupeeInput } from "@/components/rupee-input";
import { paiseToInput } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { del, patch, post } from "@/lib/api";
import { keys, useDashboard, useHoldings, useLookups } from "@/lib/queries";
import { relativeTime } from "@/lib/relative";
import { SubPageHeader } from "./more";

const TYPE_LABEL = { mutual_fund: "Mutual fund", stock: "Stock", fd: "Fixed deposit", ppf: "PPF", other: "Other" } as const;

export default function HoldingsPage() {
  const { data } = useHoldings();
  const { data: d } = useDashboard();
  const { activeAccounts } = useLookups();
  const [editing, setEditing] = useState<Holding | "new" | null>(null);

  const invested = data?.reduce((s, h) => s + h.investedPaise, 0) ?? 0;
  const current = data?.reduce((s, h) => s + (h.currentValuePaise ?? h.investedPaise), 0) ?? 0;
  const cardDebt = activeAccounts.filter((a) => a.kind === "credit_card").reduce((s, a) => s + Math.max(0, a.balance.balancePaise), 0);
  const lien = activeAccounts.reduce((s, a) => s + (a.fdLienPaise ?? 0), 0);
  const netWorth = (d?.liquidPaise ?? 0) + current - cardDebt;

  return (
    <div className="space-y-4">
      <SubPageHeader
        title="Holdings"
        action={
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus /> Add
          </Button>
        }
      />
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Figure label="Net worth" paise={netWorth} strong />
          <Figure label="Investments" paise={current} sub={invested ? `${(((current - invested) / invested) * 100).toFixed(1)}% on ${formatPaise(invested)}` : undefined} />
          <Figure label="Bank & cash" paise={d?.liquidPaise ?? 0} />
          <Figure label="Card owed" paise={-cardDebt} sub={lien ? `FD lien ${formatPaise(lien)} locked` : undefined} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Updated by hand</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {data?.length === 0 && <p className="text-sm text-muted-foreground">Add your mutual funds, stocks, FDs and PPF to see your net worth.</p>}
          {data?.map((h) => (
            <button key={h.id} type="button" onClick={() => setEditing(h)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-muted/60">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 truncate font-medium">
                  {h.name} {h.type === "fd" && lien > 0 && <Lock className="size-3 text-muted-foreground" />}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {TYPE_LABEL[h.type]}
                  {h.platform && ` · ${h.platform}`} · updated {relativeTime(h.updatedAt)}
                </span>
              </span>
              <span className="text-right">
                <Money paise={h.currentValuePaise ?? h.investedPaise} className="block font-medium" />
                <span className="text-xs text-muted-foreground tabular-nums">invested {formatPaise(h.investedPaise)}</span>
              </span>
            </button>
          ))}
        </CardContent>
      </Card>
      <ResponsiveSheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={editing === "new" ? "New holding" : "Update holding"}>
        {editing !== null && <HoldingForm initial={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      </ResponsiveSheet>
    </div>
  );
}

function Figure({ label, paise, sub, strong }: { label: string; paise: number; sub?: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <Money paise={paise} className={strong ? "text-2xl font-semibold" : "text-lg font-medium"} />
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function HoldingForm({ initial, onDone }: { initial: Holding | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<Holding["type"]>(initial?.type ?? "mutual_fund");
  const [platform, setPlatform] = useState(initial?.platform ?? "");
  const [invested, setInvested] = useState(paiseToInput(initial?.investedPaise));
  const [value, setValue] = useState(paiseToInput(initial?.currentValuePaise));
  const refresh = () => void qc.invalidateQueries({ queryKey: keys.holdings });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = { name: name.trim(), type, platform: platform.trim() || null, investedPaise: rupeesToPaise(invested) ?? 0, currentValuePaise: rupeesToPaise(value) };
    if (initial) await patch(`/holdings/${initial.id}`, body);
    else await post("/holdings", body);
    refresh();
    onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-4 pb-2">
      <div className="space-y-1.5">
        <Label htmlFor="h-name">Name</Label>
        <Input id="h-name" value={name} onChange={(e) => setName(e.target.value)} className="h-11 md:h-9" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="h-type">Type</Label>
          <NativeSelect id="h-type" value={type} onChange={(e) => setType(e.target.value as Holding["type"])}>
            {Object.entries(TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="h-platform">Platform</Label>
          <Input id="h-platform" value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="Groww, HDFC…" className="h-11 md:h-9" />
        </div>
        <div className="space-y-1.5">
          <Label>Invested</Label>
          <RupeeInput value={invested} onChange={setInvested} />
        </div>
        <div className="space-y-1.5">
          <Label>Current value</Label>
          <RupeeInput value={value} onChange={setValue} />
        </div>
      </div>
      <div className="flex gap-2">
        {initial && (
          <Button
            type="button"
            variant="ghost"
            className="text-destructive"
            onClick={async () => {
              await del(`/holdings/${initial.id}`);
              refresh();
              onDone();
            }}
          >
            <Trash2 /> Delete
          </Button>
        )}
        <Button type="submit" className="ml-auto" disabled={!name.trim()}>
          Save
        </Button>
      </div>
    </form>
  );
}
