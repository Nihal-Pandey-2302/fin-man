create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Accounts (cash pockets)
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('bank', 'cash', 'wallet', 'crypto')),
  balance numeric not null default 0,
  currency text not null default 'INR',
  color text,
  icon text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Subscriptions / Recurring Payments
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  amount numeric not null check (amount >= 0),
  billing_cycle text not null check (billing_cycle in ('monthly', 'quarterly', 'yearly')),
  next_billing_date date not null,
  account_id uuid references public.accounts(id) on delete set null,
  category text,
  auto_insert boolean not null default true,
  is_active boolean not null default true,
  note text,
  color text,
  icon text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Expenses
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric not null check (amount >= 0),
  category text not null,
  currency text not null default 'INR',
  subcategory text,
  note text,
  date date not null,
  account_id uuid references public.accounts(id) on delete set null,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  is_autopay boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Investments
create table if not exists public.investments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('equity', 'debt', 'gold', 'crypto', 'fd', 'ppf', 'nps', 'real_estate', 'other')),
  platform text,
  amount_invested numeric not null check (amount_invested >= 0),
  units numeric,
  current_value numeric,
  date date not null,
  is_sip boolean not null default false,
  sip_amount numeric,
  sip_date int check (sip_date between 1 and 31),
  account_id uuid references public.accounts(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Loans (Money you owe or are owed)
create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  person_name text not null,
  amount numeric not null check (amount >= 0),
  type text not null check (type in ('you_owe', 'they_owe')),
  reason text,
  date date not null,
  due_date date,
  status text not null default 'open' check (status in ('open', 'partially_paid', 'settled')),
  amount_paid numeric not null default 0 check (amount_paid >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

-- Loan Payments (partial repayment tracking)
-- Using composite FK enforces payment.owner == loan.owner.
create table if not exists public.loan_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  loan_id uuid not null,
  amount numeric not null check (amount > 0),
  date date not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loan_payments_loan_fk
    foreign key (loan_id, user_id)
    references public.loans(id, user_id)
    on delete cascade
);

-- Budget limits
create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  monthly_limit numeric not null check (monthly_limit >= 0),
  month int not null check (month between 1 and 12),
  year int not null check (year >= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category, month, year)
);

-- Optional but powerful: unified transactions ledger.
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('income', 'expense', 'transfer', 'investment', 'loan', 'repayment')),
  amount numeric not null check (amount > 0),
  currency text not null default 'INR',
  category text not null,
  subcategory text,
  note text,
  date date not null,
  account_id uuid references public.accounts(id) on delete set null,
  expense_id uuid references public.expenses(id) on delete set null,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  investment_id uuid references public.investments(id) on delete set null,
  loan_id uuid references public.loans(id) on delete set null,
  loan_payment_id uuid references public.loan_payments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Composite indexes requested + useful user-scoped indexes.
create index if not exists idx_accounts_user_id on public.accounts(user_id);
create index if not exists idx_expenses_user_created_desc on public.expenses(user_id, created_at desc);
create index if not exists idx_subscriptions_user_next_billing on public.subscriptions(user_id, next_billing_date);
create index if not exists idx_investments_user_created_desc on public.investments(user_id, created_at desc);
create index if not exists idx_loans_user_created_desc on public.loans(user_id, created_at desc);
create index if not exists idx_loan_payments_user_created_desc on public.loan_payments(user_id, created_at desc);
create index if not exists idx_budgets_user_month_year on public.budgets(user_id, year desc, month desc);
create index if not exists idx_transactions_user_created_desc on public.transactions(user_id, created_at desc);

create or replace trigger set_accounts_updated_at
before update on public.accounts
for each row execute function public.set_updated_at();

create or replace trigger set_subscriptions_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

create or replace trigger set_expenses_updated_at
before update on public.expenses
for each row execute function public.set_updated_at();

create or replace trigger set_investments_updated_at
before update on public.investments
for each row execute function public.set_updated_at();

create or replace trigger set_loans_updated_at
before update on public.loans
for each row execute function public.set_updated_at();

create or replace trigger set_loan_payments_updated_at
before update on public.loan_payments
for each row execute function public.set_updated_at();

create or replace trigger set_budgets_updated_at
before update on public.budgets
for each row execute function public.set_updated_at();

create or replace trigger set_transactions_updated_at
before update on public.transactions
for each row execute function public.set_updated_at();

alter table public.accounts enable row level security;
alter table public.expenses enable row level security;
alter table public.subscriptions enable row level security;
alter table public.investments enable row level security;
alter table public.loans enable row level security;
alter table public.loan_payments enable row level security;
alter table public.budgets enable row level security;
alter table public.transactions enable row level security;

drop policy if exists "accounts_own_rows" on public.accounts;
create policy "accounts_own_rows" on public.accounts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "expenses_own_rows" on public.expenses;
create policy "expenses_own_rows" on public.expenses for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "subscriptions_own_rows" on public.subscriptions;
create policy "subscriptions_own_rows" on public.subscriptions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "investments_own_rows" on public.investments;
create policy "investments_own_rows" on public.investments for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "loans_own_rows" on public.loans;
create policy "loans_own_rows" on public.loans for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "loan_payments_own_rows" on public.loan_payments;
create policy "loan_payments_own_rows" on public.loan_payments for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "budgets_own_rows" on public.budgets;
create policy "budgets_own_rows" on public.budgets for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "transactions_own_rows" on public.transactions;
create policy "transactions_own_rows" on public.transactions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
