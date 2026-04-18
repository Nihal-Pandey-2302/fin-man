alter table public.accounts
  drop constraint if exists accounts_type_check;

alter table public.accounts
  add constraint accounts_type_check
  check (type in ('bank', 'cash', 'wallet', 'crypto', 'ppf'));
