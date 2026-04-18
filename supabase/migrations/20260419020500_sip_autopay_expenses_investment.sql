-- Link autopay expenses to investments (SIP); track last month SIP was posted (idempotency)
alter table public.expenses
  add column if not exists investment_id uuid references public.investments(id) on delete set null;

create index if not exists idx_expenses_investment_id on public.expenses(investment_id)
  where investment_id is not null;

alter table public.investments
  add column if not exists sip_last_posted_month text;

comment on column public.investments.sip_last_posted_month is 'YYYY-MM of the calendar month when SIP was last auto-posted';
