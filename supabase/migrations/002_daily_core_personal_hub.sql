-- Glasha Daily Core + Personal Hub
-- Additive migration. Do not rewrite 001_glasha_core.sql.

alter table public.tasks
  add column if not exists goal_id uuid references public.goals(id) on delete set null;

create index if not exists tasks_user_goal_idx on public.tasks(user_id, goal_id);

alter table public.calendar_events
  add column if not exists area text not null default 'personal';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'calendar_events_area_check'
      and conrelid = 'public.calendar_events'::regclass
  ) then
    alter table public.calendar_events
      add constraint calendar_events_area_check
      check (area in ('personal','work','health','goals','travel'));
  end if;
end $$;

alter table public.health_events drop constraint if exists health_events_kind_check;
alter table public.health_events
  add constraint health_events_kind_check
  check (kind in (
    'cycle_start','cycle_end','symptom','medication','appointment',
    'measurement','note','fitness','achievement'
  ));

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  owner_person text not null default 'user'
    check (owner_person in ('user','child','mother','work','other')),
  document_type text not null default 'other',
  title text not null,
  expiry_date date,
  tags text[] not null default '{}',
  storage_path text not null unique,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  relation text,
  phone text,
  email text,
  telegram_username text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  service text not null,
  display_name text not null,
  open_url text,
  deep_link text,
  capability text not null default 'OPEN_ONLY'
    check (capability in ('OPEN_ONLY','READ','ACTION','NOT_CONNECTED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, service)
);

create index if not exists calendar_user_area_start_idx
  on public.calendar_events(user_id, area, start_at);
create index if not exists documents_user_title_idx
  on public.documents(user_id, title);
create index if not exists documents_user_type_idx
  on public.documents(user_id, document_type);
create index if not exists contacts_user_name_idx
  on public.contacts(user_id, name);
create index if not exists connections_user_service_idx
  on public.connections(user_id, service);

alter table public.documents enable row level security;
alter table public.contacts enable row level security;
alter table public.connections enable row level security;

do $$
declare t text;
begin
  foreach t in array array['documents','contacts','connections']
  loop
    execute format('drop policy if exists "owner_select" on public.%I', t);
    execute format('drop policy if exists "owner_insert" on public.%I', t);
    execute format('drop policy if exists "owner_update" on public.%I', t);
    execute format('drop policy if exists "owner_delete" on public.%I', t);
    execute format('create policy "owner_select" on public.%I for select to authenticated using (auth.uid() = user_id)', t);
    execute format('create policy "owner_insert" on public.%I for insert to authenticated with check (auth.uid() = user_id)', t);
    execute format('create policy "owner_update" on public.%I for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
    execute format('create policy "owner_delete" on public.%I for delete to authenticated using (auth.uid() = user_id)', t);
  end loop;
end $$;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.documents, public.contacts, public.connections to authenticated;

-- Explicit least-privilege access for user-owned app tables.
revoke all on public.documents, public.contacts, public.connections from anon;

create or replace function public.seed_glasha_connections(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.connections(user_id, service, display_name, open_url, deep_link, capability) values
    (target_user_id, 'telegram', 'Telegram', 'https://web.telegram.org/', 'tg://', 'OPEN_ONLY'),
    (target_user_id, 'tutu', 'Tutu', 'https://www.tutu.ru/', null, 'OPEN_ONLY'),
    (target_user_id, 'mail', 'Почта', 'https://mail.google.com/', 'mailto:', 'OPEN_ONLY'),
    (target_user_id, 'maps', 'Яндекс Карты', 'https://yandex.ru/maps/', 'yandexmaps://', 'OPEN_ONLY'),
    (target_user_id, 'translate', 'Переводчик', 'https://translate.yandex.ru/', null, 'OPEN_ONLY'),
    (target_user_id, 'bank', 'Банк', null, null, 'NOT_CONNECTED'),
    (target_user_id, 'gosuslugi', 'Госуслуги', 'https://www.gosuslugi.ru/', null, 'OPEN_ONLY'),
    (target_user_id, 'calendar', 'Календарь Глаши', null, null, 'READ')
  on conflict (user_id, service) do nothing;
end;
$$;

select public.seed_glasha_connections(id) from auth.users;

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

  perform public.seed_glasha_connections(new.id);
  return new;
end;
$$;
