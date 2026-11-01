CREATE TABLE `goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`target_paise` integer NOT NULL,
	`saved_paise` integer DEFAULT 0 NOT NULL,
	`due_on` text,
	`monthly_paise` integer,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT "goals_target_pos" CHECK("goals"."target_paise" > 0),
	CONSTRAINT "goals_saved_nonneg" CHECK("goals"."saved_paise" >= 0)
);
