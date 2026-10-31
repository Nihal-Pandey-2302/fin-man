import { cn } from "cn";
import type { Category } from "@shared/api";

type Props = {
  categories: Category[];
  value: number | null | undefined;
  onChange: (id: number) => void;
  /** Hide income-only categories for spends and vice versa (simple name heuristic). */
  direction?: "debit" | "credit";
  className?: string;
};

const INCOME = new Set(["Salary", "Other income"]);

export function CategoryPicker({ categories, value, onChange, direction, className }: Props) {
  const list = categories.filter(
    (c) => !c.archived && (direction === "credit" ? true : !INCOME.has(c.name) || c.id === value),
  );
  if (direction === "credit") list.sort((a, b) => Number(INCOME.has(b.name)) - Number(INCOME.has(a.name)));
  return (
    <div className={cn("grid grid-cols-4 gap-2 sm:grid-cols-5", className)}>
      {list.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onChange(c.id)}
          className={cn(
            "flex min-h-[4.5rem] flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 text-center text-[11px] leading-tight transition-colors active:scale-95",
            c.id === value ? "border-primary bg-primary/10 font-medium" : "border-transparent bg-muted/50 hover:bg-muted",
          )}
        >
          <span className="text-2xl leading-none">{c.emoji ?? "•"}</span>
          <span className="line-clamp-2">{c.name}</span>
        </button>
      ))}
    </div>
  );
}

export function CategoryBadge({ category }: { category: Category | undefined }) {
  return (
    <span
      className="flex size-10 shrink-0 items-center justify-center rounded-full text-lg"
      style={{ backgroundColor: category?.color ? `${category.color}26` : "var(--muted)" }}
      aria-hidden
    >
      {category?.emoji ?? "❔"}
    </span>
  );
}
