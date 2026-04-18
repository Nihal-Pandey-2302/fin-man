alter table public.budgets
  add column if not exists period text;

alter table public.budgets
  add column if not exists period_start date;

update public.budgets
set period = 'monthly'
where period is null;

update public.budgets
set period_start = make_date(year, month, 1)
where period_start is null;

alter table public.budgets
  alter column period set not null;

alter table public.budgets
  alter column period_start set not null;

alter table public.budgets
  drop constraint if exists budgets_period_check;

alter table public.budgets
  add constraint budgets_period_check check (period in ('daily', 'weekly', 'monthly'));

alter table public.budgets
  drop constraint if exists budgets_user_id_category_month_year_key;

create unique index if not exists idx_budgets_user_category_period_start
  on public.budgets(user_id, category, period, period_start);
