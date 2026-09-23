-- LIFE OS Phase 1 phonebook import and contact matching foundation.
-- Preview/test only until Controller acceptance.

alter table public.contacts
  add column if not exists phone_numbers jsonb not null default '[]'::jsonb,
  add column if not exists emails jsonb not null default '[]'::jsonb,
  add column if not exists aliases text[] not null default '{}',
  add column if not exists source text not null default 'manual',
  add column if not exists source_uid text;

alter table public.contacts
  drop constraint if exists contacts_phone_numbers_array_check;
alter table public.contacts
  add constraint contacts_phone_numbers_array_check
  check (jsonb_typeof(phone_numbers) = 'array');

alter table public.contacts
  drop constraint if exists contacts_emails_array_check;
alter table public.contacts
  add constraint contacts_emails_array_check
  check (jsonb_typeof(emails) = 'array');

create unique index if not exists contacts_user_source_uid_uidx
  on public.contacts(user_id, source_uid)
  where source_uid is not null;

create index if not exists contacts_user_source_idx
  on public.contacts(user_id, source);

update public.contacts
set phone_numbers = jsonb_build_array(
      jsonb_build_object('label','main','value',phone,'normalized',regexp_replace(phone,'[^0-9+]','','g'))
    )
where phone is not null
  and trim(phone) <> ''
  and jsonb_array_length(phone_numbers) = 0;

update public.contacts
set emails = jsonb_build_array(
      jsonb_build_object('label','main','value',email)
    )
where email is not null
  and trim(email) <> ''
  and jsonb_array_length(emails) = 0;

-- Keep primary legacy fields populated for old UI/actions while the richer arrays
-- remain the source for phonebook imports.
create or replace function public.glasha_contact_primary_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.phone is null or trim(new.phone) = '') and jsonb_array_length(new.phone_numbers) > 0 then
    new.phone := nullif(new.phone_numbers->0->>'value','');
  end if;
  if (new.email is null or trim(new.email) = '') and jsonb_array_length(new.emails) > 0 then
    new.email := nullif(new.emails->0->>'value','');
  end if;
  return new;
end;
$$;

drop trigger if exists glasha_contact_primary_fields on public.contacts;
create trigger glasha_contact_primary_fields
before insert or update of phone, email, phone_numbers, emails on public.contacts
for each row execute function public.glasha_contact_primary_fields();

revoke all on function public.glasha_contact_primary_fields() from public, anon, authenticated;
