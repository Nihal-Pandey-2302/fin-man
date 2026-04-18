create table if not exists public.user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  default_account_id uuid references public.accounts(id) on delete set null,
  currency text not null default 'INR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quick_add_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null,
  subcategory text,
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_settings_user_id on public.user_settings(user_id);
create index if not exists idx_quick_add_presets_user_id on public.quick_add_presets(user_id);

drop trigger if exists set_user_settings_updated_at on public.user_settings;
create trigger set_user_settings_updated_at
before update on public.user_settings
for each row execute function public.set_updated_at();

drop trigger if exists set_quick_add_presets_updated_at on public.quick_add_presets;
create trigger set_quick_add_presets_updated_at
before update on public.quick_add_presets
for each row execute function public.set_updated_at();

alter table public.user_settings enable row level security;
alter table public.quick_add_presets enable row level security;

drop policy if exists "user_settings_own_rows" on public.user_settings;
create policy "user_settings_own_rows" on public.user_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "quick_add_presets_own_rows" on public.quick_add_presets;
create policy "quick_add_presets_own_rows" on public.quick_add_presets for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
