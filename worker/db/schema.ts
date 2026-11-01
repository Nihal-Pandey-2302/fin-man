// Drizzle schema for D1 (PLAN.md §3). Keys are camelCase in TS and snake_case in SQL
// (`casing: "snake_case"` in drizzle.config.ts and the runtime client), so raw SQL in
// check() constraints uses snake_case names.
//
// Conventions:
// - Money: integer paise, columns end in `Paise`.
// - Instants: integer epoch ms (`timestamp_ms` mode → Date in TS), always UTC.
// - Calendar dates (cycle start, due dates): text `YYYY-MM-DD`, already in IST.
import { sql, type SQL } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

// ---- enums (shared with the API/UI) ----
export const INSTITUTIONS = ["HDFC", "IDFC", "INDIAN", "CARD", "CASH", "OTHER"] as const;
export const ACCOUNT_KINDS = ["bank", "credit_card", "cash", "wallet"] as const;
export const ACCOUNT_ROLES = ["salary", "spending", "autopay", "card", "other"] as const;
export const DIRECTIONS = ["debit", "credit"] as const;
export const TXN_KINDS = [
  "expense",
  "income",
  "transfer",
  "card_payment",
  "refund",
  "fee",
  "interest",
  "investment",
] as const;
export const CHANNELS = ["upi", "card", "imps", "neft", "rtgs", "atm", "nach", "cash", "other"] as const;
export const TXN_SOURCES = ["sms", "manual", "import"] as const;
export const TXN_STATUSES = ["needs_review", "confirmed"] as const;
export const INCOME_SOURCES = ["salary", "freelance", "hackathon", "bounty", "misc", "other"] as const;
export const PARSE_STATUSES = ["parsed", "unparsed", "ignored", "error"] as const;
export const RULE_MATCH_TYPES = ["substring", "regex"] as const;
export const AUTOPAY_KINDS = ["sip", "bill", "emi", "subscription", "insurance"] as const;
export const FREQUENCIES = ["monthly", "quarterly", "yearly"] as const;
export const HOLDING_TYPES = ["mutual_fund", "stock", "fd", "ppf", "other"] as const;
export const LOAN_DIRECTIONS = ["you_owe", "they_owe"] as const;
export const LOAN_STATUSES = ["open", "partially_paid", "settled"] as const;

