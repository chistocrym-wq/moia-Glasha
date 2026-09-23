-- LIFE OS Phase 1 completion/project hardening.
-- Additive migration for preview/test Supabase branch. Do not apply to production before Controller approval.

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  status text not null default 'planned' check (status in ('planned','active','done','cancelled')),
  starts_at timestamptz,
  ends_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  purchased_at timestamptz,
  amount numeric(14,2),
  currency text not null default 'RUB',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.trips enable row level security;
alter table public.purchases enable row level security;

do $$
declare t text;
begin
  foreach t in array array['trips','purchases']
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

grant select,insert,update,delete on public.trips,public.purchases to authenticated;
revoke all on public.trips,public.purchases from anon;

create index if not exists trips_user_dates_idx on public.trips(user_id, starts_at);
create index if not exists purchases_user_date_idx on public.purchases(user_id, purchased_at desc);

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
    when 'trip' then select exists(select 1 from public.trips where id=p_id and user_id=p_user_id) into ok;
    when 'purchase' then select exists(select 1 from public.purchases where id=p_id and user_id=p_user_id) into ok;
    when 'journal' then select exists(select 1 from public.memories where id=p_id and user_id=p_user_id and kind='journal') into ok;
    when 'memory' then select exists(select 1 from public.memories where id=p_id and user_id=p_user_id) into ok;
    else ok := false;
  end case;
  return coalesce(ok,false);
end;
$$;

create or replace function public.glasha_guard_parent_completion()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  child_count integer;
  incomplete_count integer;
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    select
      count(*) filter (where status <> 'cancelled'),
      count(*) filter (where status <> 'cancelled' and status <> 'done')
    into child_count, incomplete_count
    from public.tasks
    where parent_task_id = new.id;

    if child_count > 0 and incomplete_count > 0 then
      raise exception 'project_has_incomplete_subtasks';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists glasha_guard_parent_completion on public.tasks;
create trigger glasha_guard_parent_completion
before update of status on public.tasks
for each row execute function public.glasha_guard_parent_completion();

create or replace function public.glasha_move_task_area(
  p_task_id uuid,
  p_area text,
  p_move_children boolean default true
)
returns table(id uuid, title text, area text, status text, parent_task_id uuid, is_project boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  owner_id uuid := auth.uid();
begin
  if owner_id is null then raise exception 'auth_required'; end if;
  if p_area not in ('personal','work') then raise exception 'bad_area'; end if;
  if not exists(select 1 from public.tasks where id=p_task_id and user_id=owner_id) then
    raise exception 'task_not_found';
  end if;

  if p_move_children then
    with recursive tree as (
      select t.id from public.tasks t where t.id=p_task_id and t.user_id=owner_id
      union all
      select c.id
      from public.tasks c
      join tree p on c.parent_task_id=p.id
      where c.user_id=owner_id
    )
    update public.tasks t
    set area=p_area, updated_at=now()
    where t.user_id=owner_id and t.id in (select tree.id from tree);
  else
    update public.tasks
    set area=p_area, updated_at=now()
    where id=p_task_id and user_id=owner_id;
  end if;

  return query
  select t.id,t.title,t.area,t.status,t.parent_task_id,t.is_project
  from public.tasks t
  where t.user_id=owner_id
    and (t.id=p_task_id or (p_move_children and t.parent_task_id=p_task_id))
  order by (t.id=p_task_id) desc,t.sort_order,t.created_at;
end;
$$;

create or replace function public.glasha_list_root_tasks()
returns table(
  id uuid,
  title text,
  area text,
  status text,
  due_date date,
  due_time time,
  reminder_at timestamptz,
  priority text,
  goal_id uuid,
  goal_title text,
  parent_task_id uuid,
  is_project boolean,
  completed_at timestamptz,
  completed_subtasks bigint,
  total_subtasks bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.id,
    p.title,
    p.area,
    p.status,
    p.due_date,
    p.due_time,
    p.reminder_at,
    p.priority,
    p.goal_id,
    g.title as goal_title,
    p.parent_task_id,
    p.is_project,
    p.completed_at,
    count(c.id) filter (where c.status = 'done') as completed_subtasks,
    count(c.id) filter (where c.status <> 'cancelled') as total_subtasks
  from public.tasks p
  left join public.tasks c
    on c.parent_task_id = p.id
   and c.user_id = p.user_id
  left join public.goals g
    on g.id = p.goal_id
   and g.user_id = p.user_id
  where p.user_id = auth.uid()
    and p.parent_task_id is null
    and p.status <> 'cancelled'
  group by p.id,g.title
  order by p.due_date asc nulls last,p.due_time asc nulls last,p.created_at desc;
$$;

revoke all on function public.glasha_guard_parent_completion() from public,anon,authenticated;
revoke all on function public.glasha_move_task_area(uuid,text,boolean) from public,anon;
revoke all on function public.glasha_list_root_tasks() from public,anon;
grant execute on function public.glasha_move_task_area(uuid,text,boolean) to authenticated;
grant execute on function public.glasha_list_root_tasks() to authenticated;
