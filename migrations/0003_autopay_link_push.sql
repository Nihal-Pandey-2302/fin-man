CREATE TABLE `push_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`user_agent` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_uq` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `autopay_id` integer REFERENCES autopays(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `transactions_autopay_idx` ON `transactions` (`autopay_id`,`occurred_at`) WHERE "transactions"."autopay_id" is not null;