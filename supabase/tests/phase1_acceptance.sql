-- LIFE OS Phase 1 preview acceptance.
-- Run only on a Supabase development branch. Everything rolls back.

begin;

create temporary table phase1_test_ids(a uuid, b uuid, task_a uuid, goal_a uuid, reminder_a uuid, project_a uuid, child_1 uuid, child_2 uuid, child_3 uuid, child_4 uuid) on commit drop;
insert into phase1_test_ids(a,b) values (gen_random_uuid(), gen_random_uuid());
grant select,update on table phase1_test_ids to authenticated;

insert into auth.users(
  id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous
)
select a,'authenticated','authenticated','phase1-a-'||a||'@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now(),false,false from phase1_test_ids
union all
select b,'authenticated','authenticated','phase1-b-'||b||'@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now(),false,false from phase1_test_ids;

-- User A creates owned entities under real authenticated RLS.
set local role authenticated;
select set_config('request.jwt.claim.sub',(select a::text from phase1_test_ids),true);

with inserted as (
  insert into public.tasks(user_id,area,title,status,priority,source)
  select a,'personal','__phase1_rls_task_a__','todo','normal','manual' from phase1_test_ids
  returning id
)
update phase1_test_ids set task_a=(select id from inserted);

with inserted as (
  insert into public.goals(user_id,kind,title,status)
  select a,'goal','__phase1_rls_goal_a__','active' from phase1_test_ids
  returning id
)
update phase1_test_ids set goal_a=(select id from inserted);

insert into public.entity_links(user_id,source_type,source_id,target_type,target_id,relation_type,note)
select a,'task',task_a,'goal',goal_a,'supports','preview acceptance'
from phase1_test_ids;


-- Project hierarchy: root-only list, lazy children, progress, completion, restore, cascade move.
with parent as (
  insert into public.tasks(user_id,area,title,status,priority,source,is_project)
  select a,'personal','__phase1_project_parent__','todo','normal','manual',true from phase1_test_ids
  returning id
)
update phase1_test_ids set project_a=(select id from parent);

with c1 as (
  insert into public.tasks(user_id,area,title,status,priority,source,parent_task_id,sort_order)
  select a,'personal','__phase1_child_1__','todo','normal','manual',project_a,10 from phase1_test_ids returning id
) update phase1_test_ids set child_1=(select id from c1);
with c2 as (
  insert into public.tasks(user_id,area,title,status,priority,source,parent_task_id,sort_order)
  select a,'personal','__phase1_child_2__','todo','normal','manual',project_a,20 from phase1_test_ids returning id
) update phase1_test_ids set child_2=(select id from c2);
with c3 as (
  insert into public.tasks(user_id,area,title,status,priority,source,parent_task_id,sort_order)
  select a,'personal','__phase1_child_3__','todo','normal','manual',project_a,30 from phase1_test_ids returning id
) update phase1_test_ids set child_3=(select id from c3);
with c4 as (
  insert into public.tasks(user_id,area,title,status,priority,source,parent_task_id,sort_order)
  select a,'personal','__phase1_child_4__','todo','normal','manual',project_a,40 from phase1_test_ids returning id
) update phase1_test_ids set child_4=(select id from c4);

do $$
declare n integer; pct integer; rejected boolean := false;
begin
  select count(*) into n from public.glasha_list_root_tasks() where id=(select project_a from phase1_test_ids);
  if n <> 1 then raise exception 'phase1 root project missing'; end if;
  select count(*) into n from public.glasha_list_root_tasks() where id in (select child_1 from phase1_test_ids union all select child_2 from phase1_test_ids union all select child_3 from phase1_test_ids union all select child_4 from phase1_test_ids);
  if n <> 0 then raise exception 'phase1 children leaked into root list'; end if;

  update public.tasks set status='done' where id=(select child_1 from phase1_test_ids);
  select round(100.0*completed_subtasks/nullif(total_subtasks,0))::int into pct from public.glasha_list_root_tasks() where id=(select project_a from phase1_test_ids);
  if pct <> 25 then raise exception 'phase1 progress expected 25 got %',pct; end if;

  update public.tasks set status='done' where id=(select child_2 from phase1_test_ids);
  select round(100.0*completed_subtasks/nullif(total_subtasks,0))::int into pct from public.glasha_list_root_tasks() where id=(select project_a from phase1_test_ids);
  if pct <> 50 then raise exception 'phase1 progress expected 50 got %',pct; end if;

  begin
    update public.tasks set status='done' where id=(select project_a from phase1_test_ids);
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'phase1 parent completed with incomplete children'; end if;

  update public.tasks set status='done' where id in ((select child_3 from phase1_test_ids),(select child_4 from phase1_test_ids));
  select count(*) into n from public.tasks where id=(select project_a from phase1_test_ids) and status='done' and completed_at is not null;
  if n <> 1 then raise exception 'phase1 parent did not auto-complete at 100 percent'; end if;

  update public.tasks set status='doing' where id=(select project_a from phase1_test_ids);
  select count(*) into n from public.tasks where id=(select project_a from phase1_test_ids) and status='doing' and completed_at is null;
  if n <> 1 then raise exception 'phase1 restore did not preserve id/clear completed_at'; end if;

  perform public.glasha_move_task_area((select project_a from phase1_test_ids),'work',true);
  select count(*) into n from public.tasks
  where id in ((select project_a from phase1_test_ids),(select child_1 from phase1_test_ids),(select child_2 from phase1_test_ids),(select child_3 from phase1_test_ids),(select child_4 from phase1_test_ids))
    and area='work';
  if n <> 5 then raise exception 'phase1 cascade move expected 5 rows got %',n; end if;
