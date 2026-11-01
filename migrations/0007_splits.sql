ALTER TABLE `loans` ADD `split_txn_id` integer REFERENCES transactions(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `transactions` ADD `share_paise` integer;