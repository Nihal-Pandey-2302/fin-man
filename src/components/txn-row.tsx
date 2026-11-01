import { ArrowLeftRight, CreditCard } from "lucide-react";
import { memo } from "react";
import type { Txn } from "@shared/api";
import { formatPaise } from "@shared/money";
import { formatTime } from "@shared/time";
import { CategoryBadge } from "@/components/category-picker";
import { Money } from "@/components/money";
import { isPairedKind, txnTitle, type ListTxn } from "@/lib/labels";
import { useLookups } from "@/lib/queries";

export const TxnRow = memo(function TxnRow({ txn, onOpen }: { txn: ListTxn; onOpen?: (t: Txn) => void }) {
  const { category, account } = useLookups();
  const cat = category(txn.categoryId);
  const acc = account(txn.accountId);
  const paired = isPairedKind(txn.kind);
  return (
    <button
      type="button"
      onClick={() => onOpen?.(txn)}
      className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted/60 active:bg-muted"
    >
      {paired ? (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {txn.kind === "card_payment" ? <CreditCard className="size-4" /> : <ArrowLeftRight className="size-4" />}
        </span>
      ) : (
        <CategoryBadge category={cat} />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-medium">{txnTitle(txn, cat?.name)}</span>
          {txn.status === "needs_review" && <span className="size-1.5 shrink-0 rounded-full bg-amber-500" aria-label="needs review" />}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {[
            txn.pairedTo ? `${acc?.name} → ${account(txn.pairedTo)?.name}` : acc?.name,
            formatTime(new Date(txn.occurredAt)),
            cat && !paired && txn.merchant ? cat.name : null,
            txn.sharePaise !== null ? `your share ${formatPaise(txn.sharePaise)}` : null,
            txn.loanId ? "IOU payback" : null,
            txn.note,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      <Money paise={txn.amountPaise} direction={txn.direction} neutral={paired} className="shrink-0 font-medium" />
    </button>
  );
});
