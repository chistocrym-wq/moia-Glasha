-- Locked internal document ingest staging used by Controller/admin tooling.
create table if not exists public.document_ingest_jobs (
  job_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  owner_person text not null,
  owner_name text not null,
  title text not null,
  document_type text not null default 'other',
  mime_type text not null default 'application/pdf',
  file_name text not null,
  total_chunks integer not null check (total_chunks > 0),
  state text not null default 'pending' check (state in ('pending','processing','done','error')),
  storage_path text,
  error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists public.document_ingest_chunks (
  job_id uuid not null references public.document_ingest_jobs(job_id) on delete cascade,
  chunk_no integer not null check (chunk_no >= 0),
  data_b64 text not null,
  primary key (job_id, chunk_no)
);

alter table public.document_ingest_jobs enable row level security;
alter table public.document_ingest_chunks enable row level security;

revoke all on public.document_ingest_jobs from anon, authenticated;
revoke all on public.document_ingest_chunks from anon, authenticated;

comment on table public.document_ingest_jobs is 'Locked internal staging for privileged document ingestion; no client policies.';
comment on table public.document_ingest_chunks is 'Locked internal base64 chunks for privileged document ingestion; no client policies.';
