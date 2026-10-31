CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`institution` text NOT NULL,
	`kind` text NOT NULL,
	`role` text DEFAULT 'other' NOT NULL,
	`last4` text,
	`opening_balance_paise` integer DEFAULT 0 NOT NULL,
	`opening_balance_at` integer,
	`credit_limit_paise` integer,
	`statement_day` integer,
	`due_day` integer,
	`fd_lien_paise` integer,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT "institution_enum" CHECK(institution in ('HDFC', 'IDFC', 'INDIAN', 'CARD', 'CASH', 'OTHER')),
	CONSTRAINT "kind_enum" CHECK(kind in ('bank', 'credit_card', 'cash', 'wallet')),
	CONSTRAINT "role_enum" CHECK(role in ('salary', 'spending', 'autopay', 'card', 'other')),
	CONSTRAINT "last4_format" CHECK("accounts"."last4" is null or (length("accounts"."last4") = 4 and "accounts"."last4" not glob '*[^0-9]*')),
	CONSTRAINT "statement_day_range" CHECK("accounts"."statement_day" is null or "accounts"."statement_day" between 1 and 31),
	CONSTRAINT "due_day_range" CHECK("accounts"."due_day" is null or "accounts"."due_day" between 1 and 31)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_institution_last4_uq` ON `accounts` (`institution`,`last4`);--> statement-breakpoint
CREATE TABLE `autopays` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`account_id` integer NOT NULL,
	`category_id` integer,
	`amount_paise` integer NOT NULL,
	`frequency` text DEFAULT 'monthly' NOT NULL,
	`day_of_month` integer NOT NULL,
	`next_due_on` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`match_hint` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "kind_enum" CHECK(kind in ('sip', 'bill', 'emi', 'subscription', 'insurance')),
	CONSTRAINT "frequency_enum" CHECK(frequency in ('monthly', 'quarterly', 'yearly')),
	CONSTRAINT "amount_positive" CHECK("autopays"."amount_paise" > 0),
	CONSTRAINT "day_of_month_range" CHECK("autopays"."day_of_month" between 1 and 31)
);
--> statement-breakpoint
CREATE INDEX `autopays_active_due_idx` ON `autopays` (`active`,`next_due_on`);--> statement-breakpoint
CREATE TABLE `budget_cycles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`salary_txn_id` integer,
	`income_paise` integer DEFAULT 0 NOT NULL,
	`planned_spend_paise` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`salary_txn_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "end_after_start" CHECK("budget_cycles"."end_date" is null or "budget_cycles"."end_date" >= "budget_cycles"."start_date")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_cycles_start_uq` ON `budget_cycles` (`start_date`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`emoji` text,
	`color` text,
	`parent_id` integer,
	`is_essential` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_uq` ON `categories` (`name`);--> statement-breakpoint
CREATE TABLE `category_budgets` (
	`cycle_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`limit_paise` integer NOT NULL,
	PRIMARY KEY(`cycle_id`, `category_id`),
	FOREIGN KEY (`cycle_id`) REFERENCES `budget_cycles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "limit_non_negative" CHECK("category_budgets"."limit_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE `holdings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`platform` text,
	`invested_paise` integer DEFAULT 0 NOT NULL,
	`current_value_paise` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT "type_enum" CHECK(type in ('mutual_fund', 'stock', 'fd', 'ppf', 'other'))
);
--> statement-breakpoint
CREATE TABLE `loan_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`loan_id` integer NOT NULL,
	`amount_paise` integer NOT NULL,
	`paid_on` text NOT NULL,
	`transaction_id` integer,
	`note` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`loan_id`) REFERENCES `loans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "amount_positive" CHECK("loan_payments"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE INDEX `loan_payments_loan_idx` ON `loan_payments` (`loan_id`);--> statement-breakpoint
CREATE TABLE `loans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person` text NOT NULL,
	`direction` text NOT NULL,
	`principal_paise` integer NOT NULL,
	`reason` text,
	`opened_on` text NOT NULL,
	`due_on` text,
	`status` text DEFAULT 'open' NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT "direction_enum" CHECK(direction in ('you_owe', 'they_owe')),
	CONSTRAINT "status_enum" CHECK(status in ('open', 'partially_paid', 'settled')),
	CONSTRAINT "principal_positive" CHECK("loans"."principal_paise" > 0)
);
--> statement-breakpoint
CREATE INDEX `loans_status_idx` ON `loans` (`status`);--> statement-breakpoint
CREATE TABLE `merchant_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match` text NOT NULL,
	`match_type` text DEFAULT 'substring' NOT NULL,
	`category_id` integer,
	`kind_override` text,
	`hits` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "match_type_enum" CHECK(match_type in ('substring', 'regex')),
	CONSTRAINT "kind_override_enum" CHECK(kind_override is null or kind_override in ('expense', 'income', 'transfer', 'card_payment', 'refund', 'fee', 'interest', 'investment'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchant_rules_match_uq` ON `merchant_rules` (`match_type`,`match`);--> statement-breakpoint
CREATE TABLE `quick_add_presets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`category_id` integer,
	`account_id` integer,
	`amount_paise` integer,
	`note` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "amount_positive" CHECK("quick_add_presets"."amount_paise" is null or "quick_add_presets"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sms_raw` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sender` text NOT NULL,
	`sender_raw` text NOT NULL,
	`body` text NOT NULL,
	`received_at` integer NOT NULL,
	`hash` text NOT NULL,
	`parse_status` text NOT NULL,
	`parser` text,
	`error` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT "parse_status_enum" CHECK(parse_status in ('parsed', 'unparsed', 'ignored', 'error'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sms_raw_hash_uq` ON `sms_raw` (`hash`);--> statement-breakpoint
CREATE INDEX `sms_raw_status_received_idx` ON `sms_raw` (`parse_status`,`received_at`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`occurred_at` integer NOT NULL,
	`amount_paise` integer NOT NULL,
	`direction` text NOT NULL,
	`kind` text NOT NULL,
	`category_id` integer,
	`merchant` text,
	`counterparty_vpa` text,
	`ref_no` text,
	`balance_after_paise` integer,
	`source` text NOT NULL,
	`sms_id` integer,
	`transfer_group_id` text,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`income_source` text,
	`loan_id` integer,
	`note` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`sms_id`) REFERENCES `sms_raw`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`loan_id`) REFERENCES `loans`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "amount_positive" CHECK("transactions"."amount_paise" > 0),
	CONSTRAINT "direction_enum" CHECK(direction in ('debit', 'credit')),
	CONSTRAINT "kind_enum" CHECK(kind in ('expense', 'income', 'transfer', 'card_payment', 'refund', 'fee', 'interest', 'investment')),
	CONSTRAINT "source_enum" CHECK(source in ('sms', 'manual', 'import')),
	CONSTRAINT "status_enum" CHECK(status in ('needs_review', 'confirmed')),
	CONSTRAINT "income_source_enum" CHECK(income_source is null or income_source in ('salary', 'freelance', 'hackathon', 'bounty', 'misc', 'other')),
	CONSTRAINT "income_source_only_on_income" CHECK("transactions"."income_source" is null or "transactions"."kind" = 'income')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_sms_id_uq` ON `transactions` (`sms_id`);--> statement-breakpoint
CREATE INDEX `transactions_occurred_idx` ON `transactions` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `transactions_account_occurred_idx` ON `transactions` (`account_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `transactions_kind_occurred_idx` ON `transactions` (`kind`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `transactions_category_occurred_idx` ON `transactions` (`category_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `transactions_transfer_group_idx` ON `transactions` (`transfer_group_id`) WHERE "transactions"."transfer_group_id" is not null;--> statement-breakpoint
CREATE INDEX `transactions_amount_occurred_idx` ON `transactions` (`amount_paise`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `transactions_needs_review_idx` ON `transactions` (`occurred_at`) WHERE "transactions"."status" = 'needs_review';--> statement-breakpoint
CREATE INDEX `transactions_loan_idx` ON `transactions` (`loan_id`) WHERE "transactions"."loan_id" is not null;