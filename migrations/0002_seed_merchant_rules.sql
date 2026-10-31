-- Starter merchant rules (case-insensitive substring on merchant / VPA). Editable in the app;
-- re-categorizing a transaction creates or updates rules like these.
-- One statement per rule: D1 caps compound SELECT terms.
INSERT INTO `merchant_rules` (`match`, `match_type`, `category_id`, `kind_override`) SELECT 'swiggy', 'substring', `id`, NULL FROM `categories` WHERE `name` = 'Food & dining';--> statement-breakpoint
INSERT INTO `merchant_rules` (`match`, `match_type`, `category_id`, `kind_override`) SELECT 'zomato', 'substring', `id`, NULL FROM `categories` WHERE `name` = 'Food & dining';--> statement-breakpoint
INSERT INTO `merchant_rules` (`match`, `match_type`, `category_id`, `kind_override`) SELECT 'blinkit', 'substring', `id`, NULL FROM `categories` WHERE `name` = 'Groceries';--> statement-breakpoint
INSERT INTO `merchant_rules` (`match`, `match_type`, `category_id`, `kind_override`) SELECT 'zepto', 'substring', `id`, NULL FROM `categories` WHERE `name` = 'Groceries';--> statement-breakpoint
INSERT INTO `merchant_rules` (`match`, `match_type`, `category_id`, `kind_override`) SELECT 'bigbasket', 'substring', `id`, NULL FROM `categories` WHERE `name` = 'Groceries';--> statement-breakpoint
INSERT INTO `merchant_rules` (`match`, `match_type`, `category_id`, `kind_override`) SELECT 'instamart', 'substring', `id`, NULL FROM `categories` WHERE `name` = 'Groceries';--> statement-breakpoint
INSERT INTO `merchant_rules` (`match`, `match_type`, `category_id`, `kind_override`) SELECT 'uber', 'substring', `id`, NULL FROM `categories` WHERE `name` = 'Transport';--> statement-breakpoint
INSERT INTO `merchant_rules` (`match`, `match_type`, `category_id`, `kind_override`) SELECT 'olacabs', 'substring', `id`, NULL FROM `categories` WHERE `name` = 'Transport';--> statement-breakpoint
INSERT INTO `merchant_rules` (`match`, `match_type`, `category_id`, `kind_override`) SELECT 'rapido', 'substring', `id`, NULL FROM `categories` WHERE `name` = 'Transport';--> statement-breakpoint
INSERT INTO `merchant_rules` (`match`, `match_type`, `category_id`, `kind_override`) SELECT 'irctc', 'substring', `id`, NULL FROM `categories` WHERE `name` = 'Travel';--> statement-breakpoint
INSERT INTO `merchant_rules` (`match`, `match_type`, `category_id`, `kind_override`) SELECT 'amazon', 'substring', `id`, NULL FROM `categories` WHERE `name` = 'Shopping';--> statement-breakpoint
INSERT INTO `merchant_rules` (`match`, `match_type`, `category_id`, `kind_override`) SELECT 'flipkart', 'substring', `id`, NULL FROM `categories` WHERE `name` = 'Shopping';--> statement-breakpoint
INSERT INTO `merchant_rules` (`match`, `match_type`, `category_id`, `kind_override`) SELECT 'myntra', 'substring', `id`, NULL FROM `categories` WHERE `name` = 'Shopping';--> statement-breakpoint
INSERT INTO `merchant_rules` (`match`, `match_type`, `category_id`, `kind_override`) SELECT 'netflix', 'substring', `id`, NULL FROM `categories` WHERE `name` = 'Subscriptions';--> statement-breakpoint
INSERT INTO `merchant_rules` (`match`, `match_type`, `category_id`, `kind_override`) SELECT 'spotify', 'substring', `id`, NULL FROM `categories` WHERE `name` = 'Subscriptions';--> statement-breakpoint
INSERT INTO `merchant_rules` (`match`, `match_type`, `category_id`, `kind_override`) SELECT 'hdfc securities', 'substring', `id`, 'investment' FROM `categories` WHERE `name` = 'Investments';--> statement-breakpoint
INSERT INTO `merchant_rules` (`match`, `match_type`, `category_id`, `kind_override`) SELECT 'groww', 'substring', `id`, 'investment' FROM `categories` WHERE `name` = 'Investments';--> statement-breakpoint
INSERT INTO `merchant_rules` (`match`, `match_type`, `category_id`, `kind_override`) SELECT 'zerodha', 'substring', `id`, 'investment' FROM `categories` WHERE `name` = 'Investments';
