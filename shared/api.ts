// API contract shared by the Worker and the SPA. Rows are Drizzle's inferred types with Dates as ISO strings
// (what JSON.stringify produces).
import type {
  accountNumbers,
  accounts,
  autopays,
  budgetCycles,
  categories,
  holdings,
  loanPayments,
  loans,
  merchantRules,
  quickAddPresets,
  smsRaw,
  transactions,
} from "../worker/db/schema";

export type Jsonify<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K] };

export type Txn = Jsonify<typeof transactions.$inferSelect>;
export type Category = typeof categories.$inferSelect;
export type Rule = Jsonify<typeof merchantRules.$inferSelect>;
export type Autopay = Jsonify<typeof autopays.$inferSelect>;
export type Preset = typeof quickAddPresets.$inferSelect;
export type Cycle = Jsonify<typeof budgetCycles.$inferSelect>;
export type Holding = Jsonify<typeof holdings.$inferSelect>;
export type LoanPayment = Jsonify<typeof loanPayments.$inferSelect>;
export type Loan = Jsonify<typeof loans.$inferSelect> & { paidPaise: number; payments: LoanPayment[] };
export type Sms = Jsonify<typeof smsRaw.$inferSelect>;
export type AccountNumber = typeof accountNumbers.$inferSelect;

export type Kind = Txn["kind"];
export type Direction = Txn["direction"];

export type AccountBalance = {
  /** Bank/cash/wallet: money in the account. Card: outstanding (positive = you owe). */
  balancePaise: number;
  /** "sms" when anchored on the latest SMS-reported balance, "manual" when on the opening/corrected balance. */
  basis: "sms" | "manual";
  asOf: string | null;
  /** Cards only. */
  availableLimitPaise: number | null;
  nextDueOn: string | null;
  nextStatementOn: string | null;
};
export type Account = Jsonify<typeof accounts.$inferSelect> & { numbers: AccountNumber[]; balance: AccountBalance };

/** Where a credit card stands against its last statement (see worker/ledger/cards.ts). */
export type CardStatus = {
  accountId: number;
  /** The last statement date on or before today; null until the statement day is set. */
  statementDate: string | null;
  dueDate: string | null;
  /** What that statement asks for; null when it can't be known (enter it, or wait for the next statement). */
  statementPaise: number | null;
  /** "bank": entered by the owner (or read from the statement SMS); "computed": worked out from the ledger. */
  statementSource: "bank" | "computed" | null;
  minDuePaise: number | null;
  /** Card payments received since the statement. */
  paidPaise: number;
  leftToPayPaise: number | null;
  status: "paid" | "due" | "overdue" | "nothing_due" | "unknown";
  daysToDue: number | null;
  /** Spent on the card since the statement: it goes on the next bill. */
  spentSincePaise: number;
  outstandingPaise: number;
  limitPaise: number | null;
  /** Outstanding ÷ limit, 0–1+ (null without a limit). */
  utilization: number | null;
};

export type Settings = {
  owner_names: string[];
  liquid_buffer_paise: number;
  autopay_buffer_paise: number;
  salary_employer: string;
  salary_min_paise: number;
};

export type Bootstrap = {
  accounts: Account[];
  categories: Category[];
  presets: Preset[];
  settings: Settings;
  reviewCount: number;
};

export type Page<T> = { items: T[]; nextCursor: string | null };

export type Review = { transactions: Txn[]; sms: Sms[] };

export type SalaryPlan = {
  cycleStart: string;
  cycleEnd: string;
  salaryTxnId: number | null;
  salaryPaise: number;
  salaryAccountId: number | null;
  items: {
    key: "card_bill" | "spending" | "autopays";
    label: string;
    fromAccountId: number;
    toAccountId: number;
    /** Still to move now. */
    needPaise: number;
    /** Already moved from the salary account this cycle. */
    sentPaise: number;
    done: boolean;
  }[];
  /** What stays in the salary account after the remaining moves. */
  keepPaise: number;
};

export type Occurrence = {
  autopayId: number;
  name: string;
  kind: Autopay["kind"];
  accountId: number;
  amountPaise: number;
  dueOn: string;
  status: "paid" | "due" | "overdue";
  transactionId: number | null;
};

export type Alert = {
  key: string;
  level: "info" | "warn" | "danger";
  title: string;
  body: string;
  href?: string;
  /** Shown on Home but not pushed by the daily reminder (it would repeat every day). */
  quiet?: boolean;
};

export type Report = {
  startDate: string;
  endDate: string;
  daysElapsed: number;
  spendPaise: number;
  incomePaise: number;
  investedPaise: number;
  previous: { startDate: string; endDate: string; spendPaise: number } | null;
  byCategory: { categoryId: number | null; spendPaise: number; previousPaise: number }[];
  topMerchants: { merchant: string; spendPaise: number; count: number }[];
  biggest: Txn[];
  periods: { startDate: string; endDate: string }[];
};

export type CategorySpend = { categoryId: number | null; spentPaise: number; limitPaise: number | null };

export type Dashboard = {
  today: string;
  cycle: {
    id: number | null;
    startDate: string;
    endDate: string;
    daysLeft: number;
    budgetPaise: number;
    spentPaise: number;
    spentTodayPaise: number;
    autopaysDuePaise: number;
    /** Even split of what's left across the remaining days (computed from the start of today). */
    dailyAllowancePaise: number;
    leftTodayPaise: number;
    remainingPaise: number;
  };
  liquidPaise: number;
  bufferPaise: number;
  byCategory: CategorySpend[];
  daily: { date: string; spentPaise: number }[];
  upcomingAutopays: (Autopay & { dueOn: string })[];
  recent: Txn[];
  reviewCount: number;
  /** Newest SMS received from the phone (ISO), null before the first one. */
  lastSmsAt: string | null;
  cards: CardStatus[];
  salary: {
    /** Payday is near and no salary has been recorded for it yet. */
    awaiting: boolean;
    /** The most recent salary, to prefill the next one. */
    lastPaise: number | null;
    lastAccountId: number | null;
  };
  alerts: Alert[];
};
