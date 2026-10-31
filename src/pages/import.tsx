import { FileUp } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { errorMessage, post } from "@/lib/api";
import { invalidateLedger } from "@/lib/queries";
import { parseSmsBackup, type BackupSms } from "@/lib/sms-backup";
import { SubPageHeader } from "./more";

const BATCH = 20; // matches the server's IMPORT_BATCH
type Counts = { created: number; duplicate: number; ignored: number; unparsed: number; rejected: number };
const zero: Counts = { created: 0, duplicate: 0, ignored: 0, unparsed: 0, rejected: 0 };

export default function ImportPage() {
  const input = useRef<HTMLInputElement>(null);
  const [found, setFound] = useState<{ messages: BackupSms[]; total: number; otps: number } | null>(null);
  const [done, setDone] = useState(0);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [running, setRunning] = useState(false);

  const pick = async (file: File) => {
    try {
      setCounts(null);
      setDone(0);
      setFound(parseSmsBackup(await file.text()));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const run = async () => {
    if (!found) return;
    setRunning(true);
    const total = { ...zero };
    try {
      for (let i = 0; i < found.messages.length; i += BATCH) {
        const r = await post<Counts>("/import/sms", { messages: found.messages.slice(i, i + BATCH) });
        for (const k of Object.keys(total) as (keyof Counts)[]) total[k] += r[k];
        setDone(Math.min(found.messages.length, i + BATCH));
        setCounts({ ...total });
      }
      toast.success(`Imported ${total.created} transactions`);
    } catch (err) {
      toast.error(`Stopped: ${errorMessage(err)}. Run it again; already imported SMS are skipped.`);
    } finally {
      setRunning(false);
      invalidateLedger();
    }
  };

  const pct = found?.messages.length ? Math.round((done / found.messages.length) * 100) : 0;
  return (
    <div className="space-y-4">
      <SubPageHeader title="Import SMS backup" />
      <Card>
        <CardHeader>
          <CardTitle>SMS Backup & Restore</CardTitle>
          <CardDescription>
            Export your messages as XML from the “SMS Backup & Restore” app and pick the file here. Only bank messages are sent; OTPs are dropped on
            this device. Safe to repeat: each SMS is stored once.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input ref={input} type="file" accept=".xml,text/xml,application/xml" className="hidden" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
          <Button variant="outline" onClick={() => input.current?.click()} disabled={running}>
            <FileUp /> Choose XML file
          </Button>
          {found && (
            <div className="space-y-3 text-sm">
              <p>
                {found.total.toLocaleString("en-IN")} messages in the file · <b>{found.messages.length.toLocaleString("en-IN")} bank SMS</b> to import
                {found.otps ? ` · ${found.otps} OTPs skipped` : ""}
              </p>
              {found.messages.length > 0 && (
                <>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <Button onClick={run} disabled={running || done === found.messages.length}>
                    {running ? `Importing… ${pct}%` : done ? "Done" : `Import ${found.messages.length} SMS`}
                  </Button>
                </>
              )}
              {counts && (
                <p className="text-muted-foreground">
                  {counts.created} new transactions · {counts.duplicate} already had · {counts.unparsed} need a look (review inbox) · {counts.ignored} ignored
                  {counts.rejected ? ` · ${counts.rejected} not from a bank` : ""}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
