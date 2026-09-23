-- Phase 1 UX: parent-task completion lifecycle and achievements history.

alter table public.tasks
  add column if not exists completed_at timestamptz;

update public.tasks
set completed_at = coalesce(completed_at, updated_at, created_at)
where status = 'done' and completed_at is null;

update public.tasks
set completed_at = null
where status <> 'done' and completed_at is not null;

create index if not exists tasks_user_completed_root_idx
  on public.tasks(user_id, completed_at desc)
  where status = 'done' and parent_task_id is null;

create or replace function public.stamp_glasha_task_completion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'done' then
    if tg_op = 'INSERT' or old.status is distinct from 'done' then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_glasha_task_completion on public.tasks;
create trigger stamp_glasha_task_completion
before insert or update of status on public.tasks
for each row execute function public.stamp_glasha_task_completion();

create or replace function public.sync_glasha_parent_completion()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  old_parent uuid;
  new_parent uuid;
  target_parent uuid;
  total_count integer;
  done_count integer;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    old_parent := old.parent_task_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    new_parent := new.parent_task_id;
  end if;

  foreach target_parent in array array_remove(array[old_parent, new_parent], null)
  loop
    select
      count(*) filter (where status <> 'cancelled'),
      count(*) filter (where status = 'done')
    into total_count, done_count
    from public.tasks
    where parent_task_id = target_parent;

    if total_count = 0 then
      update public.tasks
      set is_project = false,
          updated_at = now()
      where id = target_parent
        and is_project is distinct from false;
    elsif done_count = total_count then
      update public.tasks
      set is_project = true,
          status = 'done',
          completed_at = coalesce(completed_at, now()),
          updated_at = now()
      where id = target_parent
        and (status is distinct from 'done' or is_project is distinct from true or completed_at is null);
    else
      update public.tasks
      set is_project = true,
          status = case
            when status = 'done' and done_count > 0 then 'doing'
            when status = 'done' then 'todo'
            else status
          end,
          completed_at = case when status = 'done' then null else completed_at end,
          updated_at = now()
      where id = target_parent
        and (
          is_project is distinct from true
          or status = 'done'
          or completed_at is not null
        );
    end if;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_glasha_parent_completion on public.tasks;
create trigger sync_glasha_parent_completion
after insert or delete or update of status, parent_task_id on public.tasks
for each row execute function public.sync_glasha_parent_completion();

update public.tasks p
set is_project = true,
    status = case
      when s.total_count > 0 and s.done_count = s.total_count then 'done'
      when p.status = 'done' and s.done_count > 0 then 'doing'
      when p.status = 'done' then 'todo'
      else p.status
    end,
    completed_at = case
      when s.total_count > 0 and s.done_count = s.total_count then coalesce(p.completed_at, now())
      else null
    end,
    updated_at = now()
from (
  select parent_task_id,
         count(*) filter (where status <> 'cancelled') as total_count,
         count(*) filter (where status = 'done') as done_count
  from public.tasks
  where parent_task_id is not null
  group by parent_task_id
) s
where p.id = s.parent_task_id;

revoke all on function public.stamp_glasha_task_completion() from public;
revoke all on function public.sync_glasha_parent_completion() from public;
