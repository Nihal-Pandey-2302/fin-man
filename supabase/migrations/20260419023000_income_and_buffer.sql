alter table public.user_settings
  add column if not exists liquid_buffer numeric not null default 0;

create table if not exists public.income_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_name text not null,
  source_type text not null default 'salary' check (source_type in ('salary', 'freelance', 'other')),
  amount numeric not null check (amount > 0),
  date date not null,
  account_id uuid references public.accounts(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_income_entries_user_date on public.income_entries(user_id, date desc);

drop trigger if exists set_income_entries_updated_at on public.income_entries;
create trigger set_income_entries_updated_at
before update on public.income_entries
for each row execute function public.set_updated_at();

alter table public.income_entries enable row level security;

drop policy if exists "income_entries_own_rows" on public.income_entries;
create policy "income_entries_own_rows" on public.income_entries for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
