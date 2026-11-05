// API contract shared by the Worker and the SPA. Rows are Drizzle's inferred types with Dates as ISO strings
// (what JSON.stringify produces).
import type {
  accountNumbers,
  accounts,
  autopays,
  budgetCycles,
  categories,
  goals,
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

export type Goal = Jsonify<typeof goals.$inferSelect> & {
  /** Set aside per month to reach the target in time (fixed monthly amount, or what's left ÷ months to go). */
  monthlyNeedPaise: number;
};

export type Savings = {
  cycle: {
    startDate: string;
    endDate: string;
    incomePaise: number;
    spentPaise: number;
    investedPaise: number;
    budgetPaise: number;
    /** Income − spending so far. */
    savedSoFarPaise: number;
    /** Income − the larger of budget and spending: what's saved if the budget holds. */
    projectedPaise: number;
    targetPaise: number;
  };
  /** Past cycles with money in or out (newest first, up to 6). */
  history: { startDate: string; endDate: string; incomePaise: number; spentPaise: number; investedPaise: number }[];
  emergency: {
    /** Bank + cash, plus FDs not held as card collateral, minus money set aside for goals. */
    liquidPaise: number;
    /** Average spending per cycle (past cycles; else this cycle's budget). */
    monthlySpendPaise: number | null;
    basis: "history" | "budget" | null;
    months: number | null;
  };
  goals: Goal[];
  /** Money set aside for goals (stays in the bank). */
  earmarkedPaise: number;
  goalsMonthlyPaise: number;
};

/** A payment that repeats on a schedule but isn't tracked as an autopay yet (see worker/ledger/recurring.ts). */
export type Recurring = {
  key: string;
  merchant: string;
  frequency: "monthly" | "quarterly" | "yearly";
  amountPaise: number;
  /** The amount spread per month (quarterly ÷ 3, yearly ÷ 12). */
  monthlyPaise: number;
  count: number;
  lastOn: string;
  nextOn: string;
  accountId: number;
  categoryId: number | null;
};

export type RecurringReport = {
  found: Recurring[];
  /** Tracked autopays (not SIPs) spread per month, plus what was found. */
  trackedMonthlyPaise: number;
  foundMonthlyPaise: number;
};

/** Everything about one merchant (all spellings that share a rule key). */
export type MerchantDetail = {
  key: string;
  /** The most recent spelling, for display. */
  name: string;
  count: number;
  /** Spending (expense + fee, minus refunds) and money received, all time. */
  spentPaise: number;
  receivedPaise: number;
  /** Average spending payment. */
  avgPaise: number;
  firstOn: string;
  lastOn: string;
  /** The last 12 months, oldest first ("YYYY-MM"). */
  monthly: { month: string; spentPaise: number }[];
  /** Most used category for this merchant. */
  categoryId: number | null;
  /** The rule that files new payments from it (the most specific match), if any. */
  rule: Rule | null;
  /** Newest first, up to 100. */
  transactions: Txn[];
};

export type Settings = {
  owner_names: string[];
  liquid_buffer_paise: number;
  autopay_buffer_paise: number;
  salary_employer: string;
  salary_min_paise: number;
  savings_target_paise: number;
  savings_account_id: number | null;
  notify_new_txns: boolean;
  dismissed_recurring: string[];
  weekly_digest: boolean;
  fixed_costs: { name: string; categoryId: number; amountPaise: number }[];
};

export type Bootstrap = {
  accounts: Account[];
  categories: Category[];
  presets: Preset[];
  settings: Settings;
  reviewCount: number;
};

export type Page<T> = { items: T[]; nextCursor: string | null };

/** A transaction whose SMS (no time of day) arrived just after a hand-set balance: was it already in it? */
export type LateSms = { transactionId: number; accountId: number; correctedPaise: number; correctedAt: string };
export type Review = { transactions: Txn[]; sms: Sms[]; lateSms: LateSms[] };

export type SalaryPlan = {
  cycleStart: string;
  cycleEnd: string;
  salaryTxnId: number | null;
  salaryPaise: number;
  salaryAccountId: number | null;
  items: {
    key: "card_bill" | "spending" | "autopays" | "savings";
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
  /** Savings target kept in the salary account (0 when savings move to their own account, a plan item then). */
  savingsTargetPaise: number;
  /** This month's set-aside for goals (stays in the salary account, earmarked). */
  goalsMonthlyPaise: number;
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
    /** Day-to-day spending today (fixed costs and autopay payments aside). */
    spentTodayPaise: number;
    /** Fixed costs (rent…) not yet paid this cycle. */
    fixedDuePaise: number;
    /** Autopays not yet paid this cycle (overdue included, SIPs aside). */
    autopaysDuePaise: number;
    /** Even split of what's left across the remaining days (computed from the start of today). */
    dailyAllowancePaise: number;
    leftTodayPaise: number;
    remainingPaise: number;
  };
  /** Fixed monthly costs and how much of each is paid this cycle. */
  fixed: { name: string; categoryId: number; amountPaise: number; paidPaise: number }[];
  liquidPaise: number;
  bufferPaise: number;
  byCategory: CategorySpend[];
  /** Day-to-day spending per day (fixed costs and autopay payments aside). */
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
