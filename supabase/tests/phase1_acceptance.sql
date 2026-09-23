-- LIFE OS Phase 1 preview acceptance.
-- Run only on a Supabase development branch. Everything rolls back.

begin;

create temporary table phase1_test_ids(a uuid, b uuid, task_a uuid, goal_a uuid, reminder_a uuid) on commit drop;
insert into phase1_test_ids(a,b) values (gen_random_uuid(), gen_random_uuid());

insert into auth.users(
  id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous
)
select a,'authenticated','authenticated','phase1-a-'||a||'@example.invalid','',now(),'{}','{}',now(),now(),false,false from phase1_test_ids
union all
select b,'authenticated','authenticated','phase1-b-'||b||'@example.invalid','',now(),'{}','{}',now(),now(),false,false from phase1_test_ids;

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
end $;

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
end $;

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
