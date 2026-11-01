import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, Check, Copy, Download, LogOut, Moon, Plus, Sun, SunMoon, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { cn } from "cn";
import { formatPaise, rupeesToPaise } from "@shared/money";
import { NativeSelect } from "@/components/native-select";
import { useTheme, type Theme } from "@/components/theme";
import { RupeeInput } from "@/components/rupee-input";
import { paiseToInput } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, del, errorMessage, patch, post } from "@/lib/api";
import { invalidateLedger, queryClient, useDashboard, useLookups, type Session } from "@/lib/queries";
import { relativeTime } from "@/lib/relative";
import { SubPageHeader } from "./more";

export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <SubPageHeader title="Settings" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <GeneralCard />
        <SmsSetupCard />
        <NotificationsCard />
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
  const [autopayBuffer, setAutopayBuffer] = useState(paiseToInput(settings?.autopay_buffer_paise));
  const [employer, setEmployer] = useState(settings?.salary_employer ?? "");
  const [salaryMin, setSalaryMin] = useState(paiseToInput(settings?.salary_min_paise));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await patch("/settings", {
      owner_names: names.split(",").map((n) => n.trim()).filter((n) => n.length >= 2),
      liquid_buffer_paise: rupeesToPaise(buffer) ?? 0,
      autopay_buffer_paise: rupeesToPaise(autopayBuffer) ?? 0,
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="s-buffer">Liquid buffer</Label>
              <RupeeInput id="s-buffer" value={buffer} onChange={setBuffer} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-abuffer">Autopay buffer</Label>
              <RupeeInput id="s-abuffer" value={autopayBuffer} onChange={setAutopayBuffer} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Liquid buffer: money you never want to touch (“free after buffer”). Autopay buffer: extra the salary-day plan keeps in the autopay account.</p>
          <Button type="submit">Save</Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** Is forwarding alive? The newest SMS the server has seen. */
function SmsStatus() {
  const { data: d } = useDashboard();
  if (!d) return null;
  const stale = d.alerts.some((a) => a.key.startsWith("sms_stale:"));
  return (
    <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
      <span className={cn("size-2 shrink-0 rounded-full", d.lastSmsAt === null ? "bg-muted-foreground" : stale ? "bg-amber-500" : "bg-emerald-500")} />
      {d.lastSmsAt === null ? "No SMS received yet" : `Last SMS received ${relativeTime(d.lastSmsAt)}`}
    </p>
  );
}

function SmsSetupCard() {
  const [copied, setCopied] = useState<string | null>(null);
  const url = `${location.origin}/api/ingest/sms`;
  const body = `{"sender":"[sms_number]","body":"[sms_message]","received_at":"[sms_time]"}`;
  const { data: forwarding } = useQuery({ queryKey: ["sms-forwarding"], queryFn: () => api<{ secret: string | null }>("/sms-forwarding"), staleTime: Infinity });
  const secret = forwarding?.secret;
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
        <CardDescription>
          MacroDroid: trigger “SMS received” from senders containing <b>IDFCFB</b>, <b>INDBNK</b> or <b>HDFCBK</b> (the AX-/VM-… prefix varies), constraint “text doesn't contain OTP / one time password / verification code”, action HTTP POST.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <SmsStatus />
        <CopyRow label="URL" value={url} copied={copied} onCopy={copy} />
        <CopyRow label="Header name" value="Authorization" copied={copied} onCopy={copy} />
        {secret ? (
          <CopyRow label="Header value" value={`Bearer ${secret}`} shown={`Bearer ••••••••${secret.slice(-4)}`} copied={copied} onCopy={copy} />
        ) : (
          <CopyRow label="Header value" value="Bearer <INGEST_SECRET>" copied={copied} onCopy={copy} />
        )}
        <CopyRow label="JSON body" value={body} copied={copied} onCopy={copy} />
        <p className="text-xs text-muted-foreground">Turn off battery optimisation for MacroDroid and enable retry on network failure. Duplicates are harmless — every SMS is stored once.</p>
      </CardContent>
    </Card>
  );
}

/** `shown` replaces what's displayed (e.g. a masked secret); the copy button always copies `value`. */
function CopyRow({ label, value, shown, copied, onCopy }: { label: string; value: string; shown?: string; copied: string | null; onCopy: (label: string, text: string) => void }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 text-xs">{shown ?? value}</code>
        <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Copy ${label}`} onClick={() => onCopy(label, value)}>
          {copied === label ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}

const b64ToBytes = (b64url: string) => {
  const b64 = (b64url + "=".repeat((4 - (b64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};

function NotificationsCard() {
  const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const [key, setKey] = useState<string | null | undefined>(undefined);
  const [sub, setSub] = useState<PushSubscription | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supported) return;
    api<{ publicKey: string | null }>("/push/key").then((r) => setKey(r.publicKey), () => setKey(null));
    navigator.serviceWorker.getRegistration().then((reg) => reg?.pushManager.getSubscription().then(setSub));
  }, [supported]);

  const enable = async () => {
    setBusy(true);
    try {
      if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked for this site");
      const reg = await navigator.serviceWorker.ready;
      const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key!) });
      await post("/push/subscribe", s.toJSON());
      setSub(s);
      toast.success("Notifications on");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const disable = async () => {
    if (!sub) return;
    await post("/push/unsubscribe", { endpoint: sub.endpoint });
    await sub.unsubscribe();
    setSub(null);
  };
  const test = async () => {
    const r = await post<{ sent: number }>("/push/test");
    toast[r.sent ? "success" : "error"](r.sent ? "Test sent" : "Nothing was delivered");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>A 9 am nudge for card bills, autopays, a missing salary and the review inbox. Install the app to the home screen first on Android.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {!supported ? (
          <p className="text-sm text-muted-foreground">This browser doesn't support push notifications.</p>
        ) : key === null ? (
          <p className="text-sm text-muted-foreground">Not configured on the server (VAPID keys missing — run `npm run vapid`).</p>
        ) : sub ? (
          <>
            <Button variant="outline" onClick={test}>
              <Bell /> Send a test
            </Button>
            <Button variant="ghost" onClick={disable}>
              <BellOff /> Turn off
            </Button>
          </>
        ) : (
          <Button onClick={enable} disabled={busy || key === undefined}>
            <Bell /> Turn on notifications
          </Button>
        )}
      </CardContent>
    </Card>
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
          <RupeeInput placeholder="Amount" value={amount} onChange={setAmount} />
          <NativeSelect aria-label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Category</option>
            {activeCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Account" value={accountId} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Account</option>
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
              className={`flex h-9 items-center justify-center gap-2 rounded-md text-sm ${theme === value ? "bg-card font-medium shadow-sm" : "text-muted-foreground"}`}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <a href="/api/export" download>
              <Download /> Full backup (JSON)
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a href="/api/export.csv" download>
              <Download /> Transactions (CSV)
            </a>
          </Button>
        </div>
        <Button
          variant="ghost"
          className="text-muted-foreground"
          onClick={async () => {
            await post("/auth/logout");
            // Flip the gate first (it watches the session query), then drop everything cached while signed in.
            queryClient.setQueryData<Session>(["session"], { configured: true, authenticated: false });
            queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "session" });
          }}
        >
          <LogOut /> Sign out of this device
        </Button>
      </CardContent>
    </Card>
  );
}
