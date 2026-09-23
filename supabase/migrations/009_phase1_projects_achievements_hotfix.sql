-- Reproduce the live phase1_projects_achievements_hotfix migration.
-- Keeps the table-returning RPC free of ambiguous output-column references.

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
  if not exists(select 1 from public.tasks t where t.id=p_task_id and t.user_id=owner_id) then
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
    update public.tasks t
    set area=p_area, updated_at=now()
    where t.id=p_task_id and t.user_id=owner_id;
  end if;

  return query
  select t.id,t.title,t.area,t.status,t.parent_task_id,t.is_project
  from public.tasks t
  where t.user_id=owner_id
    and (t.id=p_task_id or (p_move_children and t.parent_task_id=p_task_id))
  order by (t.id=p_task_id) desc,t.sort_order,t.created_at;
end;
$$;

revoke all on function public.glasha_move_task_area(uuid,text,boolean) from public,anon;
grant execute on function public.glasha_move_task_area(uuid,text,boolean) to authenticated;
