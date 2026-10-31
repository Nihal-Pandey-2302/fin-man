import { cn } from "cn";
import { formatPaise } from "@shared/money";

type Props = {
  paise: number;
  /** Debits show as −, credits as + (green). Omit for plain amounts. */
  direction?: "debit" | "credit";
  /** Muted styling for transfers/card payments (money that only moved between own accounts). */
  neutral?: boolean;
  exact?: boolean;
  className?: string;
};

export function Money({ paise, direction, neutral, exact, className }: Props) {
  const sign = direction === "debit" ? "−" : direction === "credit" ? "+" : paise < 0 ? "−" : "";
  return (
    <span
      className={cn(
        "tabular-nums",
        direction === "credit" && !neutral && "text-emerald-600 dark:text-emerald-400",
        neutral && "text-muted-foreground",
        className,
      )}
    >
      {sign}
      {formatPaise(Math.abs(paise), { exact })}
    </span>
  );
}
