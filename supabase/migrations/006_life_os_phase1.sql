-- LIFE OS Phase 1 foundation
-- Additive preview-first migration. Do not apply to production before Controller E2E approval.

alter table public.tasks
  add column if not exists completed_at timestamptz;

create index if not exists tasks_user_completed_idx on public.tasks(user_id, completed_at desc)
  where completed_at is not null;

create or replace function public.glasha_task_completed_at()
returns trigger
language plpgsql
set search_path = public
as $
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status is distinct from 'done' then
    new.completed_at := null;
  end if;
  return new;
end;
$;

drop trigger if exists glasha_task_completed_at on public.tasks;
create trigger glasha_task_completed_at
before insert or update of status on public.tasks
for each row execute function public.glasha_task_completed_at();

alter table public.profiles
  add column if not exists quiet_hours_enabled boolean not null default false,
  add column if not exists quiet_hours_start time not null default '22:00',
  add column if not exists quiet_hours_end time not null default '08:00';

create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'note' check (kind in ('note','decision','context','journal')),
  title text not null,
  body text,
  happened_at timestamptz,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.entity_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (source_type in ('task','project','goal','event','health_event','expense','document','contact','trip','purchase','journal','memory')),
  source_id uuid not null,
  target_type text not null check (target_type in ('task','project','goal','event','health_event','expense','document','contact','trip','purchase','journal','memory')),
  target_id uuid not null,
  relation_type text not null,
  note text,
  created_at timestamptz not null default now(),
  unique(user_id, source_type, source_id, target_type, target_id, relation_type),
  check (not (source_type = target_type and source_id = target_id))
);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  details text,
  priority text not null default 'normal' check (priority in ('normal','urgent')),
  category text not null default 'general' check (category in ('general','payment','health')),
  recurrence text not null default 'none' check (recurrence in ('none','daily','weekly','monthly')),
  recurrence_interval integer not null default 1 check (recurrence_interval between 1 and 365),
  due_at timestamptz not null,
  next_occurrence_at timestamptz not null,
  active boolean not null default true,
  linked_entity_type text check (linked_entity_type is null or linked_entity_type in ('task','project','goal','event','health_event','expense','document','contact','trip','purchase','journal','memory')),
  linked_entity_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((linked_entity_type is null) = (linked_entity_id is null))
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reminder_id uuid not null references public.reminders(id) on delete cascade,
  title text not null,
  scheduled_for timestamptz not null,
  deliver_at timestamptz not null,
  priority text not null default 'normal' check (priority in ('normal','urgent')),
  state text not null default 'unread' check (state in ('unread','seen','snoozed','done')),
  resolution text check (resolution is null or resolution in ('done','skipped')),
  snoozed_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, reminder_id, scheduled_for)
);

create index if not exists memories_user_search_idx on public.memories(user_id, updated_at desc);
create index if not exists entity_links_user_source_idx on public.entity_links(user_id, source_type, source_id);
create index if not exists entity_links_user_target_idx on public.entity_links(user_id, target_type, target_id);
create index if not exists reminders_user_next_idx on public.reminders(user_id, active, next_occurrence_at);
create index if not exists notifications_user_state_deliver_idx on public.notifications(user_id, state, deliver_at);