// ---- helpers ----
const id = () => integer().primaryKey({ autoIncrement: true });
const createdAt = () =>
  integer({ mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`);
const updatedAt = () => createdAt().$onUpdate(() => new Date());
const bool = () => integer({ mode: "boolean" }).notNull();

/** DB-level enum guard; drizzle's `text({ enum })` only narrows the TS type. */
const oneOf = (column: string, values: readonly string[], nullable: boolean): SQL => {
  const list = sql.raw(values.map((v) => `'${v}'`).join(", "));
  const col = sql.raw(column);
  return nullable ? sql`${col} is null or ${col} in (${list})` : sql`${col} in (${list})`;
};
const enumCheck = (column: string, values: readonly string[], nullable = false) =>
  check(`${column}_enum`, oneOf(column, values, nullable));

// ---- tables ----
export const accounts = sqliteTable(
  "accounts",
  {
    id: id(),
    name: text().notNull(),
    institution: text({ enum: INSTITUTIONS }).notNull(),
    kind: text({ enum: ACCOUNT_KINDS }).notNull(),
    role: text({ enum: ACCOUNT_ROLES }).notNull().default("other"),
    // Balance = opening balance + every transaction after `openingBalanceAt`.
    // For a credit card this is the outstanding amount (positive = owed).
    openingBalancePaise: integer().notNull().default(0),
    openingBalanceAt: integer({ mode: "timestamp_ms" }),
    creditLimitPaise: integer(),
    statementDay: integer(),
    dueDay: integer(),
    fdLienPaise: integer(),
    archived: bool().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    enumCheck("institution", INSTITUTIONS),
    enumCheck("kind", ACCOUNT_KINDS),
    enumCheck("role", ACCOUNT_ROLES),
    check("statement_day_range", sql`${t.statementDay} is null or ${t.statementDay} between 1 and 31`),
    check("due_day_range", sql`${t.dueDay} is null or ${t.dueDay} between 1 and 31`),
  ],
);

/**
 * Card/account numbers (last 4 digits) that SMS can mention. One account may have several:
 * e.g. one credit card with a RuPay number (UPI) and a Mastercard number sharing a limit.
 * SMS parsers resolve the account by institution + account kind + last4.
 */
export const accountNumbers = sqliteTable(
  "account_numbers",
  {
    id: id(),
    accountId: integer()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    last4: text().notNull(),
    label: text(),
  },
  (t) => [
    check("last4_format", sql`length(${t.last4}) = 4 and ${t.last4} not glob '*[^0-9]*'`),
    uniqueIndex("account_numbers_account_last4_uq").on(t.accountId, t.last4),
    index("account_numbers_last4_idx").on(t.last4),
  ],
);

export const categories = sqliteTable(
  "categories",
  {
    id: id(),
    name: text().notNull(),
    emoji: text(),
    color: text(),
    parentId: integer().references((): AnySQLiteColumn => categories.id, { onDelete: "set null" }),
    isEssential: bool().default(false),
    sortOrder: integer().notNull().default(0),
    archived: bool().default(false),
  },
  (t) => [uniqueIndex("categories_name_uq").on(t.name)],
);

export const smsRaw = sqliteTable(
  "sms_raw",
  {
    id: id(),
    /** Normalized sender ID (operator prefix and TRAI suffix stripped), e.g. `HDFCBK`. */
    sender: text().notNull(),
    senderRaw: text().notNull(),
    /** Blanked for OTPs, which are stored only as `ignored` markers. */
    body: text().notNull(),
    receivedAt: integer({ mode: "timestamp_ms" }).notNull(),
    /** SHA-256 hex of normalized sender + body: the idempotency key. */
    hash: text().notNull(),
    parseStatus: text({ enum: PARSE_STATUSES }).notNull(),
    parser: text(),
    /** Parser output as JSON (also holds notices like upcoming-autopay alerts). */
    parsedJson: text(),
    error: text(),
    createdAt: createdAt(),
  },
  (t) => [
    enumCheck("parse_status", PARSE_STATUSES),
    uniqueIndex("sms_raw_hash_uq").on(t.hash),
    index("sms_raw_status_received_idx").on(t.parseStatus, t.receivedAt),
    index("sms_raw_received_idx").on(t.receivedAt),
  ],
);

export const loans = sqliteTable(
  "loans",
  {
    id: id(),
    person: text().notNull(),
    direction: text({ enum: LOAN_DIRECTIONS }).notNull(),
    principalPaise: integer().notNull(),
    reason: text(),
    openedOn: text().notNull(),
    dueOn: text(),
    status: text({ enum: LOAN_STATUSES }).notNull().default("open"),
    note: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    enumCheck("direction", LOAN_DIRECTIONS),
    enumCheck("status", LOAN_STATUSES),
    check("principal_positive", sql`${t.principalPaise} > 0`),
    index("loans_status_idx").on(t.status),
  ],
);

export const transactions = sqliteTable(
  "transactions",
  {
    id: id(),
    accountId: integer()
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    occurredAt: integer({ mode: "timestamp_ms" }).notNull(),
    amountPaise: integer().notNull(),
    direction: text({ enum: DIRECTIONS }).notNull(),
    kind: text({ enum: TXN_KINDS }).notNull(),
    categoryId: integer().references(() => categories.id, { onDelete: "set null" }),
    merchant: text(),
    counterpartyVpa: text(),
    refNo: text(),
    balanceAfterPaise: integer(),
    /** Credit cards: available limit reported by the SMS (outstanding = limit − available). */
    availableLimitPaise: integer(),
    channel: text({ enum: CHANNELS }),
    source: text({ enum: TXN_SOURCES }).notNull(),
    smsId: integer().references(() => smsRaw.id, { onDelete: "set null" }),
    /** Shared by both legs of a transfer or card payment. */
    transferGroupId: text(),
    status: text({ enum: TXN_STATUSES }).notNull().default("confirmed"),
    incomeSource: text({ enum: INCOME_SOURCES }),
    loanId: integer().references(() => loans.id, { onDelete: "set null" }),
    /** Set when this debit was matched to a scheduled autopay (marks that occurrence paid). */
    autopayId: integer().references((): AnySQLiteColumn => autopays.id, { onDelete: "set null" }),
    note: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("amount_positive", sql`${t.amountPaise} > 0`),
    enumCheck("direction", DIRECTIONS),
    enumCheck("kind", TXN_KINDS),
    enumCheck("source", TXN_SOURCES),
    enumCheck("status", TXN_STATUSES),
    enumCheck("income_source", INCOME_SOURCES, true),
    enumCheck("channel", CHANNELS, true),
    check("income_source_only_on_income", sql`${t.incomeSource} is null or ${t.kind} = 'income'`),
    // One SMS → at most one transaction (NULLs are allowed many times in SQLite).
    uniqueIndex("transactions_sms_id_uq").on(t.smsId),
    // Lists, dashboard ranges, per-account balance, per-category spend.
    index("transactions_occurred_idx").on(t.occurredAt),
    index("transactions_account_occurred_idx").on(t.accountId, t.occurredAt),
    index("transactions_kind_occurred_idx").on(t.kind, t.occurredAt),
    index("transactions_category_occurred_idx").on(t.categoryId, t.occurredAt),
    index("transactions_transfer_group_idx").on(t.transferGroupId).where(sql`${t.transferGroupId} is not null`),
    // Pairing matcher: same amount, ±2 days.
    index("transactions_amount_occurred_idx").on(t.amountPaise, t.occurredAt),
    // Review inbox badge/list.
    index("transactions_needs_review_idx").on(t.occurredAt).where(sql`${t.status} = 'needs_review'`),
    index("transactions_loan_idx").on(t.loanId).where(sql`${t.loanId} is not null`),
    index("transactions_autopay_idx").on(t.autopayId, t.occurredAt).where(sql`${t.autopayId} is not null`),
  ],
);

export const merchantRules = sqliteTable(
  "merchant_rules",
  {
    id: id(),
    /** Substring (case-insensitive) or regex source, matched against merchant and VPA. */
    match: text().notNull(),
    matchType: text({ enum: RULE_MATCH_TYPES }).notNull().default("substring"),
    categoryId: integer().references(() => categories.id, { onDelete: "cascade" }),
    kindOverride: text({ enum: TXN_KINDS }),
    hits: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    enumCheck("match_type", RULE_MATCH_TYPES),
    enumCheck("kind_override", TXN_KINDS, true),
    uniqueIndex("merchant_rules_match_uq").on(t.matchType, t.match),
  ],
);

export const autopays = sqliteTable(
  "autopays",
  {
    id: id(),
    name: text().notNull(),
    kind: text({ enum: AUTOPAY_KINDS }).notNull(),
    accountId: integer()
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    categoryId: integer().references(() => categories.id, { onDelete: "set null" }),
    amountPaise: integer().notNull(),
    frequency: text({ enum: FREQUENCIES }).notNull().default("monthly"),
    dayOfMonth: integer().notNull(),
    nextDueOn: text().notNull(),
    active: bool().default(true),
    /** Text expected in the debit SMS (e.g. mandate/biller name) to match payments. */
    matchHint: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    enumCheck("kind", AUTOPAY_KINDS),
    enumCheck("frequency", FREQUENCIES),
    check("amount_positive", sql`${t.amountPaise} > 0`),
    check("day_of_month_range", sql`${t.dayOfMonth} between 1 and 31`),
    index("autopays_active_due_idx").on(t.active, t.nextDueOn),
  ],
);

export const budgetCycles = sqliteTable(
  "budget_cycles",
  {
    id: id(),
    startDate: text().notNull(),
    /** Null while the cycle is open (until the next salary arrives). */
    endDate: text(),
    salaryTxnId: integer().references(() => transactions.id, { onDelete: "set null" }),
    incomePaise: integer().notNull().default(0),
    plannedSpendPaise: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("budget_cycles_start_uq").on(t.startDate),
    check("end_after_start", sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`),
  ],
);

