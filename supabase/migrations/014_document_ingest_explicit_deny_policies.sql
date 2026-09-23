do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='document_ingest_jobs' and policyname='deny_client_all') then
    create policy deny_client_all on public.document_ingest_jobs
      for all to anon, authenticated using (false) with check (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='document_ingest_chunks' and policyname='deny_client_all') then
    create policy deny_client_all on public.document_ingest_chunks
      for all to anon, authenticated using (false) with check (false);
  end if;
end $$;