create or replace function public.glasha_entity_owned(p_user_id uuid, p_type text, p_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare ok boolean := false;
begin
  case p_type
    when 'task' then select exists(select 1 from public.tasks where id=p_id and user_id=p_user_id and not is_project) into ok;
    when 'project' then select exists(select 1 from public.tasks where id=p_id and user_id=p_user_id and is_project) into ok;
    when 'goal' then select exists(select 1 from public.goals where id=p_id and user_id=p_user_id) into ok;
    when 'event' then select exists(select 1 from public.calendar_events where id=p_id and user_id=p_user_id) into ok;
    when 'health_event' then select exists(select 1 from public.health_events where id=p_id and user_id=p_user_id) into ok;
    when 'expense' then select exists(select 1 from public.expenses where id=p_id and user_id=p_user_id) into ok;
    when 'document' then select exists(select 1 from public.documents where id=p_id and user_id=p_user_id) into ok;
    when 'contact' then select exists(select 1 from public.contacts where id=p_id and user_id=p_user_id) into ok;
    when 'journal' then select exists(select 1 from public.memories where id=p_id and user_id=p_user_id and kind='journal') into ok;
    when 'memory' then select exists(select 1 from public.memories where id=p_id and user_id=p_user_id) into ok;
    else ok := false; -- trip/purchase become active when their phase tables exist.
  end case;
  return coalesce(ok,false);
end;
$$;

create or replace function public.validate_glasha_entity_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.glasha_entity_owned(new.user_id,new.source_type,new.source_id) then
    raise exception 'source_entity_not_owned_or_unavailable';
  end if;
  if not public.glasha_entity_owned(new.user_id,new.target_type,new.target_id) then
    raise exception 'target_entity_not_owned_or_unavailable';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_glasha_entity_link on public.entity_links;
create trigger validate_glasha_entity_link
before insert or update on public.entity_links
for each row execute function public.validate_glasha_entity_link();

create or replace function public.validate_glasha_reminder_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.linked_entity_type is not null
     and not public.glasha_entity_owned(new.user_id,new.linked_entity_type,new.linked_entity_id) then
    raise exception 'reminder_entity_not_owned_or_unavailable';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_glasha_reminder_link on public.reminders;
create trigger validate_glasha_reminder_link
before insert or update of linked_entity_type, linked_entity_id, user_id on public.reminders
for each row execute function public.validate_glasha_reminder_link();

create or replace function public.validate_glasha_notification_reminder()
returns trigger
language plpgsql
security definer
set search_path = public
as $
begin
  if not exists (
    select 1 from public.reminders r
    where r.id = new.reminder_id and r.user_id = new.user_id
  ) then
    raise exception 'notification_reminder_must_belong_to_same_user';
  end if;
  return new;
end;
$;

drop trigger if exists validate_glasha_notification_reminder on public.notifications;
create trigger validate_glasha_notification_reminder
before insert or update of reminder_id, user_id on public.notifications
for each row execute function public.validate_glasha_notification_reminder();

alter table public.memories enable row level security;
alter table public.entity_links enable row level security;
alter table public.reminders enable row level security;
alter table public.notifications enable row level security;

do $$
declare t text;
begin
  foreach t in array array['memories','entity_links','reminders','notifications']
  loop
    execute format('drop policy if exists "owner_select" on public.%I',t);
    execute format('drop policy if exists "owner_insert" on public.%I',t);
    execute format('drop policy if exists "owner_update" on public.%I',t);
    execute format('drop policy if exists "owner_delete" on public.%I',t);
    execute format('create policy "owner_select" on public.%I for select to authenticated using ((select auth.uid()) = user_id)',t);
    execute format('create policy "owner_insert" on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)',t);
    execute format('create policy "owner_update" on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',t);
    execute format('create policy "owner_delete" on public.%I for delete to authenticated using ((select auth.uid()) = user_id)',t);
  end loop;
end $$;

create or replace function public.glasha_global_search(p_query text)
returns table(entity_type text, id uuid, title text, subtitle text, match_rank integer)
language sql
stable
security invoker
set search_path = public
as $
  with needle as (
    select trim(coalesce(p_query,'')) as q
  ),
  matches as (
    select case when t.is_project then 'project' else 'task' end::text as entity_type,
           t.id,
           t.title,
           concat_ws(' · ',t.area,t.status,t.due_date::text)::text as subtitle,
           case
             when lower(t.title)=lower(n.q) then 0
             when lower(t.title) like lower(n.q)||'%' then 1
             else 2
           end as match_rank
    from public.tasks t cross join needle n
    where t.user_id=(select auth.uid()) and n.q<>'' and t.title ilike '%'||n.q||'%'

    union all
    select 'goal',g.id,g.title,concat_ws(' · ',g.kind,g.status,g.target_date::text),
           case when lower(g.title)=lower(n.q) then 0 when lower(g.title) like lower(n.q)||'%' then 1 else 2 end
    from public.goals g cross join needle n
    where g.user_id=(select auth.uid()) and n.q<>'' and g.title ilike '%'||n.q||'%'

    union all
    select 'event',e.id,e.title,concat_ws(' · ',e.kind,e.start_at::text,e.area),
           case when lower(e.title)=lower(n.q) then 0 when lower(e.title) like lower(n.q)||'%' then 1 else 2 end
    from public.calendar_events e cross join needle n
    where e.user_id=(select auth.uid()) and n.q<>'' and e.title ilike '%'||n.q||'%'

    union all
    select 'document',d.id,d.title,concat_ws(' · ',d.document_type,d.owner_person,d.expiry_date::text),
           case when lower(d.title)=lower(n.q) then 0 when lower(d.title) like lower(n.q)||'%' then 1 else 2 end
    from public.documents d cross join needle n
    where d.user_id=(select auth.uid()) and n.q<>'' and d.title ilike '%'||n.q||'%'

    union all
    select 'contact',c.id,c.name,concat_ws(' · ',c.relation,c.phone,c.email),
           case when lower(c.name)=lower(n.q) then 0 when lower(c.name) like lower(n.q)||'%' then 1 else 2 end
    from public.contacts c cross join needle n
    where c.user_id=(select auth.uid()) and n.q<>'' and c.name ilike '%'||n.q||'%'

    union all
    select 'inbox',i.id,left(i.text,240),
           case when i.processed then 'обработано' else 'входящее' end,
           case when lower(i.text)=lower(n.q) then 0 when lower(i.text) like lower(n.q)||'%' then 1 else 2 end
    from public.inbox_entries i cross join needle n
    where i.user_id=(select auth.uid()) and n.q<>'' and i.text ilike '%'||n.q||'%'

    union all
    select case when m.kind='journal' then 'journal' else 'memory' end,
           m.id,m.title,concat_ws(' · ',m.kind,m.happened_at::text),
           case
             when lower(m.title)=lower(n.q) then 0
             when lower(m.title) like lower(n.q)||'%' then 1
             when coalesce(m.body,'') ilike '%'||n.q||'%' then 3
             else 2
           end
    from public.memories m cross join needle n
    where m.user_id=(select auth.uid()) and n.q<>''
      and (m.title ilike '%'||n.q||'%' or coalesce(m.body,'') ilike '%'||n.q||'%')
  )
  select matches.entity_type,matches.id,matches.title,matches.subtitle,matches.match_rank
  from matches
  order by match_rank, lower(title), entity_type
  limit 40;
$;

revoke all on function public.glasha_global_search(text) from public, anon;
grant execute on function public.glasha_global_search(text) to authenticated;

grant select,insert,update,delete on public.memories,public.entity_links,public.reminders,public.notifications to authenticated;
revoke all on public.memories,public.entity_links,public.reminders,public.notifications from anon;

revoke all on function public.glasha_entity_owned(uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.validate_glasha_entity_link() from public, anon, authenticated;
revoke all on function public.validate_glasha_reminder_link() from public, anon, authenticated;
revoke all on function public.validate_glasha_notification_reminder() from public, anon, authenticated;
revoke all on function public.glasha_task_completed_at() from public, anon, authenticated;
