-- Glasha v1 backend schema
-- Run this migration in Supabase after creating the project.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  default_currency text not null default 'RUB',
  timezone text not null default 'Europe/Berlin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  slug text not null,
  keywords text[] not null default '{}',
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  unique(user_id, slug)
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid references public.expense_categories(id) on delete set null,
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null default 'RUB',
  merchant text,
  note text,
  raw_text text,
  source text not null default 'manual' check (source in ('manual','voice','text','import')),
  occurred_at timestamptz not null default now(),
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  area text not null default 'personal' check (area in ('personal','work')),
  title text not null,
  description text,
  project text,
  due_at timestamptz,
  reminder_at timestamptz,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'todo' check (status in ('todo','doing','done','cancelled')),
  raw_text text,
  source text not null default 'manual' check (source in ('manual','voice','text','import')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'event' check (kind in ('event','birthday','deadline','reminder','appointment','trip','health','cycle')),
  title text not null,
  description text,
  start_at timestamptz not null,
  end_at timestamptz,
  all_day boolean not null default false,
  recurrence text,
  reminder_minutes integer[] not null default '{60}',
  linked_task_id uuid references public.tasks(id) on delete set null,
  raw_text text,
  source text not null default 'manual' check (source in ('manual','voice','text','import')),
  created_at timestamptz not null default now()
);

create table if not exists public.health_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('cycle_start','cycle_end','symptom','medication','appointment','measurement','note')),
  occurred_at timestamptz not null default now(),
  title text,
  details jsonb not null default '{}'::jsonb,
  raw_text text,
  source text not null default 'manual' check (source in ('manual','voice','text','import')),
  created_at timestamptz not null default now()
);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'goal' check (kind in ('dream','goal')),
  title text not null,
  description text,
  target_date date,
  status text not null default 'active' check (status in ('active','paused','done','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.goal_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  title text not null,
  due_at timestamptz,
  status text not null default 'todo' check (status in ('todo','done')),
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists public.inbox_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null,
  source text not null default 'text' check (source in ('voice','text','manual')),
  intent text,
  structured jsonb,
  processed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null check (entity_type in ('task','goal','calendar_event','health_event','expense','inbox')),
  entity_id uuid not null,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create table if not exists public.quick_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  url text not null,
  icon text,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

create index if not exists expenses_user_date_idx on public.expenses(user_id, occurred_at desc);
create index if not exists tasks_user_due_idx on public.tasks(user_id, due_at);
create index if not exists events_user_start_idx on public.calendar_events(user_id, start_at);
create index if not exists health_user_date_idx on public.health_events(user_id, occurred_at desc);
create index if not exists inbox_user_created_idx on public.inbox_entries(user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;
alter table public.tasks enable row level security;
alter table public.calendar_events enable row level security;
alter table public.health_events enable row level security;
alter table public.goals enable row level security;
alter table public.goal_steps enable row level security;
alter table public.inbox_entries enable row level security;
alter table public.attachments enable row level security;
alter table public.quick_links enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','expense_categories','expenses','tasks','calendar_events','health_events',
    'goals','goal_steps','inbox_entries','attachments','quick_links'
  ]
  loop
    execute format('drop policy if exists "owner_select" on public.%I', t);
    execute format('drop policy if exists "owner_insert" on public.%I', t);
    execute format('drop policy if exists "owner_update" on public.%I', t);
    execute format('drop policy if exists "owner_delete" on public.%I', t);
    execute format('create policy "owner_select" on public.%I for select to authenticated using (auth.uid() = %s)', t, case when t='profiles' then 'id' else 'user_id' end);
    execute format('create policy "owner_insert" on public.%I for insert to authenticated with check (auth.uid() = %s)', t, case when t='profiles' then 'id' else 'user_id' end);
    execute format('create policy "owner_update" on public.%I for update to authenticated using (auth.uid() = %s) with check (auth.uid() = %s)', t, case when t='profiles' then 'id' else 'user_id' end, case when t='profiles' then 'id' else 'user_id' end);
    execute format('create policy "owner_delete" on public.%I for delete to authenticated using (auth.uid() = %s)', t, case when t='profiles' then 'id' else 'user_id' end);
  end loop;
end $$;

create or replace function public.seed_glasha_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  insert into public.expense_categories(user_id, name, slug, keywords, sort_order) values
    (new.id, 'Квартира и дом', 'housing', array['аренда','квартира','коммуналка','жкх','дом'], 10),
    (new.id, 'Продукты', 'groceries', array['продукты','магазин','еда домой'], 20),
    (new.id, 'Кофе и кафе', 'coffee_cafes', array['кофе','кафе','ресторан','обед','ужин'], 30),
    (new.id, 'На себя', 'self_care', array['одежда','косметика','маникюр','волосы','массаж','себя'], 40),
    (new.id, 'Развлечения', 'entertainment', array['кино','театр','развлечения','вечеринка','игра'], 50),
    (new.id, 'Обучение', 'education', array['курс','обучение','урок','репетитор','книга'], 60),
    (new.id, 'Сын', 'child', array['сын','ребенок','школа'], 70),
    (new.id, 'Транспорт', 'transport', array['такси','метро','бензин','транспорт'], 80),
    (new.id, 'Здоровье', 'health', array['аптека','врач','анализы','лекарства'], 90),
    (new.id, 'Подписки', 'subscriptions', array['подписка','сервис'], 100),
    (new.id, 'Путешествия', 'travel', array['билет','отель','поездка'], 110),
    (new.id, 'Работа', 'work', array['работа','клиент','офис'], 120),
    (new.id, 'Другое', 'other', array[]::text[], 999)
  on conflict (user_id, slug) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_glasha on auth.users;
create trigger on_auth_user_created_glasha
after insert on auth.users
for each row execute procedure public.seed_glasha_user();

insert into storage.buckets (id, name, public, file_size_limit)
values ('glasha-private', 'glasha-private', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "glasha_storage_select" on storage.objects;
drop policy if exists "glasha_storage_insert" on storage.objects;
drop policy if exists "glasha_storage_update" on storage.objects;
drop policy if exists "glasha_storage_delete" on storage.objects;

create policy "glasha_storage_select"
on storage.objects for select to authenticated
using (bucket_id = 'glasha-private' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "glasha_storage_insert"
on storage.objects for insert to authenticated
with check (bucket_id = 'glasha-private' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "glasha_storage_update"
on storage.objects for update to authenticated
using (bucket_id = 'glasha-private' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'glasha-private' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "glasha_storage_delete"
on storage.objects for delete to authenticated
using (bucket_id = 'glasha-private' and (storage.foldername(name))[1] = auth.uid()::text);
