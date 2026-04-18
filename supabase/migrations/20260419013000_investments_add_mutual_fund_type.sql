alter table public.investments
  drop constraint if exists investments_type_check;

alter table public.investments
  add constraint investments_type_check
  check (
    type in (
      'equity',
      'mutual_fund',
      'debt',
      'gold',
      'crypto',
      'fd',
      'ppf',
      'nps',
      'real_estate',
      'other'
    )
  );
