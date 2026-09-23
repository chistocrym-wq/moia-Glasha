-- Named document owners for family/private archive.
alter table public.documents
  add column if not exists owner_name text;

update public.documents
set owner_name = case owner_person
  when 'user' then 'Юлия Катаускайте'
  when 'child' then 'Матвей'
  when 'mother' then 'Катаускене Светлана'
  when 'work' then 'Работа'
  else coalesce(owner_name, 'Другое')
end
where owner_name is null or btrim(owner_name) = '';

create index if not exists documents_user_owner_name_idx
  on public.documents (user_id, owner_name);

comment on column public.documents.owner_name is
  'Human-readable named owner of the document; owner_person remains the compatibility bucket.';
