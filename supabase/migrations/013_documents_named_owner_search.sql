create or replace function public.glasha_global_search(p_query text)
returns table(entity_type text, id uuid, title text, subtitle text, match_rank integer)
language sql
stable
set search_path to 'public'
as $function$
  with needle as (
    select trim(coalesce(p_query,'')) as q
  ),
  matches as (
    select case when t.is_project then 'project' else 'task' end::text as entity_type,
           t.id,t.title,concat_ws(' · ',t.area,t.status,t.due_date::text)::text as subtitle,
           case when lower(t.title)=lower(n.q) then 0 when lower(t.title) like lower(n.q)||'%' then 1 else 2 end as match_rank
    from public.tasks t cross join needle n
    where t.user_id=(select auth.uid()) and n.q<>'' and t.title ilike '%'||n.q||'%'

    union all
    select 'goal',g.id,g.title,concat_ws(' · ',g.kind,g.status,g.target_date::text),
           case when lower(g.title)=lower(n.q) then 0 when lower(g.title) like lower(n.q)||'%' then 1 else 2 end
    from public.goals g cross join needle n
    where g.user_id=(select auth.uid()) and n.q<>'' and g.title ilike '%'||n.q||'%'

    union all
    select 'event',e.id,e.title,concat_ws(' · ',e.kind,e.start_at::text,e.area),
           case when lower(e.title)=lower(n.q) then 0 when lower(e.title) like lower(n.q)||'%' then 1 else 2 end
    from public.calendar_events e cross join needle n
    where e.user_id=(select auth.uid()) and n.q<>'' and e.title ilike '%'||n.q||'%'

    union all
    select 'document',d.id,d.title,
           concat_ws(' · ',d.owner_name,d.document_type,d.expiry_date::text),
           case
             when lower(d.title)=lower(n.q) then 0
             when lower(coalesce(d.owner_name,''))=lower(n.q) then 0
             when lower(d.title) like lower(n.q)||'%' then 1
             when lower(coalesce(d.owner_name,'')) like lower(n.q)||'%' then 1
             else 2
           end
    from public.documents d cross join needle n
    where d.user_id=(select auth.uid()) and n.q<>''
      and (
        d.title ilike '%'||n.q||'%'
        or coalesce(d.owner_name,'') ilike '%'||n.q||'%'
        or d.document_type ilike '%'||n.q||'%'
        or array_to_string(d.tags,' ') ilike '%'||n.q||'%'
      )

    union all
    select 'contact',c.id,c.name,concat_ws(' · ',c.relation,c.phone,c.email),
           case when lower(c.name)=lower(n.q) then 0 when lower(c.name) like lower(n.q)||'%' then 1 else 2 end
    from public.contacts c cross join needle n
    where c.user_id=(select auth.uid()) and n.q<>'' and c.name ilike '%'||n.q||'%'

    union all
    select 'inbox',i.id,left(i.text,240),
           case when i.processed then 'обработано' else 'входящее' end,
           case when lower(i.text)=lower(n.q) then 0 when lower(i.text) like lower(n.q)||'%' then 1 else 2 end
    from public.inbox_entries i cross join needle n
    where i.user_id=(select auth.uid()) and n.q<>'' and i.text ilike '%'||n.q||'%'

    union all
    select case when m.kind='journal' then 'journal' else 'memory' end,
           m.id,m.title,concat_ws(' · ',m.kind,m.happened_at::text),
           case when lower(m.title)=lower(n.q) then 0
                when lower(m.title) like lower(n.q)||'%' then 1
                when coalesce(m.body,'') ilike '%'||n.q||'%' then 3
                else 2 end
    from public.memories m cross join needle n
    where m.user_id=(select auth.uid()) and n.q<>''
      and (m.title ilike '%'||n.q||'%' or coalesce(m.body,'') ilike '%'||n.q||'%')
  )
  select matches.entity_type,matches.id,matches.title,matches.subtitle,matches.match_rank
  from matches
  order by match_rank, lower(title), entity_type
  limit 40;
$function$;
