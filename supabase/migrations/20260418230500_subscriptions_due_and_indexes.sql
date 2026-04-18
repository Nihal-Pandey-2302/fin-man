alter table if exists public.subscriptions
  add column if not exists next_due_date date;

update public.subscriptions
set next_due_date = coalesce(next_due_date, next_billing_date)
where next_due_date is null;

create index if not exists idx_expenses_user_id on public.expenses(user_id);
create index if not exists idx_expenses_user_date on public.expenses(user_id, date desc);
create index if not exists idx_expenses_user_category on public.expenses(user_id, category);
create index if not exists idx_expenses_user_account on public.expenses(user_id, account_id);
create index if not exists idx_subscriptions_user_next_due_date on public.subscriptions(user_id, next_due_date);
