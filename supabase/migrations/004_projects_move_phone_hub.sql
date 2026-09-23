-- Daily Core extension: project tasks, task moves, and phone app hub.

alter table public.tasks
  add column if not exists parent_task_id uuid references public.tasks(id) on delete cascade,
  add column if not exists is_project boolean not null default false,
  add column if not exists sort_order integer not null default 100;

create index if not exists tasks_user_parent_idx
  on public.tasks(user_id, parent_task_id, sort_order, created_at);

create or replace function public.validate_glasha_task_parent()
returns trigger
language plpgsql
as $$
declare
  parent_owner uuid;
  creates_cycle boolean;
begin
  if new.parent_task_id is null then
    return new;
  end if;

  if new.parent_task_id = new.id then
    raise exception 'task_cannot_parent_itself';
  end if;

  select t.user_id into parent_owner
  from public.tasks t
  where t.id = new.parent_task_id;

  if parent_owner is null or parent_owner <> new.user_id then
    raise exception 'task_parent_must_belong_to_same_user';
  end if;

  with recursive ancestors as (
    select t.id, t.parent_task_id
    from public.tasks t
    where t.id = new.parent_task_id
    union all
    select t.id, t.parent_task_id
    from public.tasks t
    join ancestors a on t.id = a.parent_task_id
  )
  select exists(select 1 from ancestors where id = new.id)
  into creates_cycle;

  if creates_cycle then
    raise exception 'task_parent_cycle_not_allowed';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_glasha_task_parent on public.tasks;
create trigger validate_glasha_task_parent
before insert or update of parent_task_id, user_id on public.tasks
for each row execute function public.validate_glasha_task_parent();

alter table public.connections
  add column if not exists platform text not null default 'cross_platform',
  add column if not exists url_scheme text,
  add column if not exists universal_link text,
  add column if not exists web_fallback_url text,
  add column if not exists enabled boolean not null default true,
  add column if not exists icon text,
  add column if not exists aliases text[] not null default '{}';

update public.connections
set web_fallback_url = coalesce(web_fallback_url, open_url)
where web_fallback_url is null and open_url is not null;

create index if not exists connections_user_enabled_idx
  on public.connections(user_id, enabled, display_name);

create or replace function public.seed_glasha_connections(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.connections(
    user_id, service, display_name, platform, open_url, deep_link, url_scheme,
    universal_link, web_fallback_url, capability, enabled, icon, aliases
  ) values
    (target_user_id, 'telegram', 'Telegram', 'cross_platform', 'https://web.telegram.org/', 'tg://', 'tg://', 'https://t.me/', 'https://web.telegram.org/', 'OPEN_ONLY', true, '💬', array['телеграм']),
    (target_user_id, 'tutu', 'Tutu', 'cross_platform', 'https://www.tutu.ru/', null, null, 'https://www.tutu.ru/', 'https://www.tutu.ru/', 'OPEN_ONLY', true, '✈️', array['туту']),
    (target_user_id, 'mail', 'Почта', 'cross_platform', 'https://mail.google.com/', 'mailto:', 'mailto:', null, 'https://mail.google.com/', 'OPEN_ONLY', true, '✉️', array['email','e-mail']),
    (target_user_id, 'maps', 'Яндекс Карты', 'cross_platform', 'https://yandex.ru/maps/', 'yandexmaps://', 'yandexmaps://', 'https://yandex.ru/maps/', 'https://yandex.ru/maps/', 'OPEN_ONLY', true, '🗺️', array['карты','яндекс карты']),
    (target_user_id, 'translate', 'Переводчик', 'cross_platform', 'https://translate.yandex.ru/', null, null, 'https://translate.yandex.ru/', 'https://translate.yandex.ru/', 'OPEN_ONLY', true, '文', array['переводчик']),
    (target_user_id, 'bank', 'Банк', 'cross_platform', null, null, null, null, null, 'NOT_CONNECTED', true, '🏦', array['мой банк']),
    (target_user_id, 'gosuslugi', 'Госуслуги', 'cross_platform', 'https://www.gosuslugi.ru/', null, null, 'https://www.gosuslugi.ru/', 'https://www.gosuslugi.ru/', 'OPEN_ONLY', true, '▣', array['госуслуги']),
    (target_user_id, 'calendar', 'Календарь Глаши', 'web', null, null, null, null, null, 'READ', true, '◫', array['календарь'])
  on conflict (user_id, service) do update set
    platform = coalesce(public.connections.platform, excluded.platform),
    web_fallback_url = coalesce(public.connections.web_fallback_url, excluded.web_fallback_url),
    url_scheme = coalesce(public.connections.url_scheme, excluded.url_scheme),
    universal_link = coalesce(public.connections.universal_link, excluded.universal_link),
    icon = coalesce(public.connections.icon, excluded.icon),
    aliases = case
      when cardinality(public.connections.aliases) = 0 then excluded.aliases
      else public.connections.aliases
    end;
end;
$$;

select public.seed_glasha_connections(id) from auth.users;
