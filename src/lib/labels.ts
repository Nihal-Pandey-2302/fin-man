import type { Kind, Txn } from "@shared/api";

export const KIND_LABEL: Record<Kind, string> = {
  expense: "Expense",
  income: "Income",
  transfer: "Transfer (own accounts)",
  card_payment: "Card bill payment",
  refund: "Refund",
  fee: "Fee / charge",
  interest: "Interest",
  investment: "Investment",
};

export const KINDS_FOR: Record<"debit" | "credit", Kind[]> = {
  debit: ["expense", "investment", "fee", "transfer", "card_payment"],
  credit: ["income", "refund", "interest", "transfer", "card_payment"],
};

export const INCOME_SOURCE_LABEL = {
  salary: "Salary",
  freelance: "Freelance",
  hackathon: "Hackathon",
  bounty: "Bounty",
  misc: "Misc",
  other: "Other",
} as const;

export const ACCOUNT_KIND_LABEL = { bank: "Bank", credit_card: "Credit card", cash: "Cash", wallet: "Wallet" } as const;
export const ROLE_LABEL = { salary: "Salary", spending: "Daily spending", autopay: "Autopay", card: "Card", other: "Other" } as const;
export const INSTITUTION_LABEL = { HDFC: "HDFC Bank", IDFC: "IDFC FIRST Bank", INDIAN: "Indian Bank", CARD: "Card", CASH: "Cash", OTHER: "Other" } as const;

/** Paired kinds move money between own accounts: never spending or income. */
export const isPairedKind = (k: Kind) => k === "transfer" || k === "card_payment";

/** What a transaction row is called: the merchant, else its category, else its kind. */
export function txnTitle(t: Txn, categoryName?: string) {
  if (t.merchant) return t.merchant;
  if (categoryName && (t.kind === "expense" || t.kind === "income")) return categoryName;
  if (t.counterpartyVpa) return t.counterpartyVpa;
  if (t.kind === "income") return "Money received";
  if (t.kind === "expense") return "Payment";
  return KIND_LABEL[t.kind];
}