end $$;

with inserted as (
  insert into public.reminders(
    user_id,title,priority,category,recurrence,recurrence_interval,
    due_at,next_occurrence_at,active,linked_entity_type,linked_entity_id
  )
  select a,'__phase1_rls_reminder_a__','normal','general','daily',1,
         now()+interval '1 hour',now()+interval '1 hour',true,'task',task_a
  from phase1_test_ids
  returning id
)
update phase1_test_ids set reminder_a=(select id from inserted);

insert into public.notifications(user_id,reminder_id,title,scheduled_for,deliver_at,priority,state)
select a,reminder_a,'__phase1_rls_notification_a__',now()+interval '1 hour',now()+interval '1 hour','normal','unread'
from phase1_test_ids;

do $$
declare n integer;
begin
  select count(*) into n from public.entity_links where relation_type='supports' and note='preview acceptance';
  if n <> 1 then raise exception 'phase1 own entity link failed'; end if;
  select count(*) into n from public.reminders where title='__phase1_rls_reminder_a__';
  if n <> 1 then raise exception 'phase1 own reminder failed'; end if;
  select count(*) into n from public.notifications where title='__phase1_rls_notification_a__';
  if n <> 1 then raise exception 'phase1 own notification failed'; end if;
  select count(*) into n from public.glasha_global_search('__phase1_rls_task_a__');
  if n <> 1 then raise exception 'phase1 global search failed for owner'; end if;
end $$;

-- User B must not see A's rows.
select set_config('request.jwt.claim.sub',(select b::text from phase1_test_ids),true);

do $$
declare n integer;
begin
  select count(*) into n from public.entity_links where note='preview acceptance';
  if n <> 0 then raise exception 'phase1 RLS leak: entity_links'; end if;
  select count(*) into n from public.reminders where title='__phase1_rls_reminder_a__';
  if n <> 0 then raise exception 'phase1 RLS leak: reminders'; end if;
  select count(*) into n from public.notifications where title='__phase1_rls_notification_a__';
  if n <> 0 then raise exception 'phase1 RLS leak: notifications'; end if;
  select count(*) into n from public.glasha_global_search('__phase1_rls_task_a__');
  if n <> 0 then raise exception 'phase1 RLS leak: global search RPC'; end if;
end $$;

-- Cross-user relation/notification references must be rejected even if UUIDs are known.
do $$
declare
  aid uuid; taskid uuid; goalid uuid; reminderid uuid;
  rejected boolean := false;
begin
  select a,task_a,goal_a,reminder_a into aid,taskid,goalid,reminderid from phase1_test_ids;
  begin
    insert into public.entity_links(user_id,source_type,source_id,target_type,target_id,relation_type)
    values ((select b from phase1_test_ids),'task',taskid,'goal',goalid,'illegal_cross_user');
  exception when others then
    rejected := true;
  end;
  if not rejected then raise exception 'phase1 cross-user entity link was not rejected'; end if;

  rejected := false;
  begin
    insert into public.notifications(user_id,reminder_id,title,scheduled_for,deliver_at,priority,state)
    values ((select b from phase1_test_ids),reminderid,'illegal cross user',now(),now(),'normal','unread');
  exception when others then
    rejected := true;
  end;
  if not rejected then raise exception 'phase1 cross-user notification was not rejected'; end if;
end $$;

reset role;

-- Structural assertions as migration owner.
do $$
declare n integer;
begin
  select count(*) into n
  from information_schema.tables
  where table_schema='public' and table_name in ('memories','entity_links','reminders','notifications');
  if n <> 4 then raise exception 'phase1 tables missing: found %',n; end if;

  select count(*) into n
  from pg_class c join pg_namespace nsp on nsp.oid=c.relnamespace
  where nsp.nspname='public' and c.relname in ('memories','entity_links','reminders','notifications') and c.relrowsecurity;
  if n <> 4 then raise exception 'phase1 RLS not enabled on every new table'; end if;
end $$;

rollback;

select 'PHASE1_PREVIEW_ACCEPTANCE_PASS' as result;
