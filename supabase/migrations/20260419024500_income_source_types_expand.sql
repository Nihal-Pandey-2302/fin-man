alter table public.income_entries
  drop constraint if exists income_entries_source_type_check;

alter table public.income_entries
  add constraint income_entries_source_type_check
  check (source_type in ('salary', 'freelance', 'hackathon', 'bounty', 'misc', 'other'));
