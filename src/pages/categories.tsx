import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Wand2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import type { Category, Kind, Rule } from "@shared/api";
import { NativeSelect } from "@/components/native-select";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { del, patch, post } from "@/lib/api";
import { KIND_LABEL } from "@/lib/labels";
import { invalidateLedger, keys, useLookups, useRules } from "@/lib/queries";
import { SubPageHeader } from "./more";

export default function CategoriesPage() {
  const [editingCat, setEditingCat] = useState<Category | "new" | null>(null);
  const [editingRule, setEditingRule] = useState<Rule | "new" | null>(null);
  const [tab, setTab] = useState("categories");
  const { categories, category } = useLookups();
  const { data: rules } = useRules();

  return (
    <div className="space-y-4">
      <SubPageHeader
        title="Categories & rules"
        action={
          <Button size="sm" onClick={() => (tab === "categories" ? setEditingCat("new") : setEditingRule("new"))}>
            <Plus /> Add
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="rules">Rules{rules ? ` (${rules.length})` : ""}</TabsTrigger>
        </TabsList>
        <TabsContent value="categories">
          <Card className="gap-0 divide-y py-0">
            {categories.map((c) => (
              <button key={c.id} type="button" onClick={() => setEditingCat(c)} className={`flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 ${c.archived ? "opacity-50" : ""}`}>
                <span className="flex size-9 items-center justify-center rounded-full text-lg" style={{ backgroundColor: c.color ? `${c.color}26` : undefined }}>
                  {c.emoji}
                </span>
                <span className="flex-1">{c.name}</span>
                {c.isEssential && <Badge variant="secondary">Essential</Badge>}
                {c.archived && <Badge variant="outline">Archived</Badge>}
              </button>
            ))}
          </Card>
        </TabsContent>
        <TabsContent value="rules" className="space-y-2">
          <p className="px-1 text-sm text-muted-foreground">Rules are learned when you categorise a transaction. Merchant and UPI ID are matched case-insensitively; the longest match wins.</p>
          <Card className="gap-0 divide-y py-0">
            {rules?.map((r) => {
              const cat = category(r.categoryId);
              return (
                <button key={r.id} type="button" onClick={() => setEditingRule(r)} className="flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50">
                  <code className="min-w-0 flex-1 truncate text-sm">{r.matchType === "regex" ? `/${r.match}/` : r.match}</code>
                  <span className="text-sm">
                    {cat ? `${cat.emoji} ${cat.name}` : "—"}
                    {r.kindOverride && <span className="text-muted-foreground"> · {KIND_LABEL[r.kindOverride]}</span>}
                  </span>
                  <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">{r.hits}×</span>
                </button>
              );
            })}
          </Card>
        </TabsContent>
      </Tabs>
      <ResponsiveSheet open={editingCat !== null} onOpenChange={(o) => !o && setEditingCat(null)} title={editingCat === "new" ? "New category" : "Edit category"}>
        {editingCat !== null && <CategoryForm initial={editingCat === "new" ? null : editingCat} onDone={() => setEditingCat(null)} />}
      </ResponsiveSheet>
      <ResponsiveSheet open={editingRule !== null} onOpenChange={(o) => !o && setEditingRule(null)} title={editingRule === "new" ? "New rule" : "Edit rule"}>
        {editingRule !== null && <RuleForm initial={editingRule === "new" ? null : editingRule} onDone={() => setEditingRule(null)} />}
      </ResponsiveSheet>
    </div>
  );
}

function CategoryForm({ initial, onDone }: { initial: Category | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(initial?.name ?? "");
  const [emoji, setEmoji] = useState(initial?.emoji ?? "");
  const [color, setColor] = useState(initial?.color ?? "#a1a1aa");
  const [essential, setEssential] = useState(initial?.isEssential ?? false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = { name: name.trim(), emoji: emoji.trim() || null, color, isEssential: essential };
    if (initial) await patch(`/categories/${initial.id}`, body);
    else await post("/categories", body);
    invalidateLedger(qc);
    onDone();
  };
  const remove = async () => {
    const r = await del<{ archived?: boolean }>(`/categories/${initial!.id}`);
    toast.success(r.archived ? "Archived (it's in use)" : "Deleted");
    invalidateLedger(qc);
    onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-4 pb-2">
      <div className="grid grid-cols-[5rem_1fr_4rem] gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="cat-emoji">Emoji</Label>
          <Input id="cat-emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} className="h-11 text-center text-xl md:h-9" maxLength={8} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cat-name">Name</Label>
          <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} className="h-11 md:h-9" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cat-color">Colour</Label>
          <Input id="cat-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-11 p-1 md:h-9" />
        </div>
      </div>
      <label className="flex items-center justify-between text-sm">
        Essential (rent, groceries, bills…) <Switch checked={essential} onCheckedChange={setEssential} />
      </label>
      <div className="flex gap-2">
        {initial && !initial.archived && (
          <Button type="button" variant="ghost" className="text-destructive" onClick={remove}>
            <Trash2 /> Remove
          </Button>
        )}
        {initial?.archived && (
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              await patch(`/categories/${initial.id}`, { archived: false });
              invalidateLedger(qc);
              onDone();
            }}
          >
            Restore
          </Button>
        )}
        <Button type="submit" className="ml-auto" disabled={!name.trim()}>
          Save
        </Button>
      </div>
    </form>
  );
}

