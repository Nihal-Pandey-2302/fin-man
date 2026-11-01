CREATE TABLE `card_statements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`statement_date` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`min_due_paise` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "card_statements_amount_nonneg" CHECK("card_statements"."amount_paise" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_statements_account_date_uq` ON `card_statements` (`account_id`,`statement_date`);