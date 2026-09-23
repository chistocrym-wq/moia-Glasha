-- Phase 1 phonebook acceptance. Run only after migrations 006-008 on preview/test.
-- Entire test rolls back.

begin;

create temporary table phonebook_test_ids(a uuid, b uuid) on commit drop;
insert into phonebook_test_ids values (gen_random_uuid(), gen_random_uuid());
grant select on table phonebook_test_ids to authenticated;

insert into auth.users(
  id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous
)
select a,'authenticated','authenticated','phonebook-a-'||a||'@example.invalid','',now(),'{}','{}',now(),now(),false,false from phonebook_test_ids
union all
select b,'authenticated','authenticated','phonebook-b-'||b||'@example.invalid','',now(),'{}','{}',now(),now(),false,false from phonebook_test_ids;

set local role authenticated;
select set_config('request.jwt.claim.sub',(select a::text from phonebook_test_ids),true);

insert into public.contacts(
  user_id,name,phone_numbers,emails,aliases,source,source_uid
)
select a,'__phonebook_contact__',
       '[{"label":"mobile","value":"+12025550101","normalized":"+12025550101"}]'::jsonb,
       '[{"label":"work","value":"phonebook@example.invalid"}]'::jsonb,
       array['__phonebook_alias__'],'phone_import','phase1-phonebook-uid'
from phonebook_test_ids;

do $$
declare n integer; primary_phone text; primary_email text;
begin
  select count(*),max(phone),max(email) into n,primary_phone,primary_email
  from public.contacts where source_uid='phase1-phonebook-uid';
  if n <> 1 then raise exception 'phonebook insert failed'; end if;
  if primary_phone <> '+12025550101' then raise exception 'primary phone sync failed'; end if;
  if primary_email <> 'phonebook@example.invalid' then raise exception 'primary email sync failed'; end if;

  begin
    insert into public.contacts(user_id,name,source,source_uid)
    select a,'__duplicate__','phone_import','phase1-phonebook-uid' from phonebook_test_ids;
    raise exception 'source_uid duplicate was accepted';
  exception
    when unique_violation then null;
  end;
end $$;

select set_config('request.jwt.claim.sub',(select b::text from phonebook_test_ids),true);

do $$
declare n integer;
begin
  select count(*) into n from public.contacts where source_uid='phase1-phonebook-uid';
  if n <> 0 then raise exception 'phonebook RLS leak'; end if;
end $$;

rollback;

select 'PHASE1_PHONEBOOK_ACCEPTANCE_PASS' as result;