const OVERRIDES: Kind[] = ["investment", "fee", "interest", "refund"];

function RuleForm({ initial, onDone }: { initial: Rule | null; onDone: () => void }) {
  const qc = useQueryClient();
  const { activeCategories } = useLookups();
  const [match, setMatch] = useState(initial?.match ?? "");
  const [matchType, setMatchType] = useState<Rule["matchType"]>(initial?.matchType ?? "substring");
  const [categoryId, setCategoryId] = useState<number | null>(initial?.categoryId ?? null);
  const [kindOverride, setKindOverride] = useState<Kind | null>(initial?.kindOverride ?? null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.rules });
    invalidateLedger(qc);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = { match: match.trim(), categoryId, kindOverride };
    if (initial) await patch(`/rules/${initial.id}`, body);
    else await post("/rules", { ...body, matchType });
    refresh();
    onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-4 pb-2">
      <div className="grid grid-cols-[1fr_8rem] gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="r-match">Merchant / UPI ID contains</Label>
          <Input id="r-match" value={match} onChange={(e) => setMatch(e.target.value)} className="h-11 font-mono md:h-9" placeholder="swiggy" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="r-type">Match</Label>
          <NativeSelect id="r-type" value={matchType} disabled={!!initial} onChange={(e) => setMatchType(e.target.value as Rule["matchType"])}>
            <option value="substring">Text</option>
            <option value="regex">Regex</option>
          </NativeSelect>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="r-cat">Category</Label>
          <NativeSelect id="r-cat" value={categoryId ?? ""} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">—</option>
            {activeCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="r-kind">Treat as</Label>
          <NativeSelect id="r-kind" value={kindOverride ?? ""} onChange={(e) => setKindOverride((e.target.value || null) as Kind | null)}>
            <option value="">Expense / income</option>
            {OVERRIDES.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {initial && (
          <>
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              onClick={async () => {
                await del(`/rules/${initial.id}`);
                refresh();
                onDone();
              }}
            >
              <Trash2 /> Delete
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                const { applied } = await post<{ applied: number }>(`/rules/${initial.id}/apply`);
                toast.success(applied ? `Categorised ${applied} transactions` : "Nothing uncategorised matched");
                refresh();
              }}
            >
              <Wand2 /> Apply to past
            </Button>
          </>
        )}
        <Button type="submit" className="ml-auto" disabled={match.trim().length < 2}>
          Save
        </Button>
      </div>
    </form>
  );
}
