-- Hardening for project hierarchy introduced by 004.
alter function public.validate_glasha_task_parent()
  set search_path = public;

create index if not exists tasks_parent_task_id_idx
  on public.tasks(parent_task_id)
  where parent_task_id is not null;