export const categoryBudgets = sqliteTable(
  "category_budgets",
  {
    cycleId: integer()
      .notNull()
      .references(() => budgetCycles.id, { onDelete: "cascade" }),
    categoryId: integer()
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    limitPaise: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.cycleId, t.categoryId] }),
    check("limit_non_negative", sql`${t.limitPaise} >= 0`),
  ],
);

export const holdings = sqliteTable(
  "holdings",
  {
    id: id(),
    name: text().notNull(),
    type: text({ enum: HOLDING_TYPES }).notNull(),
    platform: text(),
    investedPaise: integer().notNull().default(0),
    currentValuePaise: integer(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [enumCheck("type", HOLDING_TYPES)],
);

export const loanPayments = sqliteTable(
  "loan_payments",
  {
    id: id(),
    loanId: integer()
      .notNull()
      .references(() => loans.id, { onDelete: "cascade" }),
    amountPaise: integer().notNull(),
    paidOn: text().notNull(),
    transactionId: integer().references(() => transactions.id, { onDelete: "set null" }),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [
    check("amount_positive", sql`${t.amountPaise} > 0`),
    index("loan_payments_loan_idx").on(t.loanId),
  ],
);

export const quickAddPresets = sqliteTable(
  "quick_add_presets",
  {
    id: id(),
    name: text().notNull(),
    categoryId: integer().references(() => categories.id, { onDelete: "cascade" }),
    accountId: integer().references(() => accounts.id, { onDelete: "set null" }),
    amountPaise: integer(),
    note: text(),
    sortOrder: integer().notNull().default(0),
    active: bool().default(true),
  },
  (t) => [check("amount_positive", sql`${t.amountPaise} is null or ${t.amountPaise} > 0`)],
);

/** Key/value app settings; values are JSON. Known keys: `liquid_buffer_paise`. */
export const settings = sqliteTable("settings", {
  key: text().primaryKey(),
  value: text().notNull(),
});

/**
 * A card statement's figures as the bank states them (entered by the owner, later read from the statement SMS).
 * Without a row, the statement amount is computed from the ledger when it can be (see ledger/cards.ts).
 */
export const cardStatements = sqliteTable(
  "card_statements",
  {
    id: id(),
    accountId: integer()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** The statement (bill generation) date, YYYY-MM-DD IST. */
    statementDate: text().notNull(),
    /** Total amount due on that statement (0 when nothing is due). */
    amountPaise: integer().notNull(),
    minDuePaise: integer(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("card_statements_account_date_uq").on(t.accountId, t.statementDate),
    check("card_statements_amount_nonneg", sql`${t.amountPaise} >= 0`),
  ],
);

/**
 * Savings goals / set-asides for irregular costs (a trip, insurance, a gadget). Money set aside stays in the
 * bank: `savedPaise` is earmarked, not moved, so it isn't counted as free to spend.
 */
export const goals = sqliteTable(
  "goals",
  {
    id: id(),
    name: text().notNull(),
    targetPaise: integer().notNull(),
    savedPaise: integer().notNull().default(0),
    /** Optional deadline (YYYY-MM-DD IST): the monthly set-aside is what's left ÷ months to go. */
    dueOn: text(),
    /** Optional fixed monthly set-aside, used instead of the deadline split. */
    monthlyPaise: integer(),
    archived: bool().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("goals_target_pos", sql`${t.targetPaise} > 0`), check("goals_saved_nonneg", sql`${t.savedPaise} >= 0`)],
);

/** Browser push subscriptions (one per installed device/browser). */
export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: id(),
    endpoint: text().notNull(),
    p256dh: text().notNull(),
    auth: text().notNull(),
    userAgent: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("push_subscriptions_endpoint_uq").on(t.endpoint)],
);
