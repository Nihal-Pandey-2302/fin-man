import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Download, Moon, Plus, Sun, SunMoon, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { formatPaise, rupeesToPaise } from "@shared/money";
import { NativeSelect } from "@/components/native-select";
import { useTheme, type Theme } from "@/components/theme";
import { RupeeInput } from "@/components/rupee-input";
import { paiseToInput } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { del, patch, post } from "@/lib/api";
import { invalidateLedger, useLookups } from "@/lib/queries";
import { SubPageHeader } from "./more";

export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <SubPageHeader title="Settings" />
      <div className="grid gap-4 lg:grid-cols-2">
        <GeneralCard />
        <SmsSetupCard />
        <PresetsCard />
        <AppearanceCard />
      </div>
    </div>
  );
}

function GeneralCard() {
  const { settings } = useLookups();
  const qc = useQueryClient();
  const [names, setNames] = useState((settings?.owner_names ?? []).join(", "));
  const [buffer, setBuffer] = useState(paiseToInput(settings?.liquid_buffer_paise));
  const [employer, setEmployer] = useState(settings?.salary_employer ?? "");
  const [salaryMin, setSalaryMin] = useState(paiseToInput(settings?.salary_min_paise));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await patch("/settings", {
      owner_names: names.split(",").map((n) => n.trim()).filter((n) => n.length >= 2),
      liquid_buffer_paise: rupeesToPaise(buffer) ?? 0,
      salary_employer: employer.trim(),
      salary_min_paise: rupeesToPaise(salaryMin) ?? 0,
    });
    toast.success("Settings saved");
    invalidateLedger(qc);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>You</CardTitle>
        <CardDescription>Used to recognise transfers between your own accounts and your salary.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="s-names">Your name as banks print it</Label>
            <Input id="s-names" value={names} onChange={(e) => setNames(e.target.value)} placeholder="e.g. Firstname Lastname, FIRSTNAME L" className="h-11 md:h-9" />
            <p className="text-xs text-muted-foreground">Comma-separated variants. A transfer to/from this name is treated as your own money moving.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="s-employer">Employer (salary SMS)</Label>
              <Input id="s-employer" value={employer} onChange={(e) => setEmployer(e.target.value)} className="h-11 md:h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-salary">Salary at least</Label>
              <RupeeInput id="s-salary" value={salaryMin} onChange={setSalaryMin} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-buffer">Liquid buffer</Label>
            <RupeeInput id="s-buffer" value={buffer} onChange={setBuffer} />
            <p className="text-xs text-muted-foreground">Money you never want to touch; shown as “free after buffer”.</p>
          </div>
          <Button type="submit">Save</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function SmsSetupCard() {
  const [copied, setCopied] = useState<string | null>(null);
  const url = `${location.origin}/api/ingest/sms`;
  const body = `{"sender":"[sms_number]","body":"[sms_message]","received_at":"[sms_time]"}`;
  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Copy failed");
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Phone SMS forwarding</CardTitle>
        <CardDescription>MacroDroid: trigger “SMS received” from your bank senders, constraint “text doesn't contain OTP / one time password / verification code”, action HTTP POST.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <CopyRow label="URL" value={url} copied={copied} onCopy={copy} />
        <CopyRow label="Header" value="Authorization: Bearer <INGEST_SECRET>" copied={copied} onCopy={copy} />
        <CopyRow label="JSON body" value={body} copied={copied} onCopy={copy} />
        <p className="text-xs text-muted-foreground">Turn off battery optimisation for MacroDroid and enable retry on network failure. Duplicates are harmless — every SMS is stored once.</p>
      </CardContent>
    </Card>
  );
}

function CopyRow({ label, value, copied, onCopy }: { label: string; value: string; copied: string | null; onCopy: (label: string, text: string) => void }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 text-xs">{value}</code>
        <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Copy ${label}`} onClick={() => onCopy(label, value)}>
          {copied === label ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}

function PresetsCard() {
  const { data, activeCategories, activeAccounts, category, account } = useLookups();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [accountId, setAccountId] = useState<number | "">("");
  const [amount, setAmount] = useState("");
  const add = async (e: FormEvent) => {
    e.preventDefault();
    await post("/presets", { name: name.trim(), categoryId: categoryId || null, accountId: accountId || null, amountPaise: rupeesToPaise(amount) });
    setName("");
    setAmount("");
    invalidateLedger(qc);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick-add presets</CardTitle>
        <CardDescription>One-tap buttons in Quick add (e.g. “Chai ₹20”, “Auto”).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {data?.presets.map((p) => (
          <div key={p.id} className="flex items-center gap-2 text-sm">
            <span className="flex-1">
              {p.name}
              <span className="text-muted-foreground">
                {" "}
                · {category(p.categoryId)?.emoji ?? ""} {category(p.categoryId)?.name ?? "—"}
                {p.amountPaise ? ` · ${formatPaise(p.amountPaise)}` : ""}
                {p.accountId ? ` · ${account(p.accountId)?.name}` : ""}
              </span>
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={`Delete ${p.name}`}
              onClick={async () => {
                await del(`/presets/${p.id}`);
                invalidateLedger(qc);
              }}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <form onSubmit={add} className="grid grid-cols-2 gap-2">
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="h-11 md:h-9" />
          <RupeeInput placeholder="Amount (optional)" value={amount} onChange={setAmount} />
          <NativeSelect aria-label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Category</option>
            {activeCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Account" value={accountId} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Default account</option>
            {activeAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" variant="outline" className="col-span-2" disabled={!name.trim() || !categoryId}>
            <Plus /> Add preset
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  const options: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: SunMoon },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance & data</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted p-1">
          {options.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              className={`flex h-9 items-center justify-center gap-2 rounded-md text-sm ${theme === value ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
        <Button variant="outline" asChild>
          <a href="/api/export" download>
            <Download /> Download backup (JSON)
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}
