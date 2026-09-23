-- Glasha security hardening + supporting indexes
-- Additive migration after 001_glasha_core.sql and 002_daily_core_personal_hub.sql.

-- SECURITY DEFINER seed helpers are internal trigger helpers.
-- They must not be callable from the exposed API roles.
revoke execute on function public.seed_glasha_user() from public, anon, authenticated;
revoke execute on function public.seed_glasha_connections(uuid) from public, anon, authenticated;

-- Supporting indexes for foreign keys used by common lookups/deletes.
create index if not exists attachments_user_idx
  on public.attachments(user_id);

create index if not exists calendar_events_linked_task_idx
  on public.calendar_events(linked_task_id);

create index if not exists expenses_category_idx
  on public.expenses(category_id);

create index if not exists goal_steps_goal_idx
  on public.goal_steps(goal_id);

create index if not exists goal_steps_user_idx
  on public.goal_steps(user_id);

create index if not exists goals_user_idx
  on public.goals(user_id);

create index if not exists quick_links_user_idx
  on public.quick_links(user_id);

create index if not exists tasks_goal_idx
  on public.tasks(goal_id);
